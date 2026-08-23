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

/** English prompt line: constrain composition ratio, not exact pixels. */
export function aspectPromptConstraint(ratio) {
  const value = parseAspectRatio(ratio).value;
  const [aw, ah] = value.split(":").map(Number);
  const orientation =
    aw === ah ? "square" : aw > ah ? "landscape" : "portrait";
  // Outpaint / expand framing (no crop): keep source intact, only synthesize new margins.
  return [
    `Outpaint / expand the image to aspect ratio ${value} (${orientation}).`,
    "Keep the original subject, products, logos, and all existing content fully intact — do NOT crop, zoom-in, stretch, or cut off any part of the source.",
    "Only generate new matching background / scene continuation in the empty padded margins to fill the new canvas.",
    "Extend lighting, colors, and style seamlessly from the original edges; no letterbox bars left in the final image."
  ].join(" ");
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
