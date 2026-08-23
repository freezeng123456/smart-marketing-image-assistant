import { shouldUseBrandKangaroo, BRAND_KANGAROO_CONSTRAINT } from "./brand-policy.mjs";
import { ensureWanxEditInputSize, inferImageMime } from "./image-utils.mjs";
import { resolveBrandAndUserRefs, sceneRefPromptHint, toDataUri } from "./ref-compose.mjs";
import {
  aspectPromptFromRequest,
  parseAspectRatio,
  resolveAspectRatio,
  sizeForQwenImageEditPlus
} from "./aspect-ratio.mjs";

function isUltraWideRequest(request) {
  const aspect = resolveAspectRatio(request);
  const { aw, ah } = parseAspectRatio(aspect);
  return aw / ah >= 2;
}

function buildPrompt(request, { userCount = 0, collage = false } = {}) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const hasBrand = shouldUseBrandKangaroo(request);
  const brand = hasBrand ? BRAND_KANGAROO_CONSTRAINT : "";
  const scene = sceneRefPromptHint(userCount, { collage, hasBrand });
  const ultraWide = isUltraWideRequest(request);
  const formatWord = ultraWide ? "banner" : "poster";
  const followRef = userCount && !hasBrand
    ? (ultraWide
      ? "Input image is a style/brand reference only: keep palette, brand colors, and a simple logo mark if present. Do NOT preserve the full square-poster product stack — redesign sparsely for a wide banner."
      : "Input image is the style and brand reference: keep its palette, logos, key products, and design language. Redesign the layout for the target aspect ratio; content and composition may change as needed.")
    : "";
  const noTextRule =
    "Do not paint legible copy, numbers, prices, or slogans on the image; reserve empty copy areas as solid or soft color shapes only.";
  const bgFill = hasBrand
    ? "Background: bright warm orange-to-gold commercial marketing fill to all four corners (soft glow, festive light accents). Do NOT use dark night streets, deep crimson neon, black voids, or empty gray/white margins."
    : `Full-bleed commercial marketing ${formatWord}; fill the entire frame with scene and color, no black empty margins.`;
  const aspect = aspectPromptFromRequest(request);
  return [`Brief: ${original}`, brand, scene, followRef, aspect, bgFill, noTextRule, `Styles: ${styles}. Full-bleed commercial marketing ${formatWord}, high quality.`]
    .filter(Boolean)
    .join("\n");
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason || new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function resolveApiKey(explicit = "") {
  return (
    String(explicit || "").trim() ||
    String(process.env.DASHSCOPE_API_KEY || "").trim() ||
    String(process.env.BAILIAN_API_KEY || "").trim() ||
    String(process.env.ALIYUN_DASHSCOPE_API_KEY || "").trim()
  );
}

const DEFAULT_MULTIMODAL_API_BASE =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const DEFAULT_WANX_API_BASE =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis";
const DEFAULT_TASK_BASE = "https://dashscope.aliyuncs.com/api/v1/tasks";
const DEFAULT_IMAGE_MODEL = "qwen-image-edit-plus";

/** True for legacy wanx2.1-imageedit async image-synthesis path. */
export function isWanxImageEditModel(model) {
  return /^wanx/i.test(String(model || "").trim());
}

/**
 * Prefer explicit constructor args, then DASHSCOPE_WORKSPACE_BASE (overrides
 * DASHSCOPE_API_BASE / DASHSCOPE_TASK_BASE), then those envs, then public defaults.
 * workspace example: https://ws-xxx.cn-beijing.maas.aliyuncs.com/api/v1
 *
 * Default (qwen-image-edit-plus) uses multimodal-generation; wanx* uses image-synthesis + tasks.
 */
export function resolveDashScopeBases({ apiBase = "", taskBase = "", model = "" } = {}) {
  const explicitApi = String(apiBase || "").trim();
  const explicitTask = String(taskBase || "").trim();
  const wanx = isWanxImageEditModel(model);
  const workspace = String(process.env.DASHSCOPE_WORKSPACE_BASE || "").trim().replace(/\/$/, "");
  const fromWorkspace = workspace
    ? {
        apiBase: wanx
          ? `${workspace}/services/aigc/image2image/image-synthesis`
          : `${workspace}/services/aigc/multimodal-generation/generation`,
        taskBase: `${workspace}/tasks`
      }
    : null;
  return {
    apiBase:
      explicitApi ||
      fromWorkspace?.apiBase ||
      String(process.env.DASHSCOPE_API_BASE || "").trim() ||
      (wanx ? DEFAULT_WANX_API_BASE : DEFAULT_MULTIMODAL_API_BASE),
    taskBase:
      explicitTask ||
      fromWorkspace?.taskBase ||
      String(process.env.DASHSCOPE_TASK_BASE || "").trim() ||
      DEFAULT_TASK_BASE
  };
}

