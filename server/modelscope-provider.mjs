import { shouldUseBrandKangaroo, BRAND_KANGAROO_CONSTRAINT } from "./brand-policy.mjs";
import { inferImageMime } from "./image-utils.mjs";
import { resolveBrandAndUserRefs, sceneRefPromptHint } from "./ref-compose.mjs";
import { aspectPromptFromRequest, resolveAspectRatio, sizeForAspectRatio } from "./aspect-ratio.mjs";

function buildPrompt(request, { userCount = 0, collage = false } = {}) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const hasBrand = shouldUseBrandKangaroo(request);
  const brand = hasBrand ? BRAND_KANGAROO_CONSTRAINT : "";
  const scene = sceneRefPromptHint(userCount, { collage, hasBrand });
  const followRef = userCount && !hasBrand
    ? "Input image is the style and brand reference: keep its palette, logos, key products, and design language. Redesign the layout for the target aspect ratio; content and composition may change as needed."
    : "";
  const bgFill = hasBrand
    ? "Background: bright warm orange-to-gold commercial marketing fill to all four corners (soft glow, festive light accents). Do NOT use dark night streets, deep crimson neon, black voids, or empty gray/white margins."
    : "Full-bleed commercial marketing poster; fill the entire frame with scene and color, no black empty margins.";
  const aspect = aspectPromptFromRequest(request);
  return [`Brief: ${original}`, brand, scene, followRef, aspect, bgFill, `Styles: ${styles}. Full-bleed commercial marketing poster, high quality.`]
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
    const aspect = resolveAspectRatio(request);
    const maxEdge = Number(process.env.MODELSCOPE_MAX_EDGE || 1280);
    const picked = sizeForAspectRatio(aspect, maxEdge);
    const width = picked.width;
    const height = picked.height;

    let image = refs.singleImageUri;
    let multiUris = Array.isArray(refs.multiImageUris) ? [...refs.multiImageUris] : [];

    const needsImg2Img = requireImg2Img && (shouldUseBrandKangaroo(request) || (Array.isArray(request.referenceImages) && request.referenceImages.length));
    if (needsImg2Img && !image) {
      const hadUserRefs = Array.isArray(request.referenceImages) && request.referenceImages.length > 0;
      if (hadUserRefs && Number(refs.userCount || 0) === 0) {
        throw new Error("历史参考图文件已失效，请重新上传");
      }
      throw new Error(
        "图生图需要参考图，但参考图未能加载（请重新上传，或检查演示资源路径）。"
      );
    }

    logger.info?.(
      `[ModelScope] generating ${width}x${height} (aspect ${aspect}) via ${activeModel} (${refs.mode}, userRefs=${refs.userCount}, hasImage=${Boolean(image)}, imageChars=${image ? image.length : 0})`
    );

    const body = {
      model: activeModel,
      prompt,
      width,
      height,
      size: `${width}x${height}`,
      seed: (Date.now() + index * 4243) % 2147483647
    };

    // Prefer multi-image array for Qwen-Image-Edit when we have brand + user refs.
    const supportsMulti = /image-edit/i.test(activeModel) && multiUris.length > 1;
    if (supportsMulti) {
      body.image = multiUris;
      body.image_url = multiUris;
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
