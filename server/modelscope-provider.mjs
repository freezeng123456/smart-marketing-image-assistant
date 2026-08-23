import { shouldUseBrandKangaroo, BRAND_KANGAROO_CONSTRAINT } from "./brand-policy.mjs";
import { inferImageMime } from "./image-utils.mjs";
import { resolveBrandAndUserRefs, sceneRefPromptHint } from "./ref-compose.mjs";

function buildPrompt(request, { userCount = 0, collage = false } = {}) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const hasBrand = shouldUseBrandKangaroo(request);
  const brand = hasBrand ? BRAND_KANGAROO_CONSTRAINT : "";
  const scene = sceneRefPromptHint(userCount, { collage, hasBrand });
  const followRef = userCount && !hasBrand
    ? "Input image is the primary visual reference: keep its main subject, products, brand colors, icons, and composition cues. Adapt ratio/layout for the campaign brief, but do not invent an unrelated scene or character."
    : "";
  return [`Brief: ${original}`, brand, scene, followRef, `Styles: ${styles}. Full-bleed commercial marketing poster, high quality.`]
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

export function createModelScopeProvider({
  apiKey = process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_API_KEY || "",
  model = process.env.MODELSCOPE_IMAGE_MODEL || "Qwen/Qwen-Image-Edit",
  apiBase = process.env.MODELSCOPE_API_BASE || "https://api-inference.modelscope.cn/v1/images/generations",
  taskBase = process.env.MODELSCOPE_TASK_BASE || "https://api-inference.modelscope.cn/v1/tasks",
  requireImg2Img = process.env.MODELSCOPE_REQUIRE_IMG2IMG !== "0",
  loadImageSource,
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("MODELSCOPE_API_TOKEN is required.");

  async function generate(request, index = 0, { signal } = {}) {
    const activeModel = request.modelOverride || model;
    const refs = await resolveBrandAndUserRefs(request, { loadImageSource, signal, logger });
    const collage = refs.mode.includes("collage");
    const prompt = buildPrompt(request, { userCount: refs.userCount, collage });
    const size = String(request.size || "768x1024");
    const [w, h] = size.split("x").map((n) => Number.parseInt(n, 10));
    const width = Number.isFinite(w) ? w : 768;
    const height = Number.isFinite(h) ? h : 1024;

    const image = refs.singleImageUri;
    const needsImg2Img = requireImg2Img && (shouldUseBrandKangaroo(request) || (Array.isArray(request.referenceImages) && request.referenceImages.length));
    if (needsImg2Img && !image) throw new Error("ModelScope img2img requires brand or user reference image.");

    logger.info?.(
      `[ModelScope] generating ${width}x${height} via ${activeModel} (${refs.mode}, userRefs=${refs.userCount}, hasImage=${Boolean(image)}, imageChars=${image ? image.length : 0})`
    );

    const body = {
      model: activeModel,
      prompt,
      width,
      height,
      seed: (Date.now() + index * 4243) % 2147483647
    };

    // Prefer multi-image array for Qwen-Image-Edit when we have brand + user refs.
    const supportsMulti = /image-edit/i.test(activeModel) && refs.multiImageUris.length > 1;
    if (supportsMulti) {
      body.image = refs.multiImageUris;
      body.image_url = refs.multiImageUris;
    } else if (image) {
      body.image = image;
      body.image_url = image;
      // Help img2img-capable backends actually condition on the reference.
      if (!("strength" in body)) body.strength = Number(process.env.MODELSCOPE_IMG2IMG_STRENGTH || 0.55);
    }

    const response = await fetchImpl(apiBase, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-ModelScope-Async-Mode": "true"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      // If multi-image rejected, retry once with collage single image.
      if (supportsMulti && image) {
        logger.warn?.(`[ModelScope] multi-image rejected (${response.status}), retrying collage`);
        body.image = image;
        body.image_url = image;
        const retry = await fetchImpl(apiBase, {
          method: "POST",
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-ModelScope-Async-Mode": "true"
          },
          body: JSON.stringify(body)
        });
        const retryPayload = await retry.json().catch(() => ({}));
        if (!retry.ok) {
          throw Object.assign(
            new Error(retryPayload?.message || retryPayload?.error || payload?.message || `ModelScope failed (${retry.status})`),
            { status: retry.status, payload: retryPayload }
          );
        }
        return await finishFromPayload(retryPayload, { activeModel, prompt, signal, apiKey, taskBase, fetchImpl });
      }
      throw Object.assign(new Error(payload?.message || payload?.error || payload?.errors?.message || `ModelScope failed (${response.status})`), {
        status: response.status,
        payload
      });
    }

    return await finishFromPayload(payload, { activeModel, prompt, signal, apiKey, taskBase, fetchImpl });
  }

  return {
    name: "modelscope",
    textModel: `modelscope/${model}`,
    editModel: `modelscope/${model}`,
    generate
  };
}

async function finishFromPayload(payload, { activeModel, prompt, signal, apiKey, taskBase, fetchImpl }) {
  let imageUrl =
    payload?.images?.[0]?.url ||
    payload?.data?.[0]?.url ||
    payload?.output_images?.[0] ||
    payload?.output?.images?.[0];

  const taskId = payload?.task_id || payload?.taskId || payload?.request_id || payload?.data?.task_id;
  if (!imageUrl && taskId) {
    for (let i = 0; i < 90; i += 1) {
      await sleep(2000, signal);
      const st = await fetchImpl(`${taskBase.replace(/\/$/, "")}/${taskId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-ModelScope-Task-Type": "image_generation"
        },
        signal
      });
      const body2 = await st.json().catch(() => ({}));
      const status = String(body2?.task_status || body2?.status || "").toUpperCase();
      const outs = body2?.output_images || body2?.images || [];
      if (Array.isArray(outs) && outs.length) {
        imageUrl = typeof outs[0] === "string" ? outs[0] : outs[0]?.url;
      }
      if (imageUrl) break;
      if (["FAILED", "ERROR", "CANCELED"].includes(status)) {
        throw Object.assign(new Error(body2?.message || body2?.error || `ModelScope task ${status}`), {
          status: 500,
          payload: body2
        });
      }
    }
  }

  if (!imageUrl) throw new Error("ModelScope returned no image url");
  const img = await fetchImpl(imageUrl, { signal });
  if (!img.ok) throw Object.assign(new Error(`ModelScope download failed (${img.status})`), { status: img.status });
  const buffer = Buffer.from(await img.arrayBuffer());
  return {
    buffer,
    mime: img.headers.get("content-type") || inferImageMime(buffer, "image/jpeg"),
    model: `modelscope/${activeModel}`,
    prompt
  };
}
