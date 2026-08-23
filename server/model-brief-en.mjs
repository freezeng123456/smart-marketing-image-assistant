/**
 * Convert user-facing briefs (often Chinese on the webpage) into English
 * before they are sent to external image models. UI copy stays unchanged.
 */

const HAS_CJK = /[\u4e00-\u9fff]/;

/** Exact Chinese briefs currently shipped in the product → English for model calls. */
const BRIEF_EN = new Map([
  [
    "根据参考图做一张电商大促海报，保留原有橙色主色、Shopee 标识、主标题数字和商品元素，改成竖版 9:16 适合手机的构图，预留促销文案区。",
    "Based on the reference image, create an e-commerce mega-sale poster. Keep the original orange palette, Shopee branding, headline numbers, and product elements. Recompose for a vertical 9:16 mobile layout and leave room for promo copy."
  ],
  [
    "美团外卖大促竖版海报。严格保留参考图里的美团黄色袋鼠IP外形，侧脸或3/4，姿势改为举起披萨。明亮暖橙到金黄营销背景，但主体与背景要拉开层次：袋鼠身后有柔和白色/浅金光晕，周围点缀少量礼盒或光点，上下留白区稍暗一点橙。禁止暗黑夜景、血红霓虹、纯平同色黄底把袋鼠淹没。全出血。不要腮红，不要换动物，画面不要写字。",
    "Meituan food-delivery mega-sale vertical poster. Strictly keep the Meituan yellow kangaroo IP look from the references: side or 3/4 profile; change the pose to holding up a pizza. Bright warm orange-to-gold marketing background with clear subject/background separation: soft white/light-gold glow behind the kangaroo, a few gift boxes or sparkles around it, slightly darker orange in the top/bottom margins. No dark night streets, blood-red neon, or flat same-color yellow that swallows the mascot. Full bleed. No blush, no different animal, no on-image text."
  ],
  [
    "七夕主题活动海报，暖粉与金色配色，星河灯笼与花瓣氛围，竖版 9:16 全出血，商业插画质感，预留标题与优惠信息区。",
    "Qixi festival campaign poster, warm pink and gold palette, starry sky lanterns and petal atmosphere, vertical 9:16 full bleed, commercial illustration look, leave space for title and promo info."
  ],
  [
    "电商大促海报，橙红主色，折扣标签与礼盒光效，动感营销风，竖版 9:16 全出血，主体突出、文案区清晰。",
    "E-commerce mega-sale poster, orange-red primary colors, discount tags and gift-box light effects, energetic marketing style, vertical 9:16 full bleed, strong subject and clear copy area."
  ],
  [
    "新品发布海报，产品居中展示，简洁高级，深色背景与点缀光效，竖版 9:16 全出血，预留品牌名与卖点文案区。",
    "New-product launch poster, product centered, clean premium look, dark background with accent lighting, vertical 9:16 full bleed, leave space for brand name and selling points."
  ],
  [
    "电商商品主图，商品居中，干净明亮背景，轻微阴影，1:1 方形，轻量品牌色点缀，适合详情页头图。",
    "E-commerce product hero shot, product centered, clean bright background, soft shadow, 1:1 square, light brand-color accents, suitable as a detail-page header."
  ],
  [
    "社交媒体 Banner，左侧主视觉、右侧开阔文案区，奶油黄与浅蓝配色，横版 16:9 全出血，轻快现代。",
    "Social media banner, main visual on the left and open copy area on the right, cream yellow and light blue palette, landscape 16:9 full bleed, light modern feel."
  ],
  [
    "线下门店开业活动海报，橱窗气球立牌与迎宾氛围，明亮亲切，竖版 3:4 全出血，预留活动时间与地址区。",
    "Offline store grand-opening poster, window balloons, standees and welcoming vibe, bright and friendly, vertical 3:4 full bleed, leave space for event time and address."
  ],
  [
    "美团品牌宣传视觉，美团黄色袋鼠侧脸或 3/4 站姿招手，简洁橙色渐变背景，突出 IP 识别度，竖版全出血。",
    "Meituan brand campaign visual featuring the Meituan yellow kangaroo in side or 3/4 standing wave pose, simple orange gradient background, strong IP recognition, vertical full bleed."
  ],
  [
    "招商合作宣传海报，城市商业与增长图形，蓝金配色，专业自信，竖版 9:16 全出血，预留合作卖点文案区。",
    "Partnership / merchant recruitment poster, city commerce and growth graphics, blue-gold palette, professional confident tone, vertical 9:16 full bleed, leave space for partnership selling points."
  ],
  [
    "设计一张七夕主题大促海报，暖粉金色调，星河灯笼与花瓣氛围，竖版构图，预留活动标题和优惠文案区，商业插画质感。",
    "Design a Qixi-themed mega-sale poster, warm pink-gold tones, starry lanterns and petal atmosphere, vertical composition, leave space for event title and promo copy, commercial illustration quality."
  ],
  [
    "电商产品营销图，商品居中展示，干净明亮背景，轻微阴影与高光，突出材质细节，预留左侧或底部卖点文案区。",
    "E-commerce product marketing shot, product centered, clean bright background, soft shadow and highlights, emphasize material detail, leave selling-point copy space on the left or bottom."
  ],
  [
    "品牌形象宣传海报，简洁高级，主色与辅助色对比清晰，留白充足，适合放品牌口号和主视觉，竖版全出血。",
    "Brand image poster, clean and premium, clear primary/secondary color contrast, generous negative space for slogan and hero visual, vertical full bleed."
  ],
  [
    "线下门店开业运营海报，明亮亲切，橱窗气球与迎宾氛围，突出活动时间和地址，竖版构图，信息层级清楚。",
    "Offline store opening operations poster, bright and friendly, window balloons and welcoming vibe, highlight event time and address, vertical composition, clear information hierarchy."
  ],
  [
    "保持主体身份和海报主题，只把姿势改成更活泼有动感。",
    "Keep the subject identity and poster theme; only change the pose to something more lively and dynamic."
  ],
  [
    "保持主体与构图，丰富背景层次，加强节日营销氛围。",
    "Keep the subject and composition; enrich background layers and strengthen the festive marketing atmosphere."
  ],
  [
    "保持设计内容，配色更温暖明亮，增强整体氛围。",
    "Keep the design content; make colors warmer and brighter to enhance the overall mood."
  ],
  [
    "保持主体与风格，改为适合电商的 9:16 竖版，主体完整全出血。",
    "Keep the subject and style; convert to ecommerce-friendly 9:16 vertical with a complete full-bleed subject."
  ],
  [
    "保持主视觉，加强促销氛围、优惠视觉与清晰信息留白。",
    "Keep the hero visual; strengthen promo atmosphere, discount cues, and clear information whitespace."
  ],
  [
    "保持主体不变，背景换成星河灯笼与浪漫光影。",
    "Keep the subject unchanged; replace the background with starry lanterns and romantic lighting."
  ]
]);

