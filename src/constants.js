
/** First-visit starter cases shown on the create page. */
export const DEFAULT_CASES = [
  {
    id: "shopee-ref",
    sessionId: "demo-session-shopee-ref",
    label: "Shopee 参考图改版",
    blurb: "上传/带参考图做大促改版，不注入美团袋鼠。",
    prompt:
      "根据参考图做一张电商大促海报，保留原有橙色主色、Shopee 标识、主标题数字和商品元素，改成竖版 9:16 适合手机的构图，预留促销文案区。",
    ratio: "9:16",
    size: "1080x1920",
    selectedSlots: [{ id: "splash", label: "开屏广告", width: 1080, height: 1920 }],
    modelId: "modelscope-qwen-edit",
    brandAsset: "none",
    resultUrl: "/assets/demo/shopee-result.png?v=2",
    referenceImages: [
      {
        id: "demo-shopee-ref",
        fileName: "shopee-super-shopping.png",
        url: "/assets/demo/shopee-super-shopping.png",
        previewUrl: "/assets/demo/shopee-super-shopping.png",
        status: "ready"
      }
    ]
  },
  {
    id: "meituan-kangaroo",
    sessionId: "demo-session-meituan-kangaroo",
    label: "美团袋鼠 IP",
    blurb: "文案含「美团」时自动锁定黄色袋鼠身份，姿势场景可变。",
    prompt:
      "美团外卖夜宵大促海报，美团黄色袋鼠侧脸或 3/4 站姿举着披萨，霓虹夜市氛围，橙黄主色，竖版 9:16 全出血，预留标题和优惠信息区域。保持美团黄色袋鼠品牌 IP 识别度。",
    ratio: "9:16",
    size: "1080x1920",
    selectedSlots: [{ id: "splash", label: "开屏广告", width: 1080, height: 1920 }],
    modelId: "modelscope-qwen-edit",
    brandAsset: "brand-kangaroo",
    resultUrl: "/assets/demo/meituan-kangaroo-result.png?v=2",
    referenceImages: []
  }
];

/** Build completed history sessions that mirror DEFAULT_CASES (already-run look). */
export function buildDemoSessions(now = new Date().toISOString()) {
  return DEFAULT_CASES.map((item, index) => {
    const createdAt = new Date(Date.now() - (index + 1) * 60_000).toISOString();
    const image = {
      id: `${item.sessionId}-image-1`,
      url: item.resultUrl,
      status: "FINISH",
      prompt: item.prompt,
      model: item.modelId === "modelscope-qwen-edit" ? "modelscope/Qwen/Qwen-Image-Edit" : item.modelId,
      auditStatus: "PASSED",
      favorite: false
    };
    return {
      sessionId: item.sessionId,
      title: item.label,
      theme: item.label,
      demoCaseId: item.id,
      messages: [
        {
          id: `${item.sessionId}-user`,
          role: "user",
          content: item.prompt,
          createdAt
        },
        {
          id: `${item.sessionId}-assistant`,
          role: "assistant",
          content: "已完成第 1 版，共生成 1 张图片。",
          createdAt,
          version: 1,
          images: [image]
        }
      ],
      currentImageUrl: item.resultUrl,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          prompt: item.prompt,
          images: [image],
          createdAt,
          brandAsset: item.brandAsset,
          generationType: "text-to-image",
          ratio: item.ratio,
          size: item.size || "1080x1920",
          styles: [],
          imageCount: 1,
          referenceImages: (item.referenceImages || []).map((ref) => ref.url),
          contextImageUrl: "",
          parentVersion: 0,
          taskId: `${item.sessionId}-task`,
          assistantMessageId: `${item.sessionId}-assistant`,
          watermark: "图片由智能营销生图助手生成"
        }
      ],
      createdAt,
      updatedAt: createdAt,
      brandAsset: item.brandAsset,
      ratio: item.ratio,
      styles: [],
      status: "DONE",
      lastError: "",
      taskId: `${item.sessionId}-task`,
      assistantMessageId: `${item.sessionId}-assistant`,
      lastRequest: {
        prompt: item.prompt,
        brandAsset: item.brandAsset,
        generationType: "text-to-image",
        ratio: item.ratio,
        size: item.size || "1080x1920",
        styles: [],
        imageCount: 1,
        modelId: item.modelId,
        referenceImages: (item.referenceImages || []).map((ref) => ref.url)
      }
    };
  });
}

