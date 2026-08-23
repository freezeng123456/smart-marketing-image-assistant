import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inferImageMime, resizeForReference } from "./image-utils.mjs";
import { shouldUseBrandKangaroo, BRAND_KANGAROO_CONSTRAINT_SHORT } from "./brand-policy.mjs";
import { aspectPromptFromRequest, resolveAspectRatio, sizeForAspectRatio } from "./aspect-ratio.mjs";

const DEFAULT_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_TEXT_MODEL = "@cf/black-forest-labs/flux-2-dev";
const DEFAULT_EDIT_MODEL = "@cf/black-forest-labs/flux-2-dev";
const DEFAULT_FALLBACK_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const BRAND_KANGAROO_PATH = fileURLToPath(new URL("../assets/brand-kangaroo.png", import.meta.url));
const BRAND_KANGAROO_EXTRA_PATHS = [
  fileURLToPath(new URL("../assets/brand-ip/meituan-stand-official.png", import.meta.url)),
  fileURLToPath(new URL("../assets/brand-ip/side-profile-clean.png", import.meta.url))
];

function isAuditMessage(value) {
  return /audit|moderation|unsafe|safety|content.?filter|policy violation|审核|违规/i.test(String(value || ""));
}

function fallbackEligible(error) {
  if (error?.auditFailed || isAuditMessage(error?.message)) return false;
  const status = Number(error?.status);
  const message = String(error?.message || "");
  if (status === 401) return false;
  if (status === 403 && /token|authentication|authorization|permission|credentials?/i.test(message)) return false;
  if ([402, 403, 404, 429].includes(status)) return true;
  return /model.*(not found|unavailable|access)|partner|billing|credit|quota|entitlement/i.test(message);
}

export class CloudflareApiError extends Error {
  constructor(message, { status = 0, code = "", payload = null, model = "" } = {}) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.model = model;
    this.auditFailed = isAuditMessage(message);
  }
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundTo16(value) {
  return Math.max(256, Math.round(value / 16) * 16);
}

export function normalizeModelSize(
  size = "1024x1024",
  maxEdge = Number(process.env.CLOUDFLARE_OUTPUT_MAX_DIMENSION || 496)
) {
  const match = String(size).match(/(\d+)\s*[x×]\s*(\d+)/i);
  let width = toPositiveInt(match?.[1], 1024);
  let height = toPositiveInt(match?.[2], 1024);
  const limit = Math.max(256, Math.min(1920, Number(maxEdge) || 496));
  const scale = Math.min(1, limit / Math.max(width, height));
  width = roundTo16(width * scale);
  height = roundTo16(height * scale);
  if (Math.max(width, height) > limit) {
    const secondScale = limit / Math.max(width, height);
    width = roundTo16(width * secondScale);
    height = roundTo16(height * secondScale);
  }
  return {
    width: Math.max(256, Math.min(limit, width)),
    height: Math.max(256, Math.min(limit, height))
  };
}

function structuredPrompt(request, { hasCurrent = false, hasBrandIp = false, brandIpCount = 0, userReferenceCount = 0 } = {}) {
  const styles = Array.isArray(request.styles) && request.styles.length
    ? request.styles.join(", ")
    : "commercial marketing";
  const isAdjustment = Boolean(request.sessionId || request.generationType === "image-edit");
  const original = String(request.prompt || "").trim();
  const imageMap = [];
  if (hasCurrent) imageMap.push("image 0 is the current poster to edit");
  if (hasBrandIp) {
    const startIdx = hasCurrent ? 1 : 0;
    imageMap.push(
      `image ${startIdx}${brandIpCount > 1 ? ` through image ${startIdx + brandIpCount - 1}` : ""} is the approved Meituan yellow kangaroo IP — keep this exact character`
    );
  }
  if (userReferenceCount) {
    imageMap.push(`${userReferenceCount} more image(s) are scene or product references`);
  }

  const subjectGuidance = hasBrandIp
    ? BRAND_KANGAROO_CONSTRAINT_SHORT
    : "Follow the user prompt for the main subject.";

  if (isAdjustment) {
    return [
      "Edit the current marketing poster.",
      imageMap.length ? `References: ${imageMap.join("; ")}.` : "",
      `Adjustment: ${original}`,
      subjectGuidance,
      aspectPromptFromRequest(request),
    `Styles: ${styles}.`,
      "Keep campaign theme and unaffected details; full-bleed commercial poster."
    ].filter(Boolean).join("\n").slice(0, 4000);
  }

  return [
    `Brief: ${original}`,
    imageMap.length ? `References: ${imageMap.join("; ")}.` : "",
    subjectGuidance,
    aspectPromptFromRequest(request),
    `Styles: ${styles}.`,
    "Full-bleed commercial marketing poster; clear subject; space for title if needed."
  ].filter(Boolean).join("\n").slice(0, 4000);
}

