/**
 * Brand kangaroo IP branch — keep this gate strict and the constraint text intact.
 *
 * ON  → brief mentions 美团 / Meituan / 品牌袋鼠, or an edit session already locked brand-kangaroo
 * OFF → everything else (including bare「袋鼠」as a free subject word)
 */

const MEITUAN_HINT = /美团|美團|meituan|品牌袋鼠/i;

/** Full Meituan yellow kangaroo identity lock — do not shorten when injecting. */
export const BRAND_KANGAROO_CONSTRAINT =
  "Hero must match the brand kangaroo reference exactly: 美团黄色袋鼠 / Meituan yellow kangaroo IP, side or 3/4 profile, bright yellow smooth vinyl, cream belly pouch, long rounded ears, small black oval eye separate from solid black oval nose, short stubby limbs, thick all-yellow tapering tail, matte vinyl toy style. Keep the same mascot identity as the reference; change only pose and scene for the campaign. Do not redraw as a different animal or cartoon.";

export const BRAND_KANGAROO_CONSTRAINT_SHORT =
  "Hero: 美团袋鼠 / Meituan yellow kangaroo IP from the reference images. Look: side or 3/4 profile; bright yellow smooth vinyl; cream belly pouch; long rounded ears; small black oval eye; separate black oval nose on the snout; short stubby limbs; thick all-yellow tail. Keep the same mascot identity as the references; change pose and scene to fit the campaign.";

export function promptMentionsBrandIp(prompt = "") {
  return MEITUAN_HINT.test(String(prompt || ""));
}

export function shouldUseBrandKangaroo(request = {}) {
  if (promptMentionsBrandIp(request?.prompt)) return true;
  const isAdjustment = Boolean(request?.sessionId || request?.generationType === "image-edit");
  return isAdjustment && request?.brandAsset === "brand-kangaroo";
}

export function resolveBrandAsset(request = {}) {
  return shouldUseBrandKangaroo(request) ? "brand-kangaroo" : "none";
}
