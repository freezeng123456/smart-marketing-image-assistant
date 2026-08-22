function buildPrompt(request) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const brand =
    !request.brandAsset || request.brandAsset === "brand-kangaroo"
      ? "Hero: Meituan yellow kangaroo IP, side/3-4 profile, bright yellow vinyl, cream belly pouch, small black oval eye, separate black oval nose, thick yellow tail."
      : "";
  return [`Brief: ${original}`, brand, `Styles: ${styles}. Full-bleed commercial poster.`].filter(Boolean).join("\n");
}

function pickSize(size) {
  const raw = String(size || "768x1024");
  const allowed = new Set(["512x512", "768x1024", "1024x768", "576x1024", "1024x576", "1024x1024"]);
  if (allowed.has(raw)) return raw;
  return "768x1024";
}

export function createSiliconFlowProvider({
  apiKey = process.env.SILICONFLOW_API_KEY || "",
  model = process.env.SILICONFLOW_IMAGE_MODEL || "Kwai-Kolors/Kolors",
  apiBase = process.env.SILICONFLOW_API_BASE || "https://api.siliconflow.cn/v1/images/generations",
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is required.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  async function generate(request, index = 0, { signal } = {}) {
    const prompt = buildPrompt(request);
    const image_size = pickSize(request.size);
    logger.info?.(`[SiliconFlow] generating ${image_size} via ${model}`);
    const response = await fetchImpl(apiBase, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model,
        prompt,
        image_size,
        seed: (Date.now() + index * 9973) % 9999999999
      })
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
    return { buffer, mime, model: `siliconflow/${model}`, prompt };
  }

  return {
    name: "siliconflow",
    textModel: `siliconflow/${model}`,
    editModel: `siliconflow/${model}`,
    generate
  };
}
