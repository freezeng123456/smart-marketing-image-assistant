/** Free-tier image models exposed in the web UI. */
export const MODEL_CATALOG = [
  {
    id: "modelscope-qwen-edit",
    label: "魔搭 · Qwen-Image-Edit（推荐/图生图）",
    channel: "modelscope",
    provider: "modelscope",
    model: "Qwen/Qwen-Image-Edit",
    tier: "best",
    img2img: true,
    reliableImg2Img: true
  },
  {
    id: "modelscope-zimage",
    label: "魔搭 · Z-Image-Turbo（调试快/偏文生图）",
    channel: "modelscope",
    provider: "modelscope",
    model: "Tongyi-MAI/Z-Image-Turbo",
    tier: "debug",
    img2img: true,
    // ModelScope inference often ignores `image` for this model → text-only lookalike.
    reliableImg2Img: false
  },
  {
    id: "modelscope-qwen-image",
    label: "魔搭 · Qwen-Image",
    channel: "modelscope",
    provider: "modelscope",
    model: "Qwen/Qwen-Image",
    tier: "best",
    img2img: true,
    reliableImg2Img: false
  },
  {
    id: "siliconflow-kolors",
    label: "硅基 · Kolors（免费/调试）",
    channel: "siliconflow",
    provider: "siliconflow",
    model: "Kwai-Kolors/Kolors",
    tier: "debug",
    img2img: true,
    reliableImg2Img: true
  },
  {
    id: "cloudflare-flux2-dev",
    label: "Cloudflare · FLUX.2-dev",
    channel: "cloudflare",
    provider: "cloudflare",
    model: "@cf/black-forest-labs/flux-2-dev",
    tier: "best",
    img2img: true,
    reliableImg2Img: true
  }
];

export const DEFAULT_MODEL_ID = "modelscope-qwen-image";
export const DEFAULT_IMG2IMG_MODEL_ID = "modelscope-qwen-edit";

export function modelsForChannel(channel) {
  return MODEL_CATALOG.filter((item) => item.channel === channel && item.img2img);
}

export function isQuotaError(error) {
  const message = String(error?.message || error || "");
  const status = Number(error?.status || 0);
  return (
    status === 402 ||
    status === 429 ||
    /neuron|quota|rate.?limit|used up|free allocation|billing|credit|exhausted|余额不足|额度|queue full|insufficient|top up|locked/i.test(
      message
    )
  );
}

export function listUiModels() {
  return MODEL_CATALOG.filter((item) => item.img2img);
}

export function findModel(id) {
  return listUiModels().find((item) => item.id === id) || null;
}

export function needsReliableImg2Img(request = {}) {
  const refs = Array.isArray(request.referenceImages) ? request.referenceImages.filter(Boolean) : [];
  return refs.length > 0 || request.brandAsset === "brand-kangaroo";
}

/** Pick a model that actually consumes reference images when needed. */
export function resolveModelForRequest(request = {}) {
  const wantedId = request.modelId || request.preferredModelId || DEFAULT_MODEL_ID;
  const wanted = findModel(wantedId) || findModel(DEFAULT_MODEL_ID);
  if (!needsReliableImg2Img(request)) return wanted;
  if (wanted?.reliableImg2Img) return wanted;
  const preferred = findModel(DEFAULT_IMG2IMG_MODEL_ID);
  if (preferred?.reliableImg2Img) return preferred;
  return listUiModels().find((item) => item.reliableImg2Img) || wanted;
}