export const TEMPLATE_OPTIONS = [
  {
    id: "festival",
    label: "节日活动",
    icon: "✦",
    prompt:
      "七夕主题活动海报，暖粉与金色配色，星河灯笼与花瓣氛围，竖版 9:16 全出血，商业插画质感，预留标题与优惠信息区。"
  },
  {
    id: "sale",
    label: "大促海报",
    icon: "%",
    prompt:
      "电商大促海报，橙红主色，折扣标签与礼盒光效，动感营销风，竖版 9:16 全出血，主体突出、文案区清晰。"
  },
  {
    id: "launch",
    label: "新品发布",
    icon: "↗",
    prompt:
      "新品发布海报，产品居中展示，简洁高级，深色背景与点缀光效，竖版 9:16 全出血，预留品牌名与卖点文案区。"
  },
  {
    id: "product",
    label: "商品主图",
    icon: "◇",
    prompt:
      "电商商品主图，商品居中，干净明亮背景，轻微阴影，1:1 方形，轻量品牌色点缀，适合详情页头图。"
  },
  {
    id: "social",
    label: "社交媒体 Banner",
    icon: "#",
    prompt:
      "社交媒体 Banner，左侧主视觉、右侧开阔文案区，奶油黄与浅蓝配色，横版 16:9 全出血，轻快现代。"
  },
  {
    id: "store",
    label: "门店活动",
    icon: "⌂",
    prompt:
      "线下门店开业活动海报，橱窗气球立牌与迎宾氛围，明亮亲切，竖版 3:4 全出血，预留活动时间与地址区。"
  },
  {
    id: "ip",
    label: "美团袋鼠 IP",
    icon: "K",
    prompt:
      "美团品牌宣传视觉，美团黄色袋鼠侧脸或 3/4 站姿招手，简洁橙色渐变背景，突出 IP 识别度，竖版全出血。"
  },
  {
    id: "recruit",
    label: "招商宣传",
    icon: "◎",
    prompt:
      "招商合作宣传海报，城市商业与增长图形，蓝金配色，专业自信，竖版 9:16 全出血，预留合作卖点文案区。"
  }
];

export const BRAND_OPTIONS = [
  { value: "none", label: "无品牌 IP", icon: "—" },
  { value: "brand-kangaroo", label: "品牌袋鼠", icon: "K" },
  { value: "brand-elephant", label: "品牌小象", icon: "E" },
  { value: "brand-mascot", label: "品牌吉祥物", icon: "M" },
  { value: "custom-brand-character", label: "自定义品牌形象", icon: "+" }
];

/** Same gate as server/brand-policy.mjs — only 美团 / Meituan / 品牌袋鼠. */
export function promptMentionsBrandIp(prompt = "") {
  return /美团|美團|meituan|品牌袋鼠/i.test(String(prompt || ""));
}

export function resolveBrandAssetFromPrompt(prompt, { isAdjustment = false, previousBrandAsset = "none" } = {}) {
  if (promptMentionsBrandIp(prompt)) return "brand-kangaroo";
  if (isAdjustment && previousBrandAsset === "brand-kangaroo") return "brand-kangaroo";
  return "none";
}

export const GENERATION_TYPES = [
  { value: "text-to-image", label: "文生图" },
  { value: "reference-to-image", label: "参考图生图" },
  { value: "image-edit", label: "图片编辑" }
];

/** Common marketing / app placement sizes (multi-select). */
export const RESOURCE_SLOT_OPTIONS = [
  { id: "splash", label: "开屏广告", width: 1080, height: 1920, tip: "启动全屏" },
  { id: "home-popup", label: "首页弹窗", width: 800, height: 600, tip: "活动弹窗" },
  { id: "banner", label: "横幅广告", width: 1200, height: 300, tip: "通栏 Banner" },
  { id: "feed-square", label: "信息流方图", width: 1080, height: 1080, tip: "朋友圈/信息流" },
  { id: "feed-landscape", label: "信息流横图", width: 1280, height: 720, tip: "16:9 大图" },
  { id: "poster-portrait", label: "竖版海报", width: 1080, height: 1440, tip: "3:4 种草" },
  { id: "header", label: "频道头图", width: 1125, height: 603, tip: "顶通/头图" },
  { id: "product-main", label: "商品主图", width: 800, height: 800, tip: "电商主图" }
];

export const RATIO_OPTIONS = [
  { value: "1:1", label: "1:1 方形", size: "1080x1080" },
  { value: "4:3", label: "4:3 横版", size: "1200x900" },
  { value: "16:9", label: "16:9 横版", size: "1920x1080" },
  { value: "3:4", label: "3:4 竖版", size: "900x1200" },
  { value: "9:16", label: "9:16 竖版", size: "1080x1920" },
  { value: "custom", label: "自定义尺寸", size: "" }
];

