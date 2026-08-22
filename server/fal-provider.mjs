function buildPrompt(request) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const brand =
    !request.brandAsset || request.brandAsset === "brand-kangaroo"
      ? "Hero character must match Meituan yellow kangaroo IP: side/3-4 profile, bright yellow vinyl body, cream belly pouch, long rounded ears, small black oval eye separate from black oval nose, thick yellow tail."
      : "";
  return [`Brief: ${original}`, brand, `Styles: ${styles}. Full-bleed commercial poster.`].filter(Boolean).join("\n");
}

export function createFalProvider({
  apiKey = process.env.FAL_KEY || "",
  model = process.env.FAL_IMAGE_MODEL || "fal-ai/flux/schnell",
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("FAL_KEY is required for fal.ai provider.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  async function generate(request, index = 0, { signal } = {}) {
    const prompt = buildPrompt(request);
    const endpoint = `https://queue.fal.run/${model.replace(/^https?:\/\/queue\.fal\.run\//, "")}`;
    logger.info?.(`[fal] generating via ${model}`);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        prompt,
        image_size: "portrait_4_3",
        num_images: 1,
        enable_safety_checker: true,
        seed: (Date.now() + index * 1337) % 2147483647
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(payload?.detail || payload?.error || `fal failed (${response.status})`), {
        status: response.status,
        payload
      });
    }
    // queue protocol: may return request_id
    let result = payload;
    if (payload?.request_id && !payload?.images) {
      const statusUrl = `https://queue.fal.run/${model}/requests/${payload.request_id}/status`;
      const resultUrl = `https://queue.fal.run/${model}/requests/${payload.request_id}`;
      for (let i = 0; i < 60; i += 1) {
        const st = await fetchImpl(statusUrl, { headers: { Authorization: `Key ${apiKey}` }, signal });
        const body = await st.json();
        if (body?.status === "COMPLETED") break;
        if (body?.status === "FAILED") throw Object.assign(new Error(body?.error || "fal job failed"), { status: 500 });
        await new Promise((r) => setTimeout(r, 1500));
      }
      const done = await fetchImpl(resultUrl, { headers: { Authorization: `Key ${apiKey}` }, signal });
      result = await done.json();
      if (!done.ok) throw Object.assign(new Error(result?.detail || `fal result failed (${done.status})`), { status: done.status });
    }
    const imageUrl = result?.images?.[0]?.url || result?.image?.url;
    if (!imageUrl) throw new Error("fal returned no image url");
    const img = await fetchImpl(imageUrl, { signal });
    if (!img.ok) throw Object.assign(new Error(`fal image download failed (${img.status})`), { status: img.status });
    const buffer = Buffer.from(await img.arrayBuffer());
    const mime = img.headers.get("content-type") || "image/jpeg";
    return { buffer, mime, model: `fal/${model}`, prompt };
  }

  return {
    name: "fal",
    textModel: `fal/${model}`,
    editModel: `fal/${model}`,
    generate
  };
}