function parseImageDataUri(uri) {
  const match = String(uri || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) return null;
    return { mime: match[1], buffer };
  } catch {
    return null;
  }
}

/** Ensure a data-URI (or return unchanged http URL) meets wanx2.1-imageedit input constraints. */
export async function prepareWanxBaseImageUrl(imageUri, { logger } = {}) {
  const parsed = parseImageDataUri(imageUri);
  if (!parsed) return imageUri;
  const ensured = await ensureWanxEditInputSize(parsed.buffer, { mime: parsed.mime });
  if (ensured.resized) {
    logger?.info?.(
      `[DashScope] upscaled base image to ${ensured.width}x${ensured.height} for wanx constraints`
    );
  }
  return toDataUri(ensured.buffer, ensured.mime);
}

function extractQwenImageUrl(payload) {
  const content = payload?.output?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part?.image === "string" && part.image) return part.image;
      if (typeof part?.url === "string" && part.url) return part.url;
    }
  }
  const results = payload?.output?.results;
  if (Array.isArray(results) && results.length) {
    const first = results[0];
    if (typeof first === "string") return first;
    if (typeof first?.url === "string") return first.url;
  }
  if (typeof payload?.output?.image === "string") return payload.output.image;
  return null;
}

/**
 * Alibaba Bailian / DashScope image edit provider.
 * Default: qwen-image-edit-plus via sync multimodal-generation (supports parameters.size).
 * Optional: set DASHSCOPE_IMAGE_MODEL=wanx2.1-imageedit for legacy async description_edit.
 * Output is returned as-is — do not letterbox/crop model results.
 * For qwen-plus: do NOT reshape the reference image for aspect; only set output size.
 */
