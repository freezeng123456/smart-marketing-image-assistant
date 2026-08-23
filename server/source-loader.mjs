import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inferImageMime, mimeFromFileName } from "./image-utils.mjs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function safeJoin(root, pathname) {
  const candidate = normalize(join(root, pathname));
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return candidate;
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (["localhost", "::1", "0.0.0.0"].includes(host) || host.endsWith(".local")) return true;
  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [, a, b] = match.map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}


function isAllowedLocalPath(path, roots) {
  const normalized = normalize(path);
  return roots.some((root) => {
    const rel = relative(normalize(root), normalized);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

function decodeDataUri(uri) {
  const match = String(uri).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  if (!match) throw new Error("Unsupported image data URI.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error("Reference image is empty or too large.");
  return { buffer, mime: match[1] };
}

export function createImageSourceLoader({ projectRoot, runtimeDir, fetchImpl = globalThis.fetch } = {}) {
  const generatedDir = join(runtimeDir, "generated");
  const uploadsDir = join(runtimeDir, "uploads");

  async function readChecked(path, mime = mimeFromFileName(path)) {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new Error("Reference image is missing or exceeds 10MB.");
    const buffer = await readFile(path);
    return { buffer, mime: /^image\//.test(mime) ? mime : inferImageMime(buffer) };
  }

  return async function loadImageSource(source, { signal } = {}) {
    // Clients may pass a string URL or an upload/demo object { url, previewUrl }.
    const raw =
      source && typeof source === "object"
        ? String(source.url || source.previewUrl || source.href || "").trim()
        : String(source || "").trim();
    if (!raw) throw new Error("Reference image URL is empty.");
    if (raw.startsWith("data:image/")) return decodeDataUri(raw);
    // Cache-busting query (?v=6) must not become part of the filesystem path.
    const value = raw.split("#")[0].split("?")[0].trim();
    if (!value) throw new Error("Reference image URL is empty.");
    const allowedRoots = [projectRoot, runtimeDir];
    if (value.startsWith("file:")) {
      const path = fileURLToPath(value);
      if (!isAllowedLocalPath(path, allowedRoots)) {
        throw new Error("Local reference path is outside the project runtime.");
      }
      return readChecked(path);
    }
    // App-relative URLs like /uploads/… and /generated/… are NOT OS absolute paths.
    if (value.startsWith("/uploads/")) {
      const path = safeJoin(uploadsDir, value.slice("/uploads/".length));
      if (!path) throw new Error("Uploaded image path is invalid.");
      return readChecked(path);
    }
    if (value.startsWith("/generated/")) {
      const path = safeJoin(generatedDir, value.slice("/generated/".length));
      if (!path) throw new Error("Generated image path is invalid.");
      return readChecked(path);
    }
    if (value.startsWith("/assets/")) {
      const path = safeJoin(projectRoot, value.slice(1));
      if (!path) throw new Error("Asset image path is invalid.");
      return readChecked(path);
    }
    if (isAbsolute(value)) {
      if (!isAllowedLocalPath(value, allowedRoots)) {
        throw new Error("Local reference path is outside the project runtime.");
      }
      return readChecked(normalize(value));
    }

    let url;
    try {
      // Keep query for remote fetch; local path branches above already use stripped value.
      url = new URL(raw, "http://local.invalid");
    } catch {
      throw new Error("Reference image URL is invalid.");
    }
    const pathname = decodeURIComponent(url.pathname).split("?")[0];
    if (pathname.startsWith("/generated/")) {
      const path = safeJoin(generatedDir, pathname.slice("/generated/".length));
      if (!path) throw new Error("Generated image path is invalid.");
      return readChecked(path);
    }
    if (pathname.startsWith("/uploads/")) {
      const path = safeJoin(uploadsDir, pathname.slice("/uploads/".length));
      if (!path) throw new Error("Uploaded image path is invalid.");
      return readChecked(path);
    }

    if (!/^https?:$/.test(url.protocol)) throw new Error("Only HTTPS reference image URLs are supported.");
    if (isPrivateHost(url.hostname)) throw new Error("Private-network reference URLs are not allowed.");
    const response = await fetchImpl(url, {
      headers: { Accept: "image/png,image/jpeg,image/webp" },
      redirect: "follow",
      signal
    });
    if (!response.ok) throw new Error(`Unable to fetch reference image (${response.status}).`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 10MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error("Reference image is empty or exceeds 10MB.");
    const declared = (response.headers.get("content-type") || "").split(";")[0];
    const mime = /^image\/(png|jpeg|webp)$/i.test(declared) ? declared : inferImageMime(buffer, "");
    if (!mime) throw new Error("Reference URL did not return a supported image.");
    return { buffer, mime };
  };
}
