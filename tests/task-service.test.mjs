import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTaskService } from "../server/task-service.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7L8AAAAASUVORK5CYII=",
  "base64"
);

async function waitForDone(service, submitted, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = service.poll(submitted);
    if (["notify_done", "notify_failed", "notify_timeout"].includes(result._action)) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("task did not finish in time");
}

test("task service preserves the async submit/poll contract and session across edits", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "marketing-task-test-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const provider = {
    name: "fake-real-provider",
    async generate(request, index, { signal } = {}) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 25);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
      return { buffer: ONE_PIXEL_PNG, mime: "image/png", model: `fake-model-${index}` };
    }
  };
  const service = createTaskService({ provider, runtimeDir, logger: { error() {} }, taskTimeoutMs: 2000 });
  await service.init();

  const request = {
    prompt: "生成七夕袋鼠海报",
    brandAsset: "brand-kangaroo",
    generationType: "text-to-image",
    ratio: "9:16",
    size: "1080x1920",
    styles: ["品牌官方"],
    imageCount: 2,
    referenceImages: [],
    sessionId: null
  };
  const submitted = await service.submit(request, "http://localhost:4173");
  assert.equal(submitted._action, "submitted");
  const early = service.poll(submitted);
  assert.ok(["display", "show_images"].includes(early._action));
  const done = await waitForDone(service, submitted);
  assert.equal(done._action, "notify_done");
  assert.equal(done.images.length, 2);
  assert.ok(done.images.every((image) => image.url.startsWith("http://localhost:4173/generated/")));

  const adjusted = await service.submit(
    {
      ...request,
      prompt: "把袋鼠改成双手比心",
      generationType: "image-edit",
      imageCount: 1,
      sessionId: submitted.sessionId,
      contextImageUrl: done.images[0].url,
      parentVersion: 1
    },
    "http://localhost:4173"
  );
  assert.equal(adjusted.sessionId, submitted.sessionId);
  const adjustedDone = await waitForDone(service, adjusted);
  assert.equal(adjustedDone._action, "notify_done");
  assert.equal(adjustedDone.images.length, 1);
});

test("task service aborts a running task", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "marketing-abort-test-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const provider = {
    name: "slow-provider",
    async generate(_request, _index, { signal } = {}) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
      return { buffer: ONE_PIXEL_PNG, mime: "image/png", model: "slow" };
    }
  };
  const service = createTaskService({ provider, runtimeDir, logger: { error() {} } });
  await service.init();
  const submitted = await service.submit({ prompt: "test", imageCount: 1 }, "http://localhost:4173");
  await service.abort({ sessionId: submitted.sessionId, taskId: submitted.taskId });
  const result = service.poll(submitted);
  assert.equal(result._action, "notify_failed");
  assert.match(result.error, /取消/);
});
