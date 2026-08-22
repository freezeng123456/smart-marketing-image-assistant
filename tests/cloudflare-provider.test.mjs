import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createCloudflareProvider } from "../server/cloudflare-provider.mjs";
import { createImageSourceLoader } from "../server/source-loader.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7L8AAAAASUVORK5CYII=",
  "base64"
);

async function parseMultipart(request) {
  const origin = `http://${request.headers.host}`;
  const webRequest = new Request(new URL(request.url, origin), {
    method: request.method,
    headers: request.headers,
    body: request,
    duplex: "half"
  });
  return webRequest.formData();
}

async function startFakeCloudflare() {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    if (request.url === "/client/v4/user/tokens/verify") {
      assert.equal(request.headers.authorization, "Bearer test-token");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, result: { status: "active", id: "token-id" }, errors: [], messages: [] }));
      return;
    }
    if (request.url?.includes("/ai/run/@cf/black-forest-labs/flux-2-klein-4b")) {
      assert.equal(request.headers.authorization, "Bearer test-token");
      const form = await parseMultipart(request);
      const fields = {};
      for (const [key, value] of form.entries()) {
        fields[key] = typeof value === "string" ? value : { name: value.name, type: value.type, size: value.size };
      }
      calls.push(fields);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, result: { image: ONE_PIXEL_PNG.toString("base64") }, errors: [], messages: [] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, errors: [{ message: "not found" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    calls,
    apiBase: `http://127.0.0.1:${address.port}/client/v4`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

test("Cloudflare provider verifies token and sends real FLUX multipart structure", async (t) => {
  const fake = await startFakeCloudflare();
  t.after(() => fake.close());
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const runtimeDir = await mkdtemp(join(tmpdir(), "marketing-provider-test-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  await mkdir(join(runtimeDir, "generated"), { recursive: true });
  const contextPath = join(runtimeDir, "generated", "context.png");
  await writeFile(contextPath, ONE_PIXEL_PNG);

  const loadImageSource = createImageSourceLoader({ projectRoot, runtimeDir });
  const provider = createCloudflareProvider({
    accountId: "account-id",
    apiToken: "test-token",
    apiBase: fake.apiBase,
    loadImageSource,
    logger: { warn() {}, error() {} }
  });

  const verification = await provider.verifyToken();
  assert.equal(verification.result.status, "active");

  const request = {
    prompt: "生成一张七夕袋鼠活动海报",
    brandAsset: "brand-kangaroo",
    generationType: "text-to-image",
    ratio: "9:16",
    size: "1080x1920",
    styles: ["品牌官方", "节日氛围"],
    imageCount: 1,
    referenceImages: [],
    sessionId: null
  };
  const first = await provider.generate(request, 0);
  assert.equal(first.mime, "image/png");
  assert.deepEqual(first.buffer, ONE_PIXEL_PNG);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].width, "272");
  assert.equal(fake.calls[0].height, "496");
  assert.match(fake.calls[0].prompt, /用户|User's original marketing requirement/);
  assert.ok(fake.calls[0].input_image_0, "brand mascot reference should be injected server-side");

  const second = await provider.generate(
    {
      ...request,
      prompt: "保持主题不变，把袋鼠调整为双手比心",
      generationType: "image-edit",
      sessionId: "session-1",
      contextImageUrl: contextPath,
      parentVersion: 1
    },
    0
  );
  assert.deepEqual(second.buffer, ONE_PIXEL_PNG);
  assert.equal(fake.calls.length, 2);
  assert.ok(fake.calls[1].input_image_0, "current poster should be sent as the first edit reference");
  assert.ok(fake.calls[1].input_image_1, "brand mascot should remain injected during editing");
  assert.match(fake.calls[1].prompt, /Edit the supplied current marketing poster/);
});
