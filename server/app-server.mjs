import http from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { createCloudflareProvider } from "./cloudflare-provider.mjs";
import { createPollinationsProvider, createFailoverProvider } from "./pollinations-provider.mjs";
import { createFalProvider } from "./fal-provider.mjs";
import { createSiliconFlowProvider } from "./siliconflow-provider.mjs";
import { createHuggingFaceProvider } from "./huggingface-provider.mjs";
import { mimeFromFileName } from "./image-utils.mjs";
import { createImageSourceLoader } from "./source-loader.mjs";
import { createTaskService } from "./task-service.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const MAX_JSON_BYTES = 256 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PUBLIC_ROOT_FILES = new Set(["index.html", "styles.css", "config.js"]);
const PUBLIC_DIRECTORIES = ["src/", "mock/"];

function publicStaticRequest(pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const segments = requested.split("/");
  if (segments.some((segment) => !segment || segment.startsWith("."))) return null;
  if (PUBLIC_ROOT_FILES.has(requested)) return requested;
  if (PUBLIC_DIRECTORIES.some((prefix) => requested.startsWith(prefix))) return requested;
  // Client-side routes fall back to index.html, but arbitrary files are never exposed.
  if (!requested.includes(".")) return "index.html";
  return null;
}


function safePath(root, pathname) {
  const candidate = normalize(join(root, pathname));
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) return null;
  return candidate;
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) throw Object.assign(new Error("JSON request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON request."), { status: 400 });
  }
}

