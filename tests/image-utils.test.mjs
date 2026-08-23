import test from "node:test";
import assert from "node:assert/strict";
import { extensionForMime, imageDimensions } from "../server/image-utils.mjs";
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

test("imageDimensions reads PNG header width/height", () => {
  // Minimal 1x1 PNG
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea75b2a800000000049454e44ae426082",
    "hex"
  );
  assert.deepEqual(imageDimensions(png), { width: 1, height: 1 });
});
