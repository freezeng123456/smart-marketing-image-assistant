import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createDashScopeProvider,
  prepareWanxBaseImageUrl,
  resolveDashScopeBases
} from "../server/dashscope-provider.mjs";
import { ensureWanxEditInputSize, imageDimensions } from "../server/image-utils.mjs";
import { toDataUri } from "../server/ref-compose.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7L8AAAAASUVORK5CYII=",
  "base64"
);

/** Valid Pillow-readable 64×48 RGB PNG for wanx upscale tests (undersized). */
const SMALL_RGB_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAUUlEQVR4nO3PMQ0AIADAMEAr/i2ACI6GZFWwzbPH15YOeNWA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oB2AR1QAcOtgRAGAAAAAElFTkSuQmCC",
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


test("resolveDashScopeBases derives api/task from DASHSCOPE_WORKSPACE_BASE", () => {
  const prevWs = process.env.DASHSCOPE_WORKSPACE_BASE;
  const prevApi = process.env.DASHSCOPE_API_BASE;
  const prevTask = process.env.DASHSCOPE_TASK_BASE;
  try {
    delete process.env.DASHSCOPE_API_BASE;
    delete process.env.DASHSCOPE_TASK_BASE;
    process.env.DASHSCOPE_WORKSPACE_BASE = "https://ws-demo.cn-beijing.maas.aliyuncs.com/api/v1/";
    const bases = resolveDashScopeBases();
    assert.equal(
      bases.apiBase,
      "https://ws-demo.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis"
    );
    assert.equal(bases.taskBase, "https://ws-demo.cn-beijing.maas.aliyuncs.com/api/v1/tasks");

    const overridden = resolveDashScopeBases({
      apiBase: "http://explicit/api",
      taskBase: "http://explicit/tasks"
    });
    assert.equal(overridden.apiBase, "http://explicit/api");
    assert.equal(overridden.taskBase, "http://explicit/tasks");
  } finally {
    if (prevWs === undefined) delete process.env.DASHSCOPE_WORKSPACE_BASE;
    else process.env.DASHSCOPE_WORKSPACE_BASE = prevWs;
    if (prevApi === undefined) delete process.env.DASHSCOPE_API_BASE;
    else process.env.DASHSCOPE_API_BASE = prevApi;
    if (prevTask === undefined) delete process.env.DASHSCOPE_TASK_BASE;
    else process.env.DASHSCOPE_TASK_BASE = prevTask;
  }
});

test("ensureWanxEditInputSize upscales sub-512 brand kangaroo while preserving aspect", async () => {
  const brandPath = fileURLToPath(new URL("../assets/brand-kangaroo.png", import.meta.url));
  const buffer = await readFile(brandPath);
  const before = imageDimensions(buffer);
  assert.equal(before.width, 480);
  assert.equal(before.height, 480);

  const ensured = await ensureWanxEditInputSize(buffer, { mime: "image/png" });
  assert.equal(ensured.resized, true);
  assert.ok(ensured.width >= 512);
  assert.ok(ensured.height >= 512);
  assert.ok(ensured.width <= 4096);
  assert.ok(ensured.height <= 4096);
  assert.equal(ensured.width, ensured.height); // square stays square
  assert.ok(ensured.buffer.length < 10 * 1024 * 1024);
});

test("ensureWanxEditInputSize leaves already-valid sizes untouched", async () => {
  const once = await ensureWanxEditInputSize(SMALL_RGB_PNG, { mime: "image/png" });
  assert.equal(once.resized, true);
  assert.ok(once.width >= 512 && once.height >= 512);
  // 64x48 → scale by 512/48 → width ~683, height 512
  assert.equal(once.height, 512);
  assert.ok(Math.abs(once.width - Math.round(64 * (512 / 48))) <= 1);
  const twice = await ensureWanxEditInputSize(once.buffer, { mime: once.mime });
  assert.equal(twice.resized, false);
  assert.equal(twice.width, once.width);
  assert.equal(twice.height, once.height);
  assert.equal(twice.buffer, once.buffer);
});

test("prepareWanxBaseImageUrl upscales data URI under 512px", async () => {
  const uri = toDataUri(SMALL_RGB_PNG, "image/png");
  const out = await prepareWanxBaseImageUrl(uri, { logger: { info() {} } });
  assert.ok(out.startsWith("data:image/"));
  const b64 = out.split(",")[1];
  const buf = Buffer.from(b64, "base64");
  const dims = imageDimensions(buf);
  assert.ok(dims.width >= 512 && dims.height >= 512);
});

test("DashScope provider upscales undersized user ref before create", async (t) => {
  const fake = await startFakeDashScope();
  t.after(() => fake.close());

  const originalSleep = globalThis.setTimeout;
  const provider = createDashScopeProvider({
    apiKey: "test-dashscope-key",
    apiBase: fake.apiBase,
    taskBase: fake.taskBase,
    loadImageSource: async () => ({ buffer: SMALL_RGB_PNG, mime: "image/png" }),
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl: globalThis.fetch
  });

  globalThis.setTimeout = (fn, ms, ...args) => originalSleep(fn, Math.min(ms, 5), ...args);
  t.after(() => {
    globalThis.setTimeout = originalSleep;
  });

  await provider.generate(
    {
      prompt: "Shopee style poster from small ref",
      brandAsset: "none",
      ratio: "1:1",
      size: "1024x1024",
      styles: ["电商"],
      referenceImages: ["data:image/png;base64,xx"]
    },
    0
  );

  assert.equal(fake.calls.create.length, 1);
  const base = fake.calls.create[0].input.base_image_url;
  assert.ok(base.startsWith("data:image/"));
  const buf = Buffer.from(base.split(",")[1], "base64");
  const dims = imageDimensions(buf);
  assert.ok(dims.width >= 512, `width ${dims.width}`);
  assert.ok(dims.height >= 512, `height ${dims.height}`);
});
