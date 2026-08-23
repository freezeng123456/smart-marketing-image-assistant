import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { extensionForMime, fitToExactSize, imageDimensions } from "../server/image-utils.mjs";
import { pickSize } from "../server/siliconflow-provider.mjs";
import { normalizeModelSize as normalizeCloudflareModelSize } from "../server/cloudflare-provider.mjs";

test("live debug helper imports the MIME extension helper", () => {
  assert.equal(extensionForMime("image/jpeg"), "jpg");
  assert.equal(extensionForMime("image/png"), "png");
  assert.equal(extensionForMime("image/webp"), "webp");
});

test("Cloudflare output keeps the requested ratio within the configured edge", () => {
  assert.deepEqual(normalizeCloudflareModelSize("1080x1920", 496), { width: 272, height: 496 });
});

test("SiliconFlow pickSize chooses closest aspect ratio for marketing sizes", () => {
  assert.equal(pickSize("1024x1024"), "1024x1024");
  assert.equal(pickSize("768x1024"), "768x1024");
  // 1080x1920 ≈ 9:16 → closest portrait 576x1024 (0.5625) vs 768x1024 (0.75)
  assert.equal(pickSize("1080x1920"), "576x1024");
  // 1200x300 = 4:1 wide banner → closest 1024x576
  assert.equal(pickSize("1200x300"), "1024x576");
  // 1920x1080 landscape → 1024x576
  assert.equal(pickSize("1920x1080"), "1024x576");
  // square-ish
  assert.equal(pickSize("800x800"), "512x512");
  // invalid → default
  assert.equal(pickSize("nope"), "768x1024");
});

function makePng(width, height) {
  const script = `
from PIL import Image
import sys
Image.new("RGB", (int(sys.argv[1]), int(sys.argv[2])), (20, 120, 200)).save(sys.stdout.buffer, "PNG")
`;
  const result = spawnSync("python3", ["-c", script, String(width), String(height)], {
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString() || "failed to make png");
  }
  return result.stdout;
}

test("fitToExactSize cover-crops to exact slot pixels", async () => {
  const source = makePng(200, 100);
  const { buffer, mime } = await fitToExactSize(source, { width: 120, height: 40, mime: "image/png" });
  assert.equal(mime, "image/png");
  assert.deepEqual(imageDimensions(buffer), { width: 120, height: 40 });
});

test("fitToExactSize returns original when already exact or invalid", async () => {
  const source = makePng(64, 64);
  const same = await fitToExactSize(source, { width: 64, height: 64, mime: "image/png" });
  assert.equal(same.buffer, source);
  const invalid = await fitToExactSize(source, { width: 0, height: 10, mime: "image/png" });
  assert.equal(invalid.buffer, source);
});
