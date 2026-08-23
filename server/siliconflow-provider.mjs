import { shouldUseBrandKangaroo, BRAND_KANGAROO_CONSTRAINT } from "./brand-policy.mjs";
import { inferImageMime } from "./image-utils.mjs";
import { resolveBrandAndUserRefs, sceneRefPromptHint } from "./ref-compose.mjs";
import { aspectPromptFromRequest, resolveAspectRatio } from "./aspect-ratio.mjs";

function buildPrompt(request, { hasRef = false, userCount = 0, collage = false } = {}) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const hasBrand = shouldUseBrandKangaroo(request);
  const brand = hasBrand ? BRAND_KANGAROO_CONSTRAINT : "";
  const scene = sceneRefPromptHint(userCount, { collage, hasBrand });
  const followRef = userCount && !hasBrand
    ? "Input image is the style and brand reference: keep its palette, logos, key products, and design language. Redesign the layout for the target aspect ratio; content and composition may change as needed."
    : "";
  const aspect = aspectPromptFromRequest(request);
  return [`Brief: ${original}`, brand, scene, followRef, aspect, `Styles: ${styles}. Full-bleed commercial poster.`].filter(Boolean).join("\n");
}

const SILICONFLOW_ALLOWED_SIZES = [
  "512x512",
  "768x1024",
  "1024x768",
  "576x1024",
  "1024x576",
  "1024x1024"
];

/** Map any WxH request to the SiliconFlow size with the closest aspect ratio. */
function sizeForAspectFallback(request) {
  const ratio = resolveAspectRatio(request);
  const [aw, ah] = ratio.split(":").map(Number);
  // Hint size near 1024 long-edge for SiliconFlow mapping.
  if (aw >= ah) return `${1024}x${Math.max(512, Math.round((1024 * ah) / aw))}`;
  return `${Math.max(512, Math.round((1024 * aw) / ah))}x1024`;
}

export function pickSize(size) {
  const raw = String(size || "768x1024").trim();
  if (SILICONFLOW_ALLOWED_SIZES.includes(raw)) return raw;

  const match = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(raw);
  if (!match) return "768x1024";
  const tw = Number(match[1]);
  const th = Number(match[2]);
  if (!Number.isFinite(tw) || !Number.isFinite(th) || tw <= 0 || th <= 0) return "768x1024";

  const targetRatio = tw / th;
  let best = SILICONFLOW_ALLOWED_SIZES[0];
  let bestDiff = Infinity;
  for (const candidate of SILICONFLOW_ALLOWED_SIZES) {
    const [w, h] = candidate.split("x").map(Number);
    const diff = Math.abs(w / h - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

export function createSiliconFlowProvider({
  apiKey = process.env.SILICONFLOW_API_KEY || "",
  model = process.env.SILICONFLOW_IMAGE_MODEL || "Kwai-Kolors/Kolors",
  apiBase = process.env.SILICONFLOW_API_BASE || "https://api.siliconflow.cn/v1/images/generations",
  loadImageSource,
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is required.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  async function generate(request, index = 0, { signal } = {}) {
    const activeModel = request.modelOverride || model;
    const refs = await resolveBrandAndUserRefs(request, { loadImageSource, signal, logger });
    // Always prefer brand (+ collage with user refs). Never replace brand IP with user product photo alone.
    let image = refs.singleImageUri;
    const collage = refs.mode.includes("collage");
    const prompt = buildPrompt(request, {
      hasRef: Boolean(image),
      userCount: refs.userCount,
      collage
    });
    const image_size = pickSize(request.size || sizeForAspectFallback(request));
    logger.info?.(
      `[SiliconFlow] generating ${image_size} via ${activeModel} (${refs.mode}, userRefs=${refs.userCount})`
    );

    const body = {
      model: activeModel,
      prompt,
      image_size,
      batch_size: 1,
      num_inference_steps: Number(process.env.SILICONFLOW_STEPS || 28),
      guidance_scale: Number(process.env.SILICONFLOW_GUIDANCE || 7.5),
      seed: (Date.now() + index * 9973) % 9999999999
    };
    if (image) body.image = image;

    // Optional edit of current poster when adjusting and no brand/user ref resolved.
    if (!image && request.contextImageUrl && typeof loadImageSource === "function") {
      try {
        const current = await loadImageSource(request.contextImageUrl, { signal });
        const mime = /^image\//.test(current.mime) ? current.mime : inferImageMime(current.buffer, "image/png");
        body.image = `data:${mime};base64,${current.buffer.toString("base64")}`;
      } catch (error) {
        logger.warn?.(`[SiliconFlow] context image skipped: ${error.message}`);
      }
    }

    const response = await fetchImpl(apiBase, {
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
      throw Object.assign(new Error(payload?.message || payload?.error || `SiliconFlow failed (${response.status})`), {
        status: response.status,
        payload
      });
    }
    const imageUrl = payload?.images?.[0]?.url || payload?.data?.[0]?.url;
    const b64 = payload?.images?.[0]?.b64_json || payload?.data?.[0]?.b64_json;
    let buffer;
    let mime = "image/png";
    if (b64) {
      buffer = Buffer.from(b64, "base64");
    } else if (imageUrl) {
      const img = await fetchImpl(imageUrl, { signal });
      if (!img.ok) throw Object.assign(new Error(`SiliconFlow image download failed (${img.status})`), { status: img.status });
      buffer = Buffer.from(await img.arrayBuffer());
      mime = img.headers.get("content-type") || mime;
    } else {
      throw new Error("SiliconFlow returned no image");
    }
    return { buffer, mime, model: `siliconflow/${activeModel}`, prompt };
  }

  return {
    name: "siliconflow",
    textModel: `siliconflow/${model}`,
    editModel: `siliconflow/${model}`,
    generate
  };
}