function parseCloudflareError(payload, status, model) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const first = errors[0] || payload?.error || payload;
  const message = first?.message || first?.detail || payload?.message || `Cloudflare Workers AI request failed (${status})`;
  const code = String(first?.code || payload?.code || "");
  return new CloudflareApiError(message, { status, code, payload, model });
}

function decodeImageString(value) {
  const text = String(value || "");
  const match = text.match(/^data:image\/[^;]+;base64,(.+)$/s);
  return Buffer.from(match ? match[1] : text, "base64");
}

async function parseImageResponse(response, model, actualPrompt) {
  const contentType = response.headers.get("content-type") || "";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (/json/i.test(contentType) || bytes.subarray(0, 1).toString() === "{") {
    let payload;
    try {
      payload = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new CloudflareApiError("Cloudflare returned invalid JSON.", {
        status: response.status,
        payload: bytes.toString("utf8").slice(0, 1000),
        model
      });
    }
    if (!response.ok || payload?.success === false) throw parseCloudflareError(payload, response.status, model);
    const result = payload?.result ?? payload;
    const image = result?.image || result?.dataURI || result?.data_uri || result?.images?.[0]?.image;
    if (!image || typeof image !== "string") {
      throw new CloudflareApiError("Cloudflare response did not contain result.image.", {
        status: response.status,
        payload,
        model
      });
    }
    const buffer = decodeImageString(image);
    if (!buffer.length) throw new CloudflareApiError("Cloudflare returned an empty image.", { status: response.status, payload, model });
    return { buffer, mime: inferImageMime(buffer, "image/jpeg"), model, prompt: actualPrompt, raw: payload };
  }
  if (!response.ok) {
    throw new CloudflareApiError(bytes.toString("utf8") || `Cloudflare request failed (${response.status})`, {
      status: response.status,
      payload: bytes.toString("utf8").slice(0, 1000),
      model
    });
  }
  if (!bytes.length) throw new CloudflareApiError("Cloudflare returned an empty binary image.", { status: response.status, model });
  return {
    buffer: bytes,
    mime: /^image\//i.test(contentType) ? contentType.split(";")[0] : inferImageMime(bytes),
    model,
    prompt: actualPrompt,
    raw: null
  };
}

