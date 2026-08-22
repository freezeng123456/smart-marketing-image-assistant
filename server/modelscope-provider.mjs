import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inferImageMime } from "./image-utils.mjs";

const BRAND_SIDE_PATH = fileURLToPath(new URL("../assets/brand-ip/side-profile-clean.png", import.meta.url));

function buildPrompt(request, { hasBrandRef = false } = {}) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const brand = hasBrandRef
    ? "Hero must match the reference image: Meituan yellow kangaroo IP, side/3-4 profile, bright yellow vinyl, cream belly pouch, separate black oval eye and nose, thick yellow tail."
    : "Hero: Meituan yellow kangaroo IP, side/3-4 profile, bright yellow vinyl.";
  return [`Brief: ${original}`, brand, `Styles: ${styles}. Full-bleed commercial poster.`].filter(Boolean).join("\n");
}

export function createModelScopeProvider({
  apiKey = process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_API_KEY || "",
  model = process.env.MODELSCOPE_IMAGE_MODEL || "Qwen/Qwen-Image",
  apiBase = process.env.MODELSCOPE_API_BASE || "https://api-inference.modelscope.cn/v1/images/generations",
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("MODELSCOPE_API_TOKEN is required.");

  async function generate(request, index = 0, { signal } = {}) {
    const prompt = buildPrompt(request, { hasBrandRef: true });
    let image;
    try {
      const buffer = await readFile(BRAND_SIDE_PATH);
      image = `data:${inferImageMime(buffer, "image/png")};base64,${buffer.toString("base64")}`;
    } catch {
      image = undefined;
    }
    logger.info?.(`[ModelScope] generating via ${model}${image ? " (with brand ref if supported)" : ""}`);
    const body = { model, prompt };
    if (image) body.image = image;
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
      throw Object.assign(new Error(payload?.message || payload?.error || `ModelScope failed (${response.status})`), {
        status: response.status,
        payload
      });
    }
    // sync url or async task
    let imageUrl = payload?.images?.[0]?.url || payload?.data?.[0]?.url || payload?.output?.images?.[0];
    if (!imageUrl && (payload?.task_id || payload?.request_id)) {
      const taskId = payload.task_id || payload.request_id;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await fetchImpl(`${apiBase.replace(/\/images\/generations.*/, "")}/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal
        });
        const body2 = await st.json().catch(() => ({}));
        imageUrl = body2?.images?.[0]?.url || body2?.output?.images?.[0] || body2?.data?.[0]?.url;
        if (imageUrl || body2?.status === "FAILED" || body2?.task_status === "FAILED") break;
      }
    }
    if (!imageUrl) throw new Error("ModelScope returned no image url");
    const img = await fetchImpl(imageUrl, { signal });
    if (!img.ok) throw Object.assign(new Error(`ModelScope download failed (${img.status})`), { status: img.status });
    const buffer = Buffer.from(await img.arrayBuffer());
    return { buffer, mime: img.headers.get("content-type") || "image/jpeg", model: `modelscope/${model}`, prompt };
  }

  return {
    name: "modelscope",
    textModel: `modelscope/${model}`,
    editModel: `modelscope/${model}`,
    generate
  };
}