/** Generic examples for「生成示例参考」modal (not the quick-start cases). */
export const EXAMPLE_CATEGORIES = [
  {
    id: "festival",
    label: "节日大促宣传图",
    description: "为七夕、国庆、双11 等节日活动生成的营销海报，突出节日氛围和促销信息。",
    prompt: "设计一张七夕主题大促海报，暖粉金色调，星河灯笼与花瓣氛围，竖版构图，预留活动标题和优惠文案区，商业插画质感。",
    tips: [
      "描述活动场景和主角动作",
      "指定背景元素和装饰风格",
      "说明色彩倾向和构图比例",
      "突出促销信息和节日元素"
    ]
  },
  {
    id: "product",
    label: "产品营销图",
    description: "突出单品卖点与质感，适合详情页主图、信息流投放和种草笔记封面。",
    prompt: "电商产品营销图，商品居中展示，干净明亮背景，轻微阴影与高光，突出材质细节，预留左侧或底部卖点文案区。",
    tips: [
      "写清产品品类、材质和卖点",
      "说明背景是纯色、场景还是台面",
      "指定光线方向和质感风格",
      "预留价格或卖点文字区域"
    ]
  },
  {
    id: "brand",
    label: "品牌宣传图",
    description: "强化品牌识别与气质，适合品牌专题页、招商物料和形象广告。",
    prompt: "品牌形象宣传海报，简洁高级，主色与辅助色对比清晰，留白充足，适合放品牌口号和主视觉，竖版全出血。",
    tips: [
      "说明品牌气质（年轻、专业、国潮等）",
      "指定主色与辅助色",
      "描述主视觉元素和构图重心",
      "预留 slogan 或品牌名位置"
    ]
  },
  {
    id: "daily",
    label: "日常运营图",
    description: "门店活动、会员日、日常推送等轻量运营物料，强调清晰信息与行动引导。",
    prompt: "线下门店开业运营海报，明亮亲切，橱窗气球与迎宾氛围，突出活动时间和地址，竖版构图，信息层级清楚。",
    tips: [
      "写清活动时间、地点和福利",
      "说明画面主体是门店、人物还是商品",
      "保持信息区可读、不拥挤",
      "指定投放渠道（社群、门店屏等）"
    ]
  }
];

export const IMAGE_COUNTS = [1];

export const STYLE_OPTIONS = [
  "品牌官方",
  "电商促销",
  "清新插画",
  "高级质感",
  "节日氛围",
  "3D 潮玩",
  "扁平插画",
  "摄影写实"
];

export const ADJUSTMENT_OPTIONS = [
  {
    id: "pose",
    label: "调整姿势",
    icon: "↗",
    prompt: "保持主体身份和海报主题，只把姿势改成更活泼有动感。"
  },
  {
    id: "background",
    label: "调整背景",
    icon: "✦",
    prompt: "保持主体与构图，丰富背景层次，加强节日营销氛围。"
  },
  {
    id: "color",
    label: "调整配色",
    icon: "◐",
    prompt: "保持设计内容，配色更温暖明亮，增强整体氛围。"
  },
  {
    id: "composition",
    label: "调整构图",
    icon: "▣",
    prompt: "保持主体与风格，改为适合电商的 9:16 竖版，主体完整全出血。"
  },
  {
    id: "promo",
    label: "增强促销氛围",
    icon: "★",
    prompt: "保持主视觉，加强促销氛围、优惠视觉与清晰信息留白。"
  },
  {
    id: "replace-bg",
    label: "更换背景",
    icon: "◌",
    prompt: "保持主体不变，背景换成星河灯笼与浪漫光影。"
  },
  {
    id: "custom",
    label: "自定义调整",
    icon: "+",
    prompt: ""
  }
];

export const MORE_ADJUSTMENT_EXAMPLES = [
  "主体改成双手比心",
  "背景换成夜晚城市街景",
  "减少背景装饰，让画面更简洁",
  "改成高级黑金配色",
  "主体缩小一些，给顶部标题留出空间",
  "改成适合小红书封面的比例"
];

export const PROGRESS_STEPS = [
  { threshold: 5, label: "正在理解营销需求" },
  { threshold: 22, label: "正在生成创作方案" },
  { threshold: 38, label: "正在调用生图模型" },
  { threshold: 55, label: "正在生成图片" },
  { threshold: 78, label: "正在进行内容安全审核" },
  { threshold: 94, label: "即将展示生成结果" }
];

export const DEFAULT_FORM = Object.freeze({
  prompt: "",
  brandAsset: "none",
  generationType: "text-to-image",
  modelId: "modelscope-zimage",
  ratio: "9:16",
  customWidth: 800,
  customHeight: 600,
  selectedSlots: [
    { id: "splash", label: "开屏广告", width: 1080, height: 1920 }
  ],
  imageCount: 1,
  styles: [],
  referenceImages: []
});

export const STATUS_LABELS = {
  SUBMITTED: "已提交",
  RUNNING: "生成中",
  DONE: "已完成",
  FINISH: "已完成",
  FAILED: "失败",
  TIMEOUT: "等待超时",
  ABORTED: "已取消",
  AUDIT_FAILED: "审核未通过"
};
