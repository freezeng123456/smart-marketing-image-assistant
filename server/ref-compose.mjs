import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inferImageMime } from "./image-utils.mjs";
import { shouldUseBrandKangaroo } from "./brand-policy.mjs";
import { pythonChildEnv } from "./python-env.mjs";

const BRAND_SIDE_PATH = fileURLToPath(new URL("../assets/brand-ip/side-profile-clean.png", import.meta.url));
const BRAND_STAND_PATH = fileURLToPath(new URL("../assets/brand-ip/meituan-stand-official.png", import.meta.url));
const BRAND_PRIMARY_PATH = fileURLToPath(new URL("../assets/brand-kangaroo.png", import.meta.url));

export async function loadBrandBuffer() {
  for (const path of [BRAND_SIDE_PATH, BRAND_PRIMARY_PATH, BRAND_STAND_PATH]) {
    try {
      const buffer = await readFile(path);
      return { buffer, mime: inferImageMime(buffer, "image/png"), path };
    } catch {
      // try next
    }
  }
  return null;
}

export function toDataUri(buffer, mimeHint = "") {
  const mime = /^image\//.test(mimeHint) ? mimeHint : inferImageMime(buffer, "image/png");
  return `data:${mime};base64,${buffer.toString("base64")}`;
}


/** Place brand kangaroo on a bright warm marketing plate so img2img does not inherit white/black voids. */
export async function plateBrandOnWarmBackdrop(brandBuffer, { size = 1024 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "brand-plate-"));
  try {
    const brandPath = join(dir, "brand.png");
    const outPath = join(dir, "out.png");
    await writeFile(brandPath, brandBuffer);
    const scriptPath = fileURLToPath(new URL("./brand-plate.py", import.meta.url));
    const result = spawnSync("python3", [scriptPath, brandPath, outPath, String(size)], { encoding: "utf8", env: pythonChildEnv() });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "brand plate failed");
    const buffer = await readFile(outPath);
    return { buffer, mime: "image/png" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Side-by-side collage: brand IP left, scene/product refs right. Single-image APIs can still "see" both. */
export async function composeBrandAndSceneCollage(brandBuffer, sceneBuffers, { maxEdge = 1024 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ref-compose-"));
  try {
    const brandPath = join(dir, "brand.png");
    await writeFile(brandPath, brandBuffer);
    const scenePaths = [];
    for (const [i, buf] of sceneBuffers.slice(0, 2).entries()) {
      const p = join(dir, `scene-${i}.png`);
      await writeFile(p, buf);
      scenePaths.push(p);
    }
    const outPath = join(dir, "out.png");
    const script = `
from PIL import Image
import sys
max_edge = ${Number(maxEdge) || 1024}
paths = sys.argv[1:-1]
out = sys.argv[-1]
imgs = []
for p in paths:
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    imgs.append(im)
if not imgs:
    raise SystemExit("no images")
# brand left, scenes stacked on the right
brand = imgs[0]
scenes = imgs[1:] or [brand]
right_h = sum(s.height for s in scenes) + max(0, len(scenes) - 1) * 8
right_w = max(s.width for s in scenes)
canvas = Image.new("RGBA", (brand.width + 8 + right_w, max(brand.height, right_h)), (255, 255, 255, 255))
canvas.paste(brand, (0, (canvas.height - brand.height) // 2), brand)
y = 0
for s in scenes:
    canvas.paste(s, (brand.width + 8, y), s)
    y += s.height + 8
# Flatten any remaining alpha onto white
flat = Image.new("RGBA", canvas.size, (255, 255, 255, 255))
flat = Image.alpha_composite(flat, canvas)
flat.convert("RGB").save(out, "PNG", optimize=True)
`;
    const py = join(dir, "compose.py");
    await writeFile(py, script);
    const result = spawnSync("python3", [py, brandPath, ...scenePaths, outPath], { encoding: "utf8", env: pythonChildEnv() });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "collage failed");
    }
    const buffer = await readFile(outPath);
    return { buffer, mime: "image/png" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Resolve img2img payload for single-slot APIs:
 * - brand only → brand data URI
 * - brand + user refs → collage (brand left, scene right) so both are visible
 * Also returns discrete data URIs for multi-image APIs.
 */
export async function resolveBrandAndUserRefs(request, { loadImageSource, signal, logger } = {}) {
  const useBrand = shouldUseBrandKangaroo(request);
  const userSources = Array.isArray(request.referenceImages) ? request.referenceImages.filter(Boolean) : [];
  const userLoaded = [];
  if (userSources.length && typeof loadImageSource === "function") {
    for (const source of userSources.slice(0, 2)) {
      try {
        const loaded = await loadImageSource(source, { signal });
        userLoaded.push(loaded);
      } catch (error) {
        logger?.warn?.(`[refs] user reference skipped: ${error.message}`);
      }
    }
  }

  if (userSources.length && !userLoaded.length) {
    logger?.warn?.(`[refs] all ${userSources.length} user reference(s) failed to load`);
  }

  let brand = null;
  if (useBrand) brand = await loadBrandBuffer();

  const brandUri = brand ? toDataUri(brand.buffer, brand.mime) : null;
  const userUris = userLoaded.map((u) => toDataUri(u.buffer, u.mime));

  let singleImageUri = brandUri || userUris[0] || null;
  let mode = brandUri ? (userUris.length ? "brand+user-collage" : "brand-only") : userUris.length ? "user-only" : "none";

  if (brand && !userLoaded.length) {
    try {
      const plated = await plateBrandOnWarmBackdrop(brand.buffer, { size: 1024 });
      singleImageUri = toDataUri(plated.buffer, plated.mime);
      mode = "brand-warm-plate";
    } catch (error) {
      logger?.warn?.(`[refs] brand warm plate failed: ${error.message}`);
    }
  }

  if (brand && userLoaded.length) {
    try {
      const collage = await composeBrandAndSceneCollage(
        brand.buffer,
        userLoaded.map((u) => u.buffer)
      );
      singleImageUri = toDataUri(collage.buffer, collage.mime);
    } catch (error) {
      logger?.warn?.(`[refs] collage failed, brand-only: ${error.message}`);
      mode = "brand-only-fallback";
      singleImageUri = brandUri;
    }
  }

  return {
    brandUri,
    userUris,
    singleImageUri,
    userCount: userLoaded.length,
    mode,
    multiImageUris: [brandUri, ...userUris].filter(Boolean).slice(0, 3)
  };
}

export function sceneRefPromptHint(userCount, { collage = false, hasBrand = false } = {}) {
  if (!userCount) return "";
  if (hasBrand && collage) {
    return `Reference layout: LEFT panel is the brand Meituan yellow kangaroo IP (keep identity). RIGHT panel(s) are uploaded scene/product/composition references — incorporate their product, props, lighting, and composition into the poster while keeping the kangaroo IP from the left.`;
  }
  if (hasBrand) {
    return `Additional uploaded reference image(s) (${userCount}): keep brand kangaroo identity from the brand reference; treat uploaded image(s) as scene/product/composition only.`;
  }
  return `Uploaded reference image(s) (${userCount}): use as scene/product/composition guidance for the poster. Follow the user brief only; do not add any unrelated brand mascot.`;
}