function normalizeKey(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，。；：！？、]/g, (ch) => {
      const map = { "，": ",", "。": ".", "；": ";", "：": ":", "！": "!", "？": "?", "、": "," };
      return map[ch] || ch;
    });
}

const BRIEF_EN_NORM = new Map([...BRIEF_EN.entries()].map(([zh, en]) => [normalizeKey(zh), en]));

async function translateChineseBrief(text, { fetchImpl = globalThis.fetch, logger } = {}) {
  if (typeof fetchImpl !== "function") return text;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=zh-CN|en-US`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) return text;
    const payload = await response.json();
    const translated = String(payload?.responseData?.translatedText || "").trim();
    if (!translated || HAS_CJK.test(translated)) return text;
    // Avoid MyMemory "QUERY LENGTH LIMIT" style errors leaking through
    if (/MYMEMORY|QUERY LENGTH|INVALID/i.test(translated)) return text;
    return translated;
  } catch (error) {
    logger?.warn?.(`[prompt-en] translate fallback: ${error?.message || error}`);
    return text;
  }
}

/**
 * Return an English brief for external model calls.
 * Brand / session gates should still use the original request.prompt.
 */
export async function toEnglishBrief(prompt, { fetchImpl = globalThis.fetch, logger } = {}) {
  const text = String(prompt || "").trim();
  if (!text) return "";
  if (!HAS_CJK.test(text)) return text;
  if (BRIEF_EN.has(text)) return BRIEF_EN.get(text);
  const norm = normalizeKey(text);
  if (BRIEF_EN_NORM.has(norm)) return BRIEF_EN_NORM.get(norm);
  return translateChineseBrief(text, { fetchImpl, logger });
}

/** Clone request with English prompt for model providers (keeps other fields). */
export async function withEnglishModelPrompt(request, opts = {}) {
  const prompt = await toEnglishBrief(request?.prompt, opts);
  if (prompt === request?.prompt) return request;
  return { ...request, prompt };
}
