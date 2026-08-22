import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createMarketingServer } from "../server/app-server.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7L8AAAAASUVORK5CYII=",
  "base64"
);

async function pollUntilDone(baseUrl, submitted) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/functions/poll-task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submitted)
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (payload._action === "notify_done") return payload;
    if (payload._action === "notify_failed") throw new Error(payload.error);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("integration task timed out");
}

test("HTTP server exposes submit, poll, generated image and upload endpoints", async (t) => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const runtimeDir = await mkdtemp(join(tmpdir(), "marketing-server-test-"));
  const provider = {
    name: "integration-provider",
    textModel: "integration-text",
    editModel: "integration-edit",
    fallbackModel: "integration-fallback",
    accountId: "account-test",
    async generate() {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { buffer: ONE_PIXEL_PNG, mime: "image/png", model: "integration-model" };
    }
  };
  const app = await createMarketingServer({ projectRoot, runtimeDir, port: 0, host: "127.0.0.1", provider, logger: { error() {} } });
  const address = await app.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
  });

  const health = await fetch(`${baseUrl}/functions/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.provider, "integration-provider");

  const envLeak = await fetch(`${baseUrl}/.env`);
  assert.equal(envLeak.status, 404);
  const brandAssetLeak = await fetch(`${baseUrl}/assets/brand-kangaroo.png`);
  assert.equal(brandAssetLeak.status, 404);
  const packageLeak = await fetch(`${baseUrl}/package.json`);
  assert.equal(packageLeak.status, 404);

  const submitResponse = await fetch(`${baseUrl}/functions/submit-task`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "生成七夕袋鼠海报",
      brandAsset: "brand-kangaroo",
      generationType: "text-to-image",
      ratio: "9:16",
      size: "1080x1920",
      styles: ["品牌官方"],
      imageCount: 1,
      referenceImages: [],
      sessionId: null
    })
  });
  assert.equal(submitResponse.status, 202);
  const submitted = await submitResponse.json();
  const done = await pollUntilDone(baseUrl, submitted);
  assert.equal(done.images.length, 1);
  const imageResponse = await fetch(done.images[0].url);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get("content-type"), /image\/png/);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), ONE_PIXEL_PNG);

  const form = new FormData();
  form.append("file", new Blob([ONE_PIXEL_PNG], { type: "image/png" }), "reference.png");
  const uploadResponse = await fetch(`${baseUrl}/functions/upload-reference`, { method: "POST", body: form });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  assert.equal(upload.fileName, "reference.png");
  assert.ok(upload.url.startsWith(`${baseUrl}/uploads/`));
  const uploadedImage = await fetch(upload.url);
  assert.equal(uploadedImage.status, 200);
});