export function createDashScopeProvider({
  apiKey = resolveApiKey(),
  model = process.env.DASHSCOPE_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  apiBase: apiBaseOpt = "",
  taskBase: taskBaseOpt = "",
  strength = Number(process.env.DASHSCOPE_IMG2IMG_STRENGTH || 0.5),
  loadImageSource,
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const explicitApiBase = String(apiBaseOpt || "").trim();
  const explicitTaskBase = String(taskBaseOpt || "").trim();

  async function generateQwenPlus(request, index = 0, { signal } = {}) {
    const activeModel = request.modelOverride || model;
    const refs = await resolveBrandAndUserRefs(request, { loadImageSource, signal, logger });
    const collage = refs.mode.includes("collage");
    const prompt = buildPrompt(request, { userCount: refs.userCount, collage });
    let image = refs.singleImageUri;

    const needsImg2Img =
      shouldUseBrandKangaroo(request) || (Array.isArray(request.referenceImages) && request.referenceImages.length);
    if (!image) {
      const hadUserRefs = Array.isArray(request.referenceImages) && request.referenceImages.length > 0;
      if (hadUserRefs && Number(refs.userCount || 0) === 0) {
        throw new Error("历史参考图文件已失效，请重新上传");
      }
      if (needsImg2Img) {
        throw new Error("图生图需要参考图，但参考图未能加载（请重新上传，或检查演示资源路径）。");
      }
      throw new Error("百炼 qwen 图生图需要品牌 IP 或参考图。");
    }

    // Do not reshape/crop the reference for aspect — only set output size parameter.
    const aspect = resolveAspectRatio(request);
    const sizeInfo = sizeForQwenImageEditPlus(aspect);
    logger.info?.(
      `[DashScope] generating aspect ${aspect} size ${sizeInfo.size} via ${activeModel} (${refs.mode}, userRefs=${refs.userCount})`
    );

    const body = {
      model: activeModel,
      input: {
        messages: [
          {
            role: "user",
            content: [{ image }, { text: prompt }]
          }
        ]
      },
      parameters: {
        n: 1,
        negative_prompt: "",
        prompt_extend: true,
        watermark: false,
        size: sizeInfo.size
      }
    };

    const bases = resolveDashScopeBases({ apiBase: explicitApiBase, taskBase: explicitTaskBase, model: activeModel });
    const response = await fetchImpl(bases.apiBase, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.message || payload?.code || payload?.error || `DashScope failed (${response.status})`),
        { status: response.status, payload }
      );
    }

    const imageUrl = extractQwenImageUrl(payload);
    if (!imageUrl) {
      throw Object.assign(new Error("DashScope returned no image url"), { status: 502, payload });
    }

    const img = await fetchImpl(imageUrl, { signal });
    if (!img.ok) throw Object.assign(new Error(`DashScope download failed (${img.status})`), { status: img.status });
    const buffer = Buffer.from(await img.arrayBuffer());
    return {
      buffer,
      mime: img.headers.get("content-type") || inferImageMime(buffer, "image/jpeg"),
      model: `dashscope/${activeModel}`,
      prompt,
      size: sizeInfo.size,
      usage: payload?.usage || null
    };
  }

  async function generateWanx(request, index = 0, { signal } = {}) {
    const activeModel = request.modelOverride || model;
    const refs = await resolveBrandAndUserRefs(request, { loadImageSource, signal, logger });
    const collage = refs.mode.includes("collage");
    const prompt = buildPrompt(request, { userCount: refs.userCount, collage });
    let image = refs.singleImageUri;

    const needsImg2Img =
      shouldUseBrandKangaroo(request) || (Array.isArray(request.referenceImages) && request.referenceImages.length);
    if (!image) {
      const hadUserRefs = Array.isArray(request.referenceImages) && request.referenceImages.length > 0;
      if (hadUserRefs && Number(refs.userCount || 0) === 0) {
        throw new Error("历史参考图文件已失效，请重新上传");
      }
      if (needsImg2Img) {
        throw new Error("图生图需要参考图，但参考图未能加载（请重新上传，或检查演示资源路径）。");
      }
      throw new Error("百炼 wanx 图生图需要品牌 IP 或参考图。");
    }

    image = await prepareWanxBaseImageUrl(image, { logger });

    const aspect = resolveAspectRatio(request);
    const ultraWide = isUltraWideRequest(request);
    const editStrength = Number.isFinite(strength) ? strength : ultraWide ? 0.65 : 0.5;
    logger.info?.(
      `[DashScope] generating aspect ${aspect} via ${activeModel} (${refs.mode}, userRefs=${refs.userCount}, strength=${editStrength})`
    );

    const body = {
      model: activeModel,
      input: {
        function: "description_edit",
        prompt,
        base_image_url: image
      },
      parameters: {
        n: 1,
        strength: editStrength,
        watermark: false
      }
    };

    const bases = resolveDashScopeBases({ apiBase: explicitApiBase, taskBase: explicitTaskBase, model: activeModel });
    const response = await fetchImpl(bases.apiBase, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-DashScope-Async": "enable"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.message || payload?.code || payload?.error || `DashScope failed (${response.status})`),
        { status: response.status, payload }
      );
    }

    const taskId =
      payload?.output?.task_id ||
      payload?.output?.taskId ||
      payload?.task_id ||
      payload?.taskId ||
      payload?.request_id;
    if (!taskId) {
      throw Object.assign(new Error("DashScope returned no task_id"), { status: 502, payload });
    }

    let imageUrl = null;
    for (let i = 0; i < 90; i += 1) {
      await sleep(2000, signal);
      const st = await fetchImpl(`${String(bases.taskBase).replace(/\/$/, "")}/${taskId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        },
        signal
      });
      const body2 = await st.json().catch(() => ({}));
      const status = String(
        body2?.output?.task_status || body2?.task_status || body2?.status || ""
      ).toUpperCase();
      const results = body2?.output?.results || body2?.results || [];
      if (Array.isArray(results) && results.length) {
        imageUrl = typeof results[0] === "string" ? results[0] : results[0]?.url;
      }
      if (imageUrl) break;
      if (["FAILED", "ERROR", "CANCELED", "CANCELLED", "UNKNOWN"].includes(status)) {
        throw Object.assign(new Error(body2?.output?.message || body2?.message || body2?.code || `DashScope task ${status}`), {
          status: 500,
          payload: body2
        });
      }
    }

    if (!imageUrl) throw new Error("DashScope returned no image url");
    const img = await fetchImpl(imageUrl, { signal });
    if (!img.ok) throw Object.assign(new Error(`DashScope download failed (${img.status})`), { status: img.status });
    const buffer = Buffer.from(await img.arrayBuffer());
    return {
      buffer,
      mime: img.headers.get("content-type") || inferImageMime(buffer, "image/jpeg"),
      model: `dashscope/${activeModel}`,
      prompt
    };
  }

  async function generate(request, index = 0, opts = {}) {
    const activeModel = request.modelOverride || model;
    if (isWanxImageEditModel(activeModel)) {
      return generateWanx(request, index, opts);
    }
    return generateQwenPlus(request, index, opts);
  }

  return {
    name: "dashscope",
    textModel: `dashscope/${model}`,
    editModel: `dashscope/${model}`,
    generate
  };
}
