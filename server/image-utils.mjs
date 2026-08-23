import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { pythonChildEnv } from "./python-env.mjs";

const execFileAsync = promisify(execFile);

export const WANX_EDIT_MIN_EDGE = 512;
export const WANX_EDIT_MAX_EDGE = 4096;
export const WANX_EDIT_MAX_BYTES = 10 * 1024 * 1024;

export function inferImageMime(buffer, fallback = "image/jpeg") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return fallback;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return fallback;
}

export function mimeFromFileName(fileName = "") {
  const extension = extname(String(fileName)).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

export function imageFileName(index = 0, mime = "image/jpeg") {
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `image-${Number(index) + 1}.${extension}`;
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || inferImageMime(buffer, "") !== "image/png") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if ([0xd8, 0xd9].includes(marker)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || inferImageMime(buffer, "") !== "image/webp") return null;
  const kind = buffer.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }
  return null;
}

export function imageDimensions(buffer) {
  return pngDimensions(buffer) || jpegDimensions(buffer) || webpDimensions(buffer);
}

export function extensionForMime(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * FLUX.2 Klein accepts reference images up to roughly 512×512. Browser uploads
 * are already resized client-side; this server-side path is a defensive fallback.
 * It uses ImageMagick only when an oversized image actually needs conversion.
 */
export async function resizeForReference(buffer, { mime = inferImageMime(buffer), maxEdge = 512 } = {}) {
  const dimensions = imageDimensions(buffer);
  if (!dimensions || Math.max(dimensions.width, dimensions.height) <= maxEdge) {
    return { buffer, mime };
  }

  const directory = await mkdtemp(join(tmpdir(), "marketing-reference-"));
  const input = join(directory, `input.${extensionForMime(mime)}`);
  const output = join(directory, "output.png");
  const binary = process.env.IMAGEMAGICK_BIN || "magick";
  try {
    await writeFile(input, buffer);
    await execFileAsync(binary, [input, "-auto-orient", "-resize", `${maxEdge}x${maxEdge}>`, "-strip", output], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    return { buffer: await readFile(output), mime: "image/png" };
  } catch (error) {
    const wrapped = new Error(
      `参考图尺寸 ${dimensions.width}×${dimensions.height} 超过模型限制，且服务端无法缩放。请通过页面重新上传，浏览器会自动压缩到 ${maxEdge}px。`,
      { cause: error }
    );
    wrapped.status = 422;
    throw wrapped;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}


/**
 * wanx2.1-imageedit requires each edge in [minEdge, maxEdge] and payload under maxBytes.
 * Scale UP so min(w,h) >= minEdge (bilinear), then scale DOWN so max(w,h) <= maxEdge.
 * Preserves aspect ratio. Uses vendored Pillow (no new Node deps). Output untouched by callers.
 */
export async function ensureWanxEditInputSize(
  buffer,
  {
    minEdge = WANX_EDIT_MIN_EDGE,
    maxEdge = WANX_EDIT_MAX_EDGE,
    maxBytes = WANX_EDIT_MAX_BYTES,
    mime = inferImageMime(buffer, "image/png")
  } = {}
) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error("Empty image buffer for wanx input."), { status: 422 });
  }

  const dimensions = imageDimensions(buffer);
  const minDim = dimensions ? Math.min(dimensions.width, dimensions.height) : 0;
  const maxDim = dimensions ? Math.max(dimensions.width, dimensions.height) : 0;
  const withinEdges =
    dimensions && minDim >= minEdge && maxDim <= maxEdge && buffer.length <= maxBytes;
  if (withinEdges) {
    return {
      buffer,
      mime,
      width: dimensions.width,
      height: dimensions.height,
      resized: false
    };
  }

  const directory = await mkdtemp(join(tmpdir(), "wanx-input-"));
  const inputExt = extensionForMime(mime);
  const input = join(directory, `input.${inputExt}`);
  const output = join(directory, "output.png");
  const script = join(directory, "resize.py");
  try {
    await writeFile(input, buffer);
    await writeFile(
      script,
      `from PIL import Image
import sys
inp, outp = sys.argv[1], sys.argv[2]
min_edge = int(sys.argv[3])
max_edge = int(sys.argv[4])
max_bytes = int(sys.argv[5])
im = Image.open(inp)
im.load()
if im.mode not in ("RGB", "RGBA"):
    im = im.convert("RGBA")
w, h = im.size
scale = 1.0
short = min(w, h)
if short < min_edge:
    scale = max(scale, min_edge / float(short))
nw = max(1, int(round(w * scale)))
nh = max(1, int(round(h * scale)))
if max(nw, nh) > max_edge:
    down = max_edge / float(max(nw, nh))
    nw = max(1, int(round(nw * down)))
    nh = max(1, int(round(nh * down)))
# Clamp each edge into range while keeping ratio as best-effort (extreme ratios)
nw = max(1, min(max_edge, nw))
nh = max(1, min(max_edge, nh))
if (nw, nh) != (w, h):
    # Bilinear upscale / downscale; nearest would also be fine for hard edges
    resample = Image.Resampling.BILINEAR if max(nw, nh) >= max(w, h) else Image.Resampling.LANCZOS
    im = im.resize((nw, nh), resample)
# Prefer PNG; if over maxBytes, fall back to JPEG
if im.mode in ("RGBA", "LA"):
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[-1])
    rgb = bg
else:
    rgb = im.convert("RGB")
rgb.save(outp, "PNG", optimize=True)
import os
if os.path.getsize(outp) > max_bytes:
    q = 90
    while q >= 40:
        rgb.save(outp, "JPEG", quality=q, optimize=True)
        if os.path.getsize(outp) <= max_bytes:
            break
        q -= 10
`
    );
    const result = spawnSync(
      "python3",
      [script, input, output, String(minEdge), String(maxEdge), String(maxBytes)],
      { encoding: "utf8", env: pythonChildEnv(), timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "wanx input resize failed");
    }
    const outBuffer = await readFile(output);
    const outMime = inferImageMime(outBuffer, "image/png");
    const outDims = imageDimensions(outBuffer) || { width: 0, height: 0 };
    if (outBuffer.length > maxBytes) {
      throw Object.assign(
        new Error(`参考图压缩后仍超过 ${Math.floor(maxBytes / (1024 * 1024))}MB，请换更小的图片。`),
        { status: 422 }
      );
    }
    if (outDims.width < minEdge || outDims.height < minEdge) {
      throw Object.assign(
        new Error(
          `参考图缩放后仍小于 ${minEdge}px（${outDims.width}×${outDims.height}），请换更大的图片。`
        ),
        { status: 422 }
      );
    }
    if (outDims.width > maxEdge || outDims.height > maxEdge) {
      throw Object.assign(
        new Error(
          `参考图缩放后仍超过 ${maxEdge}px（${outDims.width}×${outDims.height}）。`
        ),
        { status: 422 }
      );
    }
    return {
      buffer: outBuffer,
      mime: outMime,
      width: outDims.width,
      height: outDims.height,
      resized: true
    };
  } catch (error) {
    if (error.status) throw error;
    const wrapped = new Error(
      dimensions
        ? `参考图尺寸 ${dimensions.width}×${dimensions.height} 不符合 wanx 要求（边长 ${minEdge}–${maxEdge}px），且服务端无法缩放：${error.message}`
        : `参考图不符合 wanx 尺寸要求，且服务端无法缩放：${error.message}`,
      { cause: error }
    );
    wrapped.status = 422;
    throw wrapped;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
