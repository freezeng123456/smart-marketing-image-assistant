import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createDashScopeProvider } from "../server/dashscope-provider.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7L8AAAAASUVORK5CYII=",
  "base64"
);

async function startFakeDashScope() {
  const calls = { create: [], poll: [] };
  let polls = 0;
  let port = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (request.method === "POST" && url.pathname.includes("/image-synthesis")) {
      assert.equal(request.headers.authorization, "Bearer test-dashscope-key");
      assert.equal(request.headers["x-dashscope-async"], "enable");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      calls.create.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ output: { task_id: "task-abc", task_status: "PENDING" }, request_id: "req-1" }));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/v1/tasks/")) {
      assert.equal(request.headers.authorization, "Bearer test-dashscope-key");
      polls += 1;
      calls.poll.push(url.pathname);
      const done = polls >= 2;
      const payload = done
        ? {
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: `http://127.0.0.1:${port}/result.png` }]
            }
          }
        : { output: { task_status: "RUNNING" } };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }
    if (request.method === "GET" && url.pathname === "/result.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(ONE_PIXEL_PNG);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  port = address.port;
  return {
    calls,
    apiBase: `http://127.0.0.1:${address.port}/api/v1/services/aigc/image2image/image-synthesis`,
    taskBase: `http://127.0.0.1:${address.port}/api/v1/tasks`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

test("DashScope provider posts async edit job, polls, and downloads result", async (t) => {
  const fake = await startFakeDashScope();
  t.after(() => fake.close());

  const originalSleep = globalThis.setTimeout;
  const provider = createDashScopeProvider({
    apiKey: "test-dashscope-key",
    apiBase: fake.apiBase,
    taskBase: fake.taskBase,
    loadImageSource: async () => ({ buffer: ONE_PIXEL_PNG, mime: "image/png" }),
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: globalThis.fetch
  });

  globalThis.setTimeout = (fn, ms, ...args) => originalSleep(fn, Math.min(ms, 5), ...args);
  t.after(() => {
    globalThis.setTimeout = originalSleep;
  });

  const result = await provider.generate(
    {
      prompt: "生成一张美团七夕袋鼠活动海报",
      brandAsset: "brand-kangaroo",
      ratio: "9:16",
      size: "1080x1920",
      styles: ["品牌官方"],
      referenceImages: []
    },
    0
  );

  assert.equal(result.mime, "image/png");
  assert.deepEqual(result.buffer, ONE_PIXEL_PNG);
  assert.match(result.model, /dashscope\/wanx2\.1-imageedit/);
  assert.equal(fake.calls.create.length, 1);
  const created = fake.calls.create[0];
  assert.equal(created.model, "wanx2.1-imageedit");
  assert.equal(created.input.function, "description_edit");
  assert.ok(created.input.base_image_url.startsWith("data:image/"));
  assert.match(created.input.prompt, /Brief:/);
  assert.equal(created.parameters.n, 1);
  assert.equal(created.parameters.watermark, false);
  assert.ok(fake.calls.poll.length >= 2);
});

test("DashScope provider requires a reference or brand image", async () => {
  const provider = createDashScopeProvider({
    apiKey: "test-dashscope-key",
    loadImageSource: async () => {
      throw new Error("no load");
    },
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    }
  });
  await assert.rejects(
    () =>
      provider.generate({
        prompt: "no refs",
        brandAsset: "none",
        referenceImages: []
      }),
    /参考图|品牌/
  );
});
