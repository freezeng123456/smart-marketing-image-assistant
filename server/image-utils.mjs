import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonChildEnv } from "./python-env.mjs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

/** Pad/fit an image onto a canvas matching target WxH (blurred cover + contain). */
export async function padBufferToAspectRatio(buffer, width, height) {
  const w = Math.max(64, Math.round(Number(width) || 720));
  const h = Math.max(64, Math.round(Number(height) || 1280));
  const dir = await mkdtemp(join(tmpdir(), "pad-aspect-"));
  try {
    const inputPath = join(dir, "in.png");
    const outputPath = join(dir, "out.png");
    await writeFile(inputPath, buffer);
    const scriptPath = fileURLToPath(new URL("./pad-aspect.py", import.meta.url));
    await execFileAsync("python3", [scriptPath, inputPath, outputPath, String(w), String(h)], {
      env: pythonChildEnv(),
      maxBuffer: 20 * 1024 * 1024
    });
    const out = await readFile(outputPath);
    return { buffer: out, mime: "image/png", width: w, height: h };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

