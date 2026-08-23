/**
 * Aspect-ratio helpers for model prompts and generation size picking.
 * Prefer ratio constraints over exact pixel resolution.
 */

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Reduce WxH to "W:H" (e.g. 1080x1920 → "9:16"). */
export function simplifyRatio(width, height) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/** Parse "9:16" / "9/16" / "0.5625" into { aw, ah, value }. */
export function parseAspectRatio(raw, fallback = "9:16") {
  const text = String(raw || "").trim();
  const m = /^(\d+(?:\.\d+)?)\s*[:/×x]\s*(\d+(?:\.\d+)?)$/i.exec(text);
  if (m) {
    const aw = Number(m[1]);
    const ah = Number(m[2]);
    if (aw > 0 && ah > 0) {
      return { aw, ah, value: simplifyRatio(aw, ah) };
    }
  }
  const fb = parseAspectRatio(fallback === text ? "9:16" : fallback, "9:16");
  return fb;
}

/**
 * Resolve the aspect ratio the model should follow.
 * Priority: explicit request.ratio (if not custom) → resourceSlots[0] → size → 9:16.
 */
export function resolveAspectRatio(request = {}) {
  const ratioRaw = String(request.ratio || "").trim();
  if (ratioRaw && !/^custom$/i.test(ratioRaw)) {
    return parseAspectRatio(ratioRaw).value;
  }
  const slot = Array.isArray(request.resourceSlots) ? request.resourceSlots[0] : null;
  if (slot && Number(slot.width) > 0 && Number(slot.height) > 0) {
    return simplifyRatio(slot.width, slot.height);
  }
  const size = String(request.size || "").trim();
  const sm = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
  if (sm) return simplifyRatio(sm[1], sm[2]);
  return "9:16";
}

/**
 * Aspect guidance for model prompts.
 * `ratio` MUST come from the webpage resource-slot option (already simplified, e.g. 9:16).
 * Optional `placementLabel` is the UI slot name (e.g. 开屏广告).
 */
export function aspectPromptConstraint(ratio, { placementLabel = "" } = {}) {
  const value = parseAspectRatio(ratio).value;
  const [aw, ah] = value.split(":").map(Number);
  const orientation =
    aw === ah ? "square" : aw > ah ? "landscape" : "portrait";
  const placement = String(placementLabel || "").trim();
  const sourceLine = placement
    ? `Target aspect ratio is taken from the webpage placement option「${placement}」: ${value} (${orientation}).`
    : `Target aspect ratio is taken from the webpage placement option: ${value} (${orientation}).`;
  // Style-consistent reframe: new layout for the selected ratio; content may adapt; no letterbox.
  return [
    sourceLine,
    `Reframe this marketing creative specifically for ${value} ${orientation} composition.`,
    "Keep the same visual style, color palette, lighting, materials, and brand look as the reference.",
    "You MAY rearrange layout, rescale elements, and adapt or regenerate scene content so it feels intentionally designed for this placement ratio.",
    "Fill the entire frame edge-to-edge as a finished full-bleed poster.",
    "Do NOT leave letterbox/pillarbox bars, gray/white empty margins, or stretched warped content."
  ].join(" ");
}

/** Pull ratio + placement label from the validated request (webpage resourceSlots). */
export function aspectPromptFromRequest(request = {}) {
  const slot = Array.isArray(request.resourceSlots) ? request.resourceSlots[0] : null;
  const ratio = resolveAspectRatio(request);
  const placementLabel = slot?.label || "";
  return aspectPromptConstraint(ratio, { placementLabel });
}

/**
 * Pick a generation WxH that matches the aspect ratio within maxEdge.
 * Used as an API size hint only — ratio is the real constraint.
 */
export function sizeForAspectRatio(ratio, maxEdge = 1280) {
  const { aw, ah, value } = parseAspectRatio(ratio);
  const limit = Math.max(256, Math.round(Number(maxEdge) || 1280));
  let width;
  let height;
  if (aw >= ah) {
    width = limit;
    height = Math.max(64, Math.round((limit * ah) / aw));
  } else {
    height = limit;
    width = Math.max(64, Math.round((limit * aw) / ah));
  }
  // Many diffusion APIs prefer multiples of 8.
  width = Math.max(64, Math.round(width / 8) * 8);
  height = Math.max(64, Math.round(height / 8) * 8);
  return { width, height, ratio: value, size: `${width}x${height}` };
}