function buildEndpoint(apiBase, accountId, model) {
  return `${apiBase.replace(/\/$/, "")}/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
}

export function createCloudflareProvider({
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  apiBase = process.env.CLOUDFLARE_API_BASE || DEFAULT_API_BASE,
  textModel = process.env.CLOUDFLARE_TEXT_MODEL || DEFAULT_TEXT_MODEL,
  editModel = process.env.CLOUDFLARE_EDIT_MODEL || DEFAULT_EDIT_MODEL,
  fallbackModel = process.env.CLOUDFLARE_FALLBACK_MODEL || process.env.CLOUDFLARE_FALLBACK_TEXT_MODEL || DEFAULT_FALLBACK_MODEL,
  outputMaxDimension = Number(process.env.CLOUDFLARE_OUTPUT_MAX_DIMENSION || 496),
  referenceMaxDimension = Number(process.env.CLOUDFLARE_REFERENCE_MAX_DIMENSION || 496),
  fetchImpl = globalThis.fetch,
  loadImageSource,
  logger = console
} = {}) {
  if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID.");
  if (!apiToken) throw new Error("Missing CLOUDFLARE_API_TOKEN.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  if (typeof loadImageSource !== "function") throw new Error("loadImageSource is required.");

  async function requestMultipart(model, request, index, signal) {
    const { width, height } = normalizeModelSize(request.size, outputMaxDimension);
    const references = [];
    const isAdjustment = Boolean(request.sessionId || request.generationType === "image-edit");
    if (isAdjustment && request.contextImageUrl) references.push({ source: request.contextImageUrl, label: "current-poster" });
    // Inject the APPROVED brand kangaroo IP assets (exact yellow mascot refs), never invent a new kangaroo.
    const useBrandKangaroo = shouldUseBrandKangaroo(request);
    const hasBrandIp = useBrandKangaroo;
    let brandIpCount = 0;
    if (hasBrandIp) {
      references.push({ source: BRAND_KANGAROO_PATH, label: "brand-kangaroo-ip" });
      brandIpCount += 1;
      for (const extra of BRAND_KANGAROO_EXTRA_PATHS) {
        if (references.length >= 3) break; // leave room for optional scene refs
        references.push({ source: extra, label: "brand-kangaroo-ip-extra" });
        brandIpCount += 1;
      }
    }
    const userReferences = Array.isArray(request.referenceImages) ? request.referenceImages : [];
    for (const source of userReferences) references.push({ source, label: "scene-reference" });

    const actualPrompt = structuredPrompt(request, {
      hasCurrent: Boolean(isAdjustment && request.contextImageUrl),
      hasBrandIp,
      brandIpCount,
      userReferenceCount: userReferences.length
    });

    const form = new FormData();
    form.append("prompt", actualPrompt);
    form.append("width", String(width));
    form.append("height", String(height));
    form.append("guidance", "3.5");
    form.append("seed", String((Date.now() + index * 7919) % 2147483647));

    for (const [referenceIndex, item] of references.slice(0, 4).entries()) {
      const loaded = await loadImageSource(item.source, { signal });
      const prepared = await resizeForReference(loaded.buffer, {
        mime: loaded.mime,
        maxEdge: Math.max(256, Math.min(511, Number(referenceMaxDimension) || 496))
      });
      const extension = prepared.mime === "image/png" ? "png" : prepared.mime === "image/webp" ? "webp" : "jpg";
      form.append(
        `input_image_${referenceIndex}`,
        new Blob([prepared.buffer], { type: prepared.mime }),
        `${item.label}-${referenceIndex}.${extension}`
      );
    }

    const response = await fetchImpl(buildEndpoint(apiBase, accountId, model), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      body: form,
      signal
    });
    return parseImageResponse(response, model, actualPrompt);
  }

  async function requestJson(model, request, index, signal) {
    const useBrandKangaroo = shouldUseBrandKangaroo(request);
    const actualPrompt = structuredPrompt(request, {
      hasBrandIp: useBrandKangaroo,
      brandIpCount: useBrandKangaroo ? 1 : 0,
      userReferenceCount: Array.isArray(request.referenceImages) ? request.referenceImages.length : 0
    });
    const seed = (Date.now() + index * 7919) % 2147483647;
    const size = normalizeModelSize(request.size, outputMaxDimension);
    let payload;
    if (/flux-1-schnell/i.test(model)) {
      payload = { prompt: actualPrompt.slice(0, 2048), steps: 4 };
    } else if (/leonardo\/(phoenix|lucid)/i.test(model)) {
      payload = {
        prompt: actualPrompt,
        negative_prompt: "low quality, watermark, garbled text",
        width: size.width,
        height: size.height,
        num_steps: 25,
        guidance: /phoenix/i.test(model) ? 4 : 4.5,
        seed
      };
    } else {
      payload = {
        prompt: actualPrompt,
        negative_prompt: "low quality, watermark, garbled text",
        ...size,
        num_steps: 16,
        guidance: 7.5,
        seed
      };
    }
    const response = await fetchImpl(buildEndpoint(apiBase, accountId, model), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json, image/*, application/octet-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal
    });
    return parseImageResponse(response, model, actualPrompt);
  }

  async function generate(request, index = 0, { signal } = {}) {
    const aspectPicked = sizeForAspectRatio(resolveAspectRatio(request), outputMaxDimension);
    request = { ...request, ratio: aspectPicked.ratio, size: aspectPicked.size };
    const isAdjustment = Boolean(request.sessionId || request.generationType === "image-edit");
    const primaryModel = request.modelOverride || (isAdjustment ? editModel : textModel);
    const allowInternalFallback = !request.modelOverride;
    try {
      if (/flux-2-(klein|dev)/i.test(primaryModel)) return await requestMultipart(primaryModel, request, index, signal);
      return await requestJson(primaryModel, request, index, signal);
    } catch (primaryError) {
      if (
        isAdjustment ||
        !allowInternalFallback ||
        !fallbackModel ||
        fallbackModel === primaryModel ||
        !fallbackEligible(primaryError)
      ) {
        throw primaryError;
      }
      logger.warn?.(
        `[Workers AI] ${primaryModel} failed (${primaryError.status || "network"}): ${primaryError.message}. Falling back to ${fallbackModel}.`
      );
      return requestJson(fallbackModel, request, index, signal);
    }
  }

  async function verifyToken({ signal } = {}) {
    const response = await fetchImpl(`${apiBase.replace(/\/$/, "")}/user/tokens/verify`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) throw parseCloudflareError(payload || {}, response.status, "token-verify");
    return payload;
  }

  return {
    name: "cloudflare-workers-ai",
    accountId,
    textModel,
    editModel,
    fallbackModel,
    outputMaxDimension,
    referenceMaxDimension,
    generate,
    verifyToken
  };
}

export async function loadBundledKangaroo() {
  const buffer = await readFile(BRAND_KANGAROO_PATH);
  return { buffer, mime: "image/png" };
}
