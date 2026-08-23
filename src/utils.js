export function uid(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
  }).format(date);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function truncate(value, max = 42) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}


export function getRuntimeConfig() {
  const config = globalThis.__MARKETING_ASSISTANT_CONFIG__ || {};
  const urlMode =
    typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("api")
      : null;
  const configuredMode = urlMode || config.apiMode || "auto";
  const isLocal =
    typeof location !== "undefined" &&
    ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const apiMode =
    configuredMode === "auto" ? (isLocal ? "mock" : "functions") : configuredMode;

  return {
    apiMode,
    functionsBaseUrl: String(config.functionsBaseUrl || "").replace(/\/$/, ""),
    pollIntervalMs: clamp(config.pollIntervalMs || 3000, 2000, 10000),
    requestTimeoutMs: clamp(config.requestTimeoutMs || 30000, 5000, 120000),
    maxPollErrors: clamp(config.maxPollErrors || 3, 1, 10)
  };
}

const UNSAFE_PATTERNS = [
  /儿童.{0,4}(色情|裸照|性行为)/i,
  /(血腥肢解|真实肢解|极端虐杀)/i,
  /(恐怖主义|极端组织).{0,8}(宣传|招募|赞美)/i,
  /(仇恨|种族).{0,8}(清洗|灭绝|暴力)/i,
  /(露骨色情|强奸场景|性侵场景)/i
];

const BRAND_GUARD_PATTERNS = [
  /(删除|替换|抹掉).{0,8}(品牌袋鼠|品牌\s*IP|吉祥物)/i,
  /(破坏|丑化|肢解|严重变形).{0,8}(品牌袋鼠|品牌\s*IP|吉祥物)/i,
  /(绕过|关闭).{0,5}(审核|安全策略)/i,
  /(输出|暴露|告诉我).{0,8}(内部模型参数|API\s*Key|token|密钥)/i
];

export function validateMarketingPrompt(prompt) {
  const value = String(prompt || "").trim();
  if (!value) {
    return { ok: false, kind: "empty", message: "请先描述你想生成的营销素材。" };
  }
  if (value.length > 3000) {
    return {
      ok: false,
      kind: "length",
      message: "描述内容过长，请控制在 3000 字以内。"
    };
  }
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(value))) {
    return {
      ok: false,
      kind: "safety",
      message: "当前描述包含不适合生成的内容，请调整后重试。"
    };
  }
  if (BRAND_GUARD_PATTERNS.some((pattern) => pattern.test(value))) {
    return {
      ok: false,
      kind: "brand",
      message: "当前调整可能与品牌 IP 规范冲突，请保留品牌形象的基本识别特征后重试。"
    };
  }
  return { ok: true, kind: "ok", message: "" };
}

export function normalizeErrorMessage(error, fallback = "服务暂时不可用，请稍后重试。") {
  const text = String(error?.message || error || "").trim();
  if (/审核|audit|unsafe|safety/i.test(text)) {
    return "当前需求或生成结果未通过内容安全审核，请调整描述后重试。";
  }
  if (/timeout|超时/i.test(text)) {
    return "本次生成等待时间较长，任务可能仍在后台处理。你可以稍后查看历史记录，或重新发起生成。";
  }
  if (/network|fetch|网络|连接/i.test(text)) return fallback;
  return text || fallback;
}

export function deriveTitle(prompt) {
  const cleaned = String(prompt || "")
    .replace(/^(请|帮我|生成|设计|制作|创建)\s*/i, "")
    .replace(/[。！？].*$/s, "")
    .trim();
  return truncate(cleaned || "未命名营销创作", 24);
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
