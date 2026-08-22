import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createImageSourceLoader } from "../server/source-loader.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7L8AAAAASUVORK5CYII=",
  "base64"
);

test("image source loader blocks file URLs outside project runtime", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "marketing-project-"));
  const runtimeDir = join(projectRoot, ".runtime");
  const outsideDir = await mkdtemp(join(tmpdir(), "marketing-outside-"));
  await mkdir(join(runtimeDir, "generated"), { recursive: true });
  await mkdir(join(runtimeDir, "uploads"), { recursive: true });
  const outside = join(outsideDir, "secret.png");
  await writeFile(outside, PNG);
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  const load = createImageSourceLoader({ projectRoot, runtimeDir });
  await assert.rejects(() => load(pathToFileURL(outside).href), /outside the project runtime/i);
});
