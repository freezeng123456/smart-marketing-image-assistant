import test from "node:test";
import assert from "node:assert/strict";
import { extensionForMime } from "../server/image-utils.mjs";
import { normalizeModelSize as normalizeCloudflareModelSize } from "../server/cloudflare-provider.mjs";

test("live debug helper imports the MIME extension helper", () => {
  assert.equal(extensionForMime("image/jpeg"), "jpg");
  assert.equal(extensionForMime("image/png"), "png");
  assert.equal(extensionForMime("image/webp"), "webp");
});

test("Cloudflare output keeps the requested ratio within the configured edge", () => {
  assert.deepEqual(normalizeCloudflareModelSize("1080x1920", 496), { width: 272, height: 496 });
});
