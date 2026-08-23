import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTaskService } from "../server/task-service.mjs";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
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
  const service = createTaskService({ provider, runtimeDir, logger: { error() {} }, taskTimeoutMs: 30000 });
  await service.init();

  const request = {
    prompt: "生成七夕袋鼠海报",
    brandAsset: "brand-kangaroo",
    generationType: "text-to-image",
    ratio: "9:16",
    size: "1080x1920",
    styles: ["品牌官方"],
    imageCount: 2,
    resourceSlots: [
      { width: 1080, height: 1920, label: "竖版" },
      { width: 1080, height: 1920, label: "竖版2" }
    ],
    referenceImages: [],
    sessionId: null
  };
  const submitted = await service.submit(request, "http://localhost:4173");
  assert.equal(submitted._action, "submitted");
  const early = service.poll(submitted);
  assert.ok(["display", "show_images"].includes(early._action));
  const done = await waitForDone(service, submitted, 10000);
  assert.equal(done._action, "notify_done");
  assert.equal(done.images.length, 2);
  assert.ok(done.images.every((image) => /\/generated\//.test(image.url)));

  const adjusted = await service.submit(
    {
      ...request,
      prompt: "把袋鼠改成双手比心",
      generationType: "image-edit",
      imageCount: 1,
      resourceSlots: undefined,
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

test("task service fits multi-select resource slots to exact pixel sizes", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "marketing-slot-fit-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));

  const { imageDimensions } = await import("../server/image-utils.mjs");
  const { readFile } = await import("node:fs/promises");

  const provider = {
    name: "fake-real-provider",
    async generate() {
      // 64x32 stand-in for model output (wrong aspect / size vs slots)
      const script = `
from PIL import Image
import sys
Image.new("RGB", (64, 32), (10, 20, 30)).save(sys.stdout.buffer, "PNG")
`;
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("python3", ["-c", script], { maxBuffer: 1024 * 1024 });
      if (result.status !== 0) throw new Error("png gen failed");
      return { buffer: result.stdout, mime: "image/png", model: "fake" };
    }
  };

  const service = createTaskService({ provider, runtimeDir, logger: { error() {} }, taskTimeoutMs: 10000 });
  await service.init();

  const submitted = await service.submit(
    {
      prompt: "banner set",
      size: "1080x1920",
      resourceSlots: [
        { width: 1080, height: 1920, label: "竖版海报" },
        { width: 1200, height: 300, label: "横幅" }
      ],
      styles: [],
      referenceImages: [],
      sessionId: null
    },
    "http://localhost:4173"
  );

  const done = await waitForDone(service, submitted, 15000);
  assert.equal(done._action, "notify_done");
  assert.equal(done.images.length, 2);
  assert.equal(done.images[0].size, "1080x1920");
  assert.equal(done.images[1].size, "1200x300");

  for (const [i, expected] of [
    [0, { width: 1080, height: 1920 }],
    [1, { width: 1200, height: 300 }]
  ]) {
    const urlPath = done.images[i].url.replace(/^https?:\/\/[^/]+/, "");
    const filePath = join(runtimeDir, urlPath.replace(/^\//, ""));
    const buf = await readFile(filePath);
    assert.deepEqual(imageDimensions(buf), expected);
  }
});
