export const TEMPLATE_OPTIONS = [
  {
    id: "festival",
    label: "节日活动",
    icon: "✦",
    prompt:
      "生成一张七夕主题的品牌袋鼠活动海报，竖版 1080x1920，整体使用温暖的粉色和橙色，袋鼠手持玫瑰，背景有星河和爱心元素，预留活动标题和优惠信息区域。"
  },
  {
    id: "sale",
    label: "大促海报",
    icon: "%",
    prompt:
      "生成一张品牌袋鼠参与的电商大促海报，9:16 竖版，主色使用橙色和暖黄色，袋鼠做出热情推荐动作，加入折扣标签、礼盒和动感光效，顶部预留活动名称，底部预留价格与优惠信息区域。"
  },
  {
    id: "launch",
    label: "新品发布",
    icon: "↗",
    prompt:
      "生成一张新品发布营销海报，品牌袋鼠站在产品旁做展示动作，画面简洁有高级质感，使用品牌橙色与深色背景，突出新品轮廓和核心卖点，预留新品名称、发布日期与三条卖点区域。"
  },
  {
    id: "product",
    label: "商品主图",
    icon: "◇",
    prompt:
      "生成一张电商商品主图，品牌袋鼠在商品右侧做推荐手势，商品居中且视觉优先，背景干净明亮，加入少量品牌橙色装饰，1:1 方形，预留商品名称和核心卖点区域。"
  },
  {
    id: "social",
    label: "社交媒体 Banner",
    icon: "#",
    prompt:
      "生成一张适合社交媒体发布的品牌活动 Banner，16:9 横版，品牌袋鼠位于左侧，右侧预留标题、短文案和行动按钮区域，画面轻快现代，使用橙色、奶油黄和少量青绿色。"
  },
  {
    id: "store",
    label: "门店活动",
    icon: "⌂",
    prompt:
      "生成一张线下门店活动宣传海报，品牌袋鼠站在门店入口挥手迎宾，背景包含门店橱窗、气球和活动立牌，整体明亮亲切，3:4 竖版，预留门店地址、活动时间和到店福利区域。"
  },
  {
    id: "ip",
    label: "品牌 IP 宣传",
    icon: "K",
    prompt:
      "生成一张品牌 IP 宣传视觉，突出品牌袋鼠的亲和力和识别度，袋鼠正面站立并做招手动作，背景使用简洁的品牌橙色渐变和图形元素，画面适合品牌官方账号发布，预留品牌口号区域。"
  },
  {
    id: "recruit",
    label: "招商宣传",
    icon: "◎",
    prompt:
      "生成一张品牌招商宣传海报，品牌袋鼠以专业自信的姿态介绍合作机会，背景包含城市商业空间与增长趋势图形，使用高级橙金配色，9:16 竖版，预留招商标题、合作优势和联系方式区域。"
  }
];

export const BRAND_OPTIONS = [
  { value: "brand-kangaroo", label: "品牌袋鼠", icon: "K" },
  { value: "brand-elephant", label: "品牌小象", icon: "E" },
  { value: "brand-mascot", label: "品牌吉祥物", icon: "M" },
  { value: "custom-brand-character", label: "自定义品牌形象", icon: "+" }
];

export const GENERATION_TYPES = [
  { value: "text-to-image", label: "文生图" },
  { value: "reference-to-image", label: "参考图生图" },
  { value: "image-edit", label: "图片编辑" }
];

export const RATIO_OPTIONS = [
  { value: "1:1", label: "1:1 方形", size: "1080x1080" },
  { value: "4:3", label: "4:3 横版", size: "1200x900" },
  { value: "16:9", label: "16:9 横版", size: "1920x1080" },
  { value: "3:4", label: "3:4 竖版", size: "900x1200" },
  { value: "9:16", label: "9:16 竖版", size: "1080x1920" },
  { value: "custom", label: "自定义尺寸", size: "" }
];

export const IMAGE_COUNTS = [1, 2, 4];

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
    prompt:
      "请保持当前海报的主题、品牌 IP 和整体风格不变，只调整袋鼠的姿势，让它改成更活泼、更有动感的姿态。"
  },
  {
    id: "background",
    label: "调整背景",
    icon: "✦",
    prompt:
      "请保持袋鼠形象、主体位置和整体构图不变，丰富背景细节，让背景更有节日氛围和层次感。"
  },
  {
    id: "color",
    label: "调整配色",
    icon: "◐",
    prompt:
      "请保持当前设计内容不变，将整体色彩调整得更温暖、更明亮，增强品牌感和营销氛围。"
  },
  {
    id: "composition",
    label: "调整构图",
    icon: "▣",
    prompt:
      "请保留当前主体、品牌 IP 和视觉风格，将构图调整为适合电商营销使用的 9:16 竖版比例，并确保主体完整。"
  },
  {
    id: "promo",
    label: "增强促销氛围",
    icon: "★",
    prompt:
      "请保持袋鼠和主视觉不变，增加促销活动氛围、优惠视觉元素和更清晰的营销信息留白区域。"
  },
  {
    id: "replace-bg",
    label: "更换背景",
    icon: "◌",
    prompt:
      "请保持袋鼠主体和当前风格不变，将背景替换为更符合七夕节日氛围的星河、灯笼和浪漫光影场景。"
  },
  {
    id: "custom",
    label: "自定义调整",
    icon: "+",
    prompt: ""
  }
];

export const MORE_ADJUSTMENT_EXAMPLES = [
  "袋鼠改成双手比心",
  "背景换成夜晚城市街景",
  "减少背景装饰，让画面更简洁",
  "改成高级黑金配色",
  "主体缩小一些，给顶部标题留出空间",
  "改成适合小红书封面的比例"
];

export const PROGRESS_STEPS = [
  { threshold: 5, label: "正在理解营销需求" },
  { threshold: 22, label: "正在生成创作方案" },
  { threshold: 38, label: "正在调用品牌 IP 模型" },
  { threshold: 55, label: "正在生成图片" },
  { threshold: 78, label: "正在进行内容安全审核" },
  { threshold: 94, label: "即将展示生成结果" }
];

export const DEFAULT_FORM = Object.freeze({
  prompt: "",
  brandAsset: "brand-kangaroo",
  generationType: "text-to-image",
  ratio: "9:16",
  customWidth: 1080,
  customHeight: 1920,
  imageCount: 2,
  styles: ["品牌官方", "节日氛围"],
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