function publicOrigin(request, fallbackPort) {
  const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || request.headers.host || `localhost:${fallbackPort}`;
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (/^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

function sanitizeFileName(name = "reference") {
  return String(name)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "reference";
}

async function serveFile(response, path, { cache = false } = {}) {
  const info = await stat(path);
  if (!info.isFile()) throw Object.assign(new Error("Not found"), { status: 404 });
  response.writeHead(200, {
    "Content-Type": MIME[extname(path).toLowerCase()] || mimeFromFileName(path),
    "Content-Length": info.size,
    "Cache-Control": cache ? "public, max-age=31536000, immutable" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  createReadStream(path).pipe(response);
}

async function parseUpload(request, origin) {
  const webRequest = new Request(new URL(request.url || "/", origin), {
    method: request.method,
    headers: request.headers,
    body: request,
    duplex: "half"
  });
  const form = await webRequest.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw Object.assign(new Error("Missing multipart file field: file"), { status: 400 });
  }
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    throw Object.assign(new Error("Only PNG, JPG, JPEG and WEBP images are supported."), { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error("Each reference image must be between 1 byte and 10MB."), { status: 413 });
  }
  return {
    fileName: sanitizeFileName(file.name),
    type: file.type,
    size: file.size,
    buffer: Buffer.from(await file.arrayBuffer())
  };
}

function validateSubmit(body) {
  if (!String(body?.prompt || "").trim()) {
    throw Object.assign(new Error("请先描述你想生成的营销素材。"), { status: 400 });
  }
  const count = Number(body.imageCount || 1);
  if (![1, 2, 4].includes(count)) {
    throw Object.assign(new Error("imageCount must be 1, 2 or 4."), { status: 400 });
  }
  return {
    ...body,
    prompt: String(body.prompt),
    imageCount: count,
    referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages.slice(0, 4) : [],
    styles: Array.isArray(body.styles) ? body.styles.slice(0, 3) : []
  };
}

export async function createMarketingServer({
  projectRoot,
  port = Number(process.env.PORT || 4173),
  host = "0.0.0.0",
  provider = null,
  logger = console,
  runtimeDir = join(projectRoot, ".runtime")
} = {}) {
  if (!projectRoot) throw new Error("projectRoot is required.");
  const generatedDir = join(runtimeDir, "generated");
  const uploadsDir = join(runtimeDir, "uploads");
  await Promise.all([
    mkdir(generatedDir, { recursive: true }),
    mkdir(uploadsDir, { recursive: true })
  ]);

  const loadImageSource = createImageSourceLoader({ projectRoot, runtimeDir });
  let activeProvider = provider;
  let providerError = null;
  function buildFallbackChain(logger) {
    const providers = [];
    if (process.env.SILICONFLOW_API_KEY) {
      try { providers.push(createSiliconFlowProvider({ logger })); } catch (e) { logger.warn?.(`[provider] siliconflow skipped: ${e.message}`); }
    }
    if (process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY) {
      try { providers.push(createHuggingFaceProvider({ logger })); } catch (e) { logger.warn?.(`[provider] huggingface skipped: ${e.message}`); }
    }
    if (process.env.FAL_KEY) {
      try { providers.push(createFalProvider({ logger })); } catch (e) { logger.warn?.(`[provider] fal skipped: ${e.message}`); }
    }
    try { providers.push(createPollinationsProvider({ logger })); } catch (e) { logger.warn?.(`[provider] pollinations skipped: ${e.message}`); }
    if (!providers.length) return null;
    return providers.reduceRight((fallback, primary) =>
      fallback ? createFailoverProvider({ primary, fallback, logger }) : primary
    );
  }

  if (!activeProvider && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    try {
      const cloudflare = createCloudflareProvider({ loadImageSource, logger });
      const fallback = buildFallbackChain(logger);
      activeProvider = !fallback || process.env.DISABLE_POLLINATIONS_FALLBACK === "1"
        ? cloudflare
        : createFailoverProvider({ primary: cloudflare, fallback, logger });
    } catch (error) {
      providerError = error;
    }
  }
  if (!activeProvider) {
    try {
      activeProvider = buildFallbackChain(logger);
    } catch (error) {
      providerError = providerError || error;
    }
  }
  const taskService = activeProvider
    ? createTaskService({ provider: activeProvider, runtimeDir, logger })
    : null;
  await taskService?.init();

  const server = http.createServer(async (request, response) => {
    const method = request.method || "GET";
    const origin = publicOrigin(request, port);
    const url = new URL(request.url || "/", origin);
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (method === "GET" && pathname === "/functions/health") {
        writeJson(response, activeProvider ? 200 : 503, {
          ok: Boolean(activeProvider),
          provider: activeProvider?.name || null,
          error: providerError?.message || (!activeProvider ? "Cloudflare credentials are not configured on the server." : null)
        });
        return;
      }

      if (pathname.startsWith("/functions/")) {
        if (method !== "POST") {
          writeJson(response, 405, { error: "Method not allowed" });
          return;
        }
        if (!taskService) {
          writeJson(response, 503, {
            error: providerError?.message || "Real image backend is not configured. Set server-side Cloudflare credentials."
          });
          return;
        }

        if (pathname === "/functions/submit-task") {
          const body = validateSubmit(await readJson(request));
          writeJson(response, 202, await taskService.submit(body, origin));
          return;
        }
        if (pathname === "/functions/poll-task") {
          writeJson(response, 200, taskService.poll(await readJson(request)));
          return;
        }
        if (pathname === "/functions/abort-task") {
          writeJson(response, 200, await taskService.abort(await readJson(request)));
          return;
        }
        if (pathname === "/functions/upload-reference") {
          const upload = await parseUpload(request, origin);
          const id = crypto.randomUUID();
          const ext = upload.type === "image/png" ? ".png" : upload.type === "image/webp" ? ".webp" : ".jpg";
          const storedName = `${id}${ext}`;
          await writeFile(join(uploadsDir, storedName), upload.buffer);
          writeJson(response, 201, {
            url: new URL(`/uploads/${storedName}`, origin).href,
            fileName: upload.fileName,
            size: upload.size
          });
          return;
        }
        writeJson(response, 404, { error: "Unknown Function endpoint." });
        return;
      }

      if (method === "GET" && pathname.startsWith("/generated/")) {
        const path = safePath(generatedDir, pathname.slice("/generated/".length));
        if (!path) throw Object.assign(new Error("Forbidden"), { status: 403 });
        await serveFile(response, path, { cache: true });
        return;
      }
      if (method === "GET" && pathname.startsWith("/uploads/")) {
        const path = safePath(uploadsDir, pathname.slice("/uploads/".length));
        if (!path) throw Object.assign(new Error("Forbidden"), { status: 403 });
        await serveFile(response, path, { cache: true });
        return;
      }

      if (!["GET", "HEAD"].includes(method)) {
        writeJson(response, 405, { error: "Method not allowed" });
        return;
      }
      const requested = publicStaticRequest(pathname);
      if (!requested) throw Object.assign(new Error("Not found"), { status: 404 });
      const path = safePath(projectRoot, requested);
      if (!path) throw Object.assign(new Error("Forbidden"), { status: 403 });
      await serveFile(response, path);
    } catch (error) {
      const status = Number(error?.status || 500);
      logger.error?.("[server]", error);
      writeJson(response, status, {
        error: status >= 500 ? error?.message || "Internal server error" : error?.message
      });
    }
  });

  return {
    server,
    provider: activeProvider,
    taskService,
    runtimeDir,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      return { host, port: actualPort };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}
