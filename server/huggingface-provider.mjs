import { shouldUseBrandKangaroo, BRAND_KANGAROO_CONSTRAINT } from "./brand-policy.mjs";
import { aspectPromptFromRequest, resolveAspectRatio } from "./aspect-ratio.mjs";
function buildPrompt(request) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const brand = shouldUseBrandKangaroo(request) ? BRAND_KANGAROO_CONSTRAINT : "";
  const aspect = aspectPromptFromRequest(request);
  return [`Brief: ${original}`, brand, aspect, `Styles: ${styles}. Full-bleed commercial poster.`].filter(Boolean).join("\n");
}

export function createHuggingFaceProvider({
  apiKey = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || "",
  model = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
  apiBase = process.env.HF_IMAGE_API_BASE || "https://router.huggingface.co/hf-inference/models",
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("HF_TOKEN is required.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  async function generate(request, index = 0, { signal } = {}) {
    const prompt = buildPrompt(request);
    const url = `${apiBase.replace(/\/$/, "")}/${model}`;
    logger.info?.(`[HF] generating via ${model}`);
    const response = await fetchImpl(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "image/*"
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          seed: (Date.now() + index * 4243) % 2147483647
        }
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(new Error(text.slice(0, 400) || `HF failed (${response.status})`), { status: response.status });
    }
    const ctype = response.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const payload = await response.json();
      throw Object.assign(new Error(payload?.error || JSON.stringify(payload).slice(0, 300)), { status: response.status || 503 });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mime: ctype || "image/jpeg", model: `hf/${model}`, prompt };
  }

  return {
    name: "huggingface",
    textModel: `hf/${model}`,
    editModel: `hf/${model}`,
    generate
  };
}
