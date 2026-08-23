import {
  TEMPLATE_OPTIONS,
  DEFAULT_CASES,
  EXAMPLE_CATEGORIES,
  RESOURCE_SLOT_OPTIONS,
  BRAND_OPTIONS,
  GENERATION_TYPES,
  RATIO_OPTIONS,
  IMAGE_COUNTS,
  STYLE_OPTIONS,
  ADJUSTMENT_OPTIONS,
  MORE_ADJUSTMENT_EXAMPLES,
  PROGRESS_STEPS,
  DEFAULT_FORM,
  STATUS_LABELS,
  resolveBrandAssetFromPrompt,
  buildDemoSessions
} from "./constants.js";
import { api } from "./api/client.js";
import { store } from "./store.js";
import {
  uid,
  escapeHtml,
  formatDate,
  truncate,
  buildSize,
  validateMarketingPrompt,
  normalizeErrorMessage,
  deriveTitle,
  uniqueBy
} from "./utils.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  views: $$(".page-section, .page-view"),
  navItems: $$("[data-nav]"),
  apiBadge: $("#api-mode-badge"),
  form: $("#generation-form"),
  prompt: $("#marketing-prompt"),
  promptCount: $("#prompt-count"),
  promptError: $("#prompt-error"),
  templateGrid: $("#template-grid"),
  brandOptions: $("#brand-options"),
  generationTypes: $("#generation-types"),
  imageCounts: $("#image-counts"),
  modelSelect: $("#model-select"),
  modelHint: $("#model-hint"),
  modelExhaustedNote: $("#model-exhausted-note"),
  ratioOptions: $("#ratio-options"),
  sizePreview: $("#size-preview"),
  customSizeRow: $("#custom-size-row"),
  slotSummaryCount: $("#slot-summary-count"),
  slotSummaryList: $("#slot-summary-list"),
  slotTags: $("#slot-tags"),
  slotOptions: $("#slot-options"),
  addCustomSlot: $("#add-custom-slot"),
  customWidth: $("#custom-width"),
  customHeight: $("#custom-height"),
  styleOptions: $("#style-options"),
  styleLimit: $("#style-limit"),
  uploadZone: $("#upload-zone"),
  referenceInput: $("#reference-input"),
  referenceList: $("#reference-list"),
  uploadCount: $("#upload-count"),
  submitSummary: $("#submit-summary span:last-child"),
  generateButton: $("#generate-button"),
  generateLabel: $("#generate-button .button-label"),
  newCreation: $("#new-creation"),
  historyEntry: $("#history-entry"),
  openExamples: $("#open-examples"),
  defaultCases: $("#default-cases"),
  emptyStage: $("#empty-stage"),
  progressCard: $("#progress-card"),
  errorCard: $("#error-card"),
  resultSection: $("#result-section"),
  progressRing: $("#progress-ring"),
  progressNumber: $("#progress-number"),
  progressMessage: $("#progress-message"),
  progressBarFill: $("#progress-bar-fill"),
  progressSteps: $("#progress-steps"),
  taskStatusBadge: $("#task-status-badge"),
  partialResults: $("#partial-results"),
  cancelTask: $("#cancel-task"),
  errorTitle: $("#error-title"),
  errorMessage: $("#error-message"),
  retryTask: $("#retry-task"),
  errorHistory: $("#error-history"),
  resultTime: $("#result-time"),
  resultMeta: $("#result-meta"),
  imageGrid: $("#image-grid"),
  adjustmentPills: $("#adjustment-pills"),
  adjustmentInput: $("#adjustment-input"),
  adjustmentExamples: $("#adjustment-examples"),
  submitAdjustment: $("#submit-adjustment"),
  sessionIdDisplay: $("#session-id-display"),
  versionStrip: $("#version-strip"),
  historySearch: $("#history-search"),
  historyStatusFilter: $("#history-status-filter"),
  historyGrid: $("#history-grid"),
  historyEmpty: $("#history-empty"),
  portfolioUpdated: $("#portfolio-updated"),
  folderCount: $("#folder-count"),
  folderGrid: $("#folder-grid"),
  workCount: $("#work-count"),
  portfolioFilter: $("#portfolio-filter"),
  portfolioGrid: $("#portfolio-grid"),
  exampleModal: $("#example-modal"),
  exampleTabs: $("#example-tabs"),
  exampleContent: $("#example-content"),
  detailModal: $("#detail-modal"),
  detailContent: $("#detail-content"),
  lightboxModal: $("#lightbox-modal"),
  lightboxImage: $("#lightbox-image"),
  lightboxMeta: $("#lightbox-meta"),
  lightboxPrev: $("#lightbox-prev"),
  lightboxNext: $("#lightbox-next"),
  toastRegion: $("#toast-region")
};

const persistedDraft = store.getDraft();
const restoredReferences = Array.isArray(persistedDraft?.referenceImages)
  ? persistedDraft.referenceImages.filter((item) => item?.url && !String(item.url).startsWith("blob:"))
  : [];

const state = {
  currentView: "create",
  form: {
    ...structuredClone(DEFAULT_FORM),
    ...(persistedDraft || {}),
    brandAsset: "none",
    styles: [],
    selectedSlots: Array.isArray(persistedDraft?.selectedSlots) && persistedDraft.selectedSlots.length
      ? persistedDraft.selectedSlots
      : structuredClone(DEFAULT_FORM.selectedSlots),
    referenceImages: restoredReferences.map((item) => ({
      ...item,
      id: item.id || uid("reference"),
      previewUrl: item.previewUrl || item.url,
      status: "ready"
    }))
  },
  sessions: store.ensureDemoSessions(buildDemoSessions()),
  currentSessionId: null,
  activeTask: store.getActiveTask(),
  partialImages: [],
  pollTimer: null,
  pollErrors: 0,
  uploadingCount: 0,
  selectedExample: EXAMPLE_CATEGORIES[0]?.id || "festival",
  selectedCaseId: null,
  historySearch: "",
  historyStatus: "all",
  portfolioCategory: "全部",
  editingImageUrl: null,
  lightboxImages: [],
  lightboxIndex: 0,
  lastErrorKind: "FAILED",
  modelCatalog: [],
  exhaustedChannels: {}
};

function persistSessions() {
  store.saveSessions(state.sessions);
}

function persistDraft() {
  store.saveDraft({
    prompt: state.form.prompt,
    brandAsset: state.form.brandAsset || "none",
    generationType: state.form.generationType,
    modelId: state.form.modelId,
    ratio: state.form.ratio,
    customWidth: state.form.customWidth,
    customHeight: state.form.customHeight,
    selectedSlots: state.form.selectedSlots || [],
    imageCount: 1,
    styles: [...state.form.styles],
    referenceImages: state.form.referenceImages
      .filter((item) => item.status === "ready" && item.url && !String(item.url).startsWith("blob:"))
      .map(({ id, url, previewUrl, fileName, size }) => ({ id, url, previewUrl, fileName, size }))
  });
}

function getSession(sessionId = state.currentSessionId) {
  return state.sessions.find((session) => session.sessionId === sessionId) || null;
}

function updateSession(sessionId, updater) {
  const index = state.sessions.findIndex((session) => session.sessionId === sessionId);
  if (index < 0) return null;
  const next = typeof updater === "function" ? updater(state.sessions[index]) : updater;
  state.sessions[index] = next;
  persistSessions();
  return next;
}

function upsertSession(session) {
  const index = state.sessions.findIndex((item) => item.sessionId === session.sessionId);
  if (index >= 0) state.sessions[index] = session;
  else state.sessions.unshift(session);
  persistSessions();
  return session;
}

function getCurrentVersion(session = getSession()) {
  if (!session?.versions?.length) return null;
  return (
    session.versions.find((version) => version.version === session.currentVersion) ||
    session.versions.at(-1)
  );
}

function getUsableImages(version) {
  return (version?.images || []).filter(
    (image) =>
      image?.url &&
      image.status !== "AUDIT_FAILED" &&
      image.auditStatus !== "FAILED" &&
      isSafeImageUrl(image.url)
  );
}

function brandLabel(value) {
  return BRAND_OPTIONS.find((item) => item.value === value)?.label || value || "无品牌 IP";
}

function ratioLabel(value) {
  return RATIO_OPTIONS.find((item) => item.value === value)?.label || value || "—";
}

function statusClass(status) {
  const normalized = String(status || "").toUpperCase();
  if (["DONE", "FINISH"].includes(normalized)) return "status-done";
  if (["RUNNING", "SUBMITTED"].includes(normalized)) return "status-running";
  if (normalized === "TIMEOUT") return "status-timeout";
  if (normalized === "ABORTED") return "status-aborted";
  return "status-failed";
}


function normalizeAssetUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, location.href);
    // Same-origin absolute links from wrong protocol/host (e.g. https bore while page is http)
    // rewrite to path-only so <img> follows the current page origin.
    if (
      parsed.pathname.startsWith("/generated/") ||
      parsed.pathname.startsWith("/uploads/")
    ) {
      return `${parsed.pathname}${parsed.search || ""}`;
    }
    return parsed.href;
  } catch {
    return raw;
  }
}

function isSafeImageUrl(url) {
  try {
    const parsed = new URL(String(url), location.href);
    if (["http:", "https:", "blob:"].includes(parsed.protocol)) return true;
    if (parsed.protocol === "data:") return String(url).startsWith("data:image/");
    return false;
  } catch {
    return false;
  }
}

function showToast(message, type = "info", duration = 3200) {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "success" ? "is-success" : type === "error" ? "is-error" : ""}`;
  const symbol = type === "success" ? "✓" : type === "error" ? "!" : "i";
  toast.innerHTML = `<span class="toast-symbol">${symbol}</span><p>${escapeHtml(message)}</p>`;
  els.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function setNavActive(view) {
  state.currentView = view;
  els.views.forEach((section) => {
    section.classList.toggle("is-active", section.dataset.view === view);
  });
  $$(".nav-item").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.nav === view)
  );
}

function scrollToSection(view, { behavior = "smooth", focusResult = false } = {}) {
  const section = document.querySelector(`.page-section[data-view="${view}"], .page-view[data-view="${view}"]`);
  if (!section) return;
  state.navLockUntil = Date.now() + 900;
  setNavActive(view);
  if (view === "history") renderHistory();
  if (view === "portfolio") renderPortfolio();
  if (view === "create") renderStageFromState();

  let target = section;
  if (view === "create" && focusResult) {
    target = document.getElementById("creation-result") || section;
  }
  target.scrollIntoView({ behavior, block: "start" });
}

function setView(view) {
  // Back-compat: callers that used page switching now jump within the long page.
  scrollToSection(view, { behavior: "smooth" });
}

function setupSectionSpy() {
  const sections = $$(".page-section[data-view], .page-view[data-view]");
  if (!sections.length || typeof IntersectionObserver !== "function") return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (Date.now() < (state.navLockUntil || 0)) return;
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      const top = visible[0];
      if (!top?.target?.dataset?.view) return;
      const view = top.target.dataset.view;
      if (view !== state.currentView) setNavActive(view);
    },
    {
      root: null,
      // Bias toward the section sitting under the sticky topbar
      rootMargin: "-20% 0px -55% 0px",
      threshold: [0.08, 0.18, 0.32, 0.5]
    }
  );
  sections.forEach((section) => observer.observe(section));
}

function setApiBadge() {
  // API mode badge removed from UI
}


function renderDefaultCases() {
  if (!els.defaultCases) return;
  els.defaultCases.innerHTML = DEFAULT_CASES.map((item) => {
    const thumb =
      item.referenceImages?.[0]?.previewUrl ||
      (item.id === "meituan-kangaroo" ? "/assets/brand-kangaroo.png" : "");
    const thumbClass = item.id === "meituan-kangaroo" ? "default-case-thumb is-kangaroo" : "default-case-thumb";
    return `
      <button class="default-case-card ${state.selectedCaseId === item.id ? "is-selected" : ""}" type="button" data-default-case="${escapeHtml(item.id)}">
        <img class="${thumbClass}" src="${escapeHtml(thumb)}" alt="${escapeHtml(item.label)}" />
        <div class="default-case-meta">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.blurb || "")}</span>
        </div>
      </button>
    `;
  }).join("");
}

function applyDefaultCase(item, { toast = true } = {}) {
  if (!item) return;
  state.selectedCaseId = item.id;
  state.form.prompt = item.prompt;
  state.form.ratio = item.ratio || state.form.ratio;
  if (Array.isArray(item.selectedSlots) && item.selectedSlots.length) {
    state.form.selectedSlots = structuredClone(item.selectedSlots);
  }
  state.form.modelId = item.modelId || state.form.modelId;
  state.form.brandAsset = item.brandAsset || resolveBrandAssetFromPrompt(item.prompt);
  state.form.referenceImages = (item.referenceImages || []).map((ref) => ({
    id: ref.id || uid("reference"),
    fileName: ref.fileName || "reference.png",
    url: ref.url,
    previewUrl: ref.previewUrl || ref.url,
    status: "ready",
    size: ref.size || 0
  }));
  if (els.prompt) {
    els.prompt.value = item.prompt;
    els.promptCount.textContent = `${item.prompt.length} / 3000`;
    els.promptError.textContent = "";
  }
  syncFormToDom();
  renderDefaultCases();
  renderReferences();
  renderModelSelect();
  if (state.form.referenceImages.length) preferReliableImg2ImgModel({ toast: false });
  updateSummary();
  persistDraft();
  if (item.sessionId) {
    state.sessions = store.ensureDemoSessions(buildDemoSessions());
    if (getSession(item.sessionId)) {
      // Keep the case form fields (incl. referenceImages) already applied above.
      const refs = state.form.referenceImages;
      const modelId = state.form.modelId;
      loadSession(item.sessionId, false);
      state.form.referenceImages = refs;
      state.form.modelId = modelId;
      state.selectedCaseId = item.id;
      syncFormToDom();
      renderDefaultCases();
      renderReferences();
      renderModelSelect();
      updateSummary();
    }
  }
  if (toast) showToast(`已载入「${item.label}」案例（含历史结果）。`, "success");
}


function normalizeSlots(slots) {
  return (Array.isArray(slots) ? slots : [])
    .map((slot) => ({
      id: String(slot.id || `custom-${slot.width}x${slot.height}`),
      label: String(slot.label || "自定义"),
      width: Math.round(Number(slot.width) || 0),
      height: Math.round(Number(slot.height) || 0)
    }))
    .filter((slot) => slot.width >= 200 && slot.height >= 200 && slot.width <= 4096 && slot.height <= 4096);
}

function slotKey(slot) {
  return `${slot.id}:${slot.width}x${slot.height}`;
}

function getSelectedSlots() {
  const slots = normalizeSlots(state.form.selectedSlots);
  if (slots.length) return slots;
  return [{ id: "splash", label: "开屏广告", width: 1080, height: 1920 }];
}

function renderResourceSlots() {
  const selected = getSelectedSlots();
  state.form.selectedSlots = selected;
  if (els.slotSummaryCount) {
    els.slotSummaryCount.textContent = `已选 ${selected.length} 个资源位`;
  }
  if (els.slotSummaryList) {
    els.slotSummaryList.textContent = selected.map((slot) => `${slot.label} (${slot.width}×${slot.height})`).join("、");
  }
  if (els.slotTags) {
    els.slotTags.innerHTML = selected
      .map(
        (slot) => `
        <span class="slot-tag">
          ${escapeHtml(slot.label)} ${slot.width}×${slot.height}
          <button type="button" data-remove-slot="${escapeHtml(slotKey(slot))}" aria-label="移除">✕</button>
        </span>`
      )
      .join("");
  }
  if (els.slotOptions) {
    els.slotOptions.innerHTML = RESOURCE_SLOT_OPTIONS.map((item) => {
      const active = selected.some((slot) => slot.id === item.id && slot.width === item.width && slot.height === item.height);
      return `
        <button class="slot-option ${active ? "is-selected" : ""}" type="button" data-toggle-slot="${escapeHtml(item.id)}">
          <span class="slot-option-main">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${item.width}×${item.height}${item.tip ? ` · ${escapeHtml(item.tip)}` : ""}</span>
          </span>
          <span class="slot-option-check">${active ? "✓" : ""}</span>
        </button>`;
    }).join("");
  }
  // Keep legacy size preview in sync with first slot
  const first = selected[0];
  if (first) {
    state.form.ratio = "custom";
    state.form.customWidth = first.width;
    state.form.customHeight = first.height;
    if (els.sizePreview) els.sizePreview.textContent = `${first.width}x${first.height}`;
  }
}

function toggleResourceSlot(slotId) {
  const option = RESOURCE_SLOT_OPTIONS.find((item) => item.id === slotId);
  if (!option) return;
  const selected = getSelectedSlots();
  const exists = selected.findIndex((slot) => slot.id === option.id && slot.width === option.width && slot.height === option.height);
  if (exists >= 0) {
    if (selected.length === 1) {
      showToast("至少保留一个资源位尺寸。", "error");
      return;
    }
    selected.splice(exists, 1);
  } else {
    if (selected.length >= 4) {
      showToast("一次最多选择 4 个资源位。", "error");
      return;
    }
    selected.push({ id: option.id, label: option.label, width: option.width, height: option.height });
  }
  state.form.selectedSlots = selected;
  renderResourceSlots();
  updateSummary();
  persistDraft();
}

function removeResourceSlot(key) {
  const selected = getSelectedSlots().filter((slot) => slotKey(slot) !== key);
  if (!selected.length) {
    showToast("至少保留一个资源位尺寸。", "error");
    return;
  }
  state.form.selectedSlots = selected;
  renderResourceSlots();
  updateSummary();
  persistDraft();
}

function addCustomResourceSlot() {
  const width = Math.round(Number(els.customWidth?.value || state.form.customWidth || 0));
  const height = Math.round(Number(els.customHeight?.value || state.form.customHeight || 0));
  if (width < 200 || height < 200 || width > 4096 || height > 4096) {
    showToast("自定义尺寸需在 200–4096 px 之间。", "error");
    return;
  }
  const selected = getSelectedSlots();
  if (selected.length >= 4) {
    showToast("一次最多选择 4 个资源位。", "error");
    return;
  }
  const id = `custom-${width}x${height}`;
  if (selected.some((slot) => slot.width === width && slot.height === height)) {
    showToast("该尺寸已添加。", "error");
    return;
  }
  selected.push({ id, label: "自定义", width, height });
  state.form.selectedSlots = selected;
  state.form.customWidth = width;
  state.form.customHeight = height;
  renderResourceSlots();
  updateSummary();
  persistDraft();
  showToast(`已添加自定义 ${width}×${height}。`, "success");
}

function renderStaticControls() {
  renderDefaultCases();
  if (els.templateGrid) els.templateGrid.innerHTML = TEMPLATE_OPTIONS.map(
    (item) => `
      <button class="template-card" type="button" data-template-id="${escapeHtml(item.id)}">
        <span class="template-icon">${escapeHtml(item.icon)}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `
  ).join("");

  if (els.brandOptions) {
    els.brandOptions.innerHTML = BRAND_OPTIONS.map(
      (item) => `
        <button class="option-card" type="button" data-brand="${escapeHtml(item.value)}">
          <span class="option-card-symbol">${escapeHtml(item.icon)}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>
      `
    ).join("");
  }

  if (els.generationTypes) {
    els.generationTypes.innerHTML = GENERATION_TYPES.map(
      (item) => `
        <button class="segment-button" type="button" data-generation-type="${escapeHtml(item.value)}">
          ${escapeHtml(item.label)}
        </button>
      `
    ).join("");
  }

  if (els.imageCounts) {
    els.imageCounts.innerHTML = IMAGE_COUNTS.map(
      (count) => `
        <button class="segment-button" type="button" data-image-count="${count}">${count} 张</button>
      `
    ).join("");
  }

  const shapeMap = {
    "1:1": [20, 20],
    "4:3": [24, 18],
    "16:9": [26, 15],
    "3:4": [17, 23],
    "9:16": [14, 25],
    custom: [21, 18]
  };
  renderResourceSlots();

  if (els.styleOptions) {
    els.styleOptions.innerHTML = STYLE_OPTIONS.map(
    (style) => `<button class="style-pill" type="button" data-style="${escapeHtml(style)}">${escapeHtml(style)}</button>`
  ).join("");
  }

  els.adjustmentPills.innerHTML = ADJUSTMENT_OPTIONS.map(
    (item) => `
      <button class="adjustment-pill" type="button" data-adjustment-id="${escapeHtml(item.id)}">
        <span>${escapeHtml(item.icon)}</span>${escapeHtml(item.label)}
      </button>
    `
  ).join("");

  els.adjustmentExamples.innerHTML = MORE_ADJUSTMENT_EXAMPLES.slice(0, 3)
    .map(
      (example) => `<button class="example-chip" type="button" data-adjustment-example="${escapeHtml(example)}">${escapeHtml(example)}</button>`
    )
    .join("");

  els.progressSteps.innerHTML = PROGRESS_STEPS.map(
    (step) => `<li class="progress-step" data-threshold="${step.threshold}">${escapeHtml(step.label)}</li>`
  ).join("");

  renderExampleModal();
}


function channelLabel(channel) {
  return (
    {
      modelscope: "魔搭",
      siliconflow: "硅基流动",
      cloudflare: "Cloudflare",
      pollinations: "Pollinations"
    }[channel] || channel
  );
}

function preferReliableImg2ImgModel({ toast = false } = {}) {
  const hasRefs = state.form.referenceImages.some((item) => item.status === "ready" && item.url);
  if (!hasRefs) return false;
  const models = state.modelCatalog.length ? state.modelCatalog : [];
  const current = models.find((item) => item.id === state.form.modelId);
  if (current?.reliableImg2Img && !current.disabled) return false;
  const next =
    models.find((item) => item.reliableImg2Img && !item.disabled) ||
    models.find((item) => item.id === "modelscope-qwen-edit" && !item.disabled);
  if (!next) return false;
  state.form.modelId = next.id;
  renderModelSelect();
  updateSummary();
  if (toast) {
    showToast(`已切换到更适合图生图的模型：${next.label.split("·")[0].trim()}`, "success");
  }
  return true;
}

function renderModelSelect() {
  if (!els.modelSelect) return;
  const models = state.modelCatalog.length
    ? state.modelCatalog
    : [
        {
          id: state.form.modelId || "modelscope-zimage",
          label: "魔搭 · Z-Image-Turbo（调试快）",
          channel: "modelscope",
          disabled: false,
          exhausted: false
        }
      ];

  let selected = state.form.modelId || models[0]?.id;
  const selectedEntry = models.find((item) => item.id === selected);
  if (!selectedEntry || selectedEntry.disabled) {
    const firstOk = models.find((item) => !item.disabled);
    if (firstOk) selected = firstOk.id;
  }
  state.form.modelId = selected;

  els.modelSelect.innerHTML = models
    .map((item) => {
      const suffix = item.exhausted
        ? "（额度已用尽）"
        : item.available === false
          ? "（未配置）"
          : "";
      return `<option value="${escapeHtml(item.id)}" ${item.disabled ? "disabled" : ""} ${
        item.id === selected ? "selected" : ""
      }>${escapeHtml(item.label)}${suffix}</option>`;
    })
    .join("");

  const exhaustedNames = [
    ...new Set(models.filter((item) => item.exhausted).map((item) => channelLabel(item.channel)))
  ];
  els.modelSelect.classList.toggle("is-has-exhausted", exhaustedNames.length > 0);
  if (els.modelExhaustedNote) {
    if (exhaustedNames.length) {
      els.modelExhaustedNote.hidden = false;
      els.modelExhaustedNote.textContent = `${exhaustedNames.join("、")} 通道额度不足，相关模型已置灰。可换其他通道继续调试。`;
    } else {
      els.modelExhaustedNote.hidden = true;
      els.modelExhaustedNote.textContent = "";
    }
  }
  if (els.modelHint) {
    const current = models.find((item) => item.id === selected);
    els.modelHint.textContent = current?.tier === "debug" ? "调试模型 · 支持图生图" : "支持图生图";
  }
}

async function refreshModels({ silent = false } = {}) {
  try {
    const payload = await api.listModels();
    state.modelCatalog = Array.isArray(payload.models) ? payload.models : [];
    state.exhaustedChannels = payload.exhausted || {};
    if (!state.form.modelId && payload.defaultModelId) {
      state.form.modelId = payload.defaultModelId;
    }
    renderModelSelect();
    persistDraft();
  } catch (error) {
    if (!silent) {
      showToast(`模型列表加载失败：${normalizeErrorMessage(error)}`, "error");
    }
    renderModelSelect();
  }
}

function maybeMarkExhaustedFromError(message = "") {
  const text = String(message || "");
  const map = [
    [/cloudflare|neuron|workers ai/i, "cloudflare"],
    [/modelscope|魔搭|dashscope|qwen-image|z-image/i, "modelscope"],
    [/silicon|kolors|硅基/i, "siliconflow"],
    [/pollinations/i, "pollinations"]
  ];
  let changed = false;
  for (const [re, channel] of map) {
    if (re.test(text)) {
      state.exhaustedChannels[channel] = {
        exhausted: true,
        reason: text.slice(0, 240),
        at: new Date().toISOString()
      };
      changed = true;
    }
  }
  if (changed) {
    state.modelCatalog = state.modelCatalog.map((item) => {
      const exhausted = Boolean(state.exhaustedChannels[item.channel]?.exhausted);
      return {
        ...item,
        exhausted,
        disabled: exhausted || item.available === false
      };
    });
    renderModelSelect();
  }
  refreshModels({ silent: true });
}

function syncFormToDom() {
  els.prompt.value = state.form.prompt || "";
  els.customWidth.value = Number(state.form.customWidth || 1080);
  els.customHeight.value = Number(state.form.customHeight || 1920);
  els.promptCount.textContent = `${els.prompt.value.length} / 3000`;

  $$('[data-brand]').forEach((button) =>
    button.classList.toggle("is-selected", button.dataset.brand === state.form.brandAsset)
  );
  $$('[data-generation-type]').forEach((button) =>
    button.classList.toggle(
      "is-selected",
      button.dataset.generationType === state.form.generationType
    )
  );
  $$('[data-image-count]').forEach((button) =>
    button.classList.toggle(
      "is-selected",
      Number(button.dataset.imageCount) === Number(state.form.imageCount)
    )
  );
  renderResourceSlots();
  $$('[data-style]').forEach((button) =>
    button.classList.toggle("is-selected", state.form.styles.includes(button.dataset.style))
  );
  if (els.customSizeRow) els.customSizeRow.hidden = true;
  renderModelSelect();
  updateSizePreview();
  updateSummary();
  renderReferences();
}

function updateSizePreview() {
  if (!els.sizePreview) return;
  const slots = getSelectedSlots();
  els.sizePreview.textContent = slots.map((slot) => `${slot.width}x${slot.height}`).join(", ");
}

function updateSummary() {
  if (els.styleLimit) {
    els.styleLimit.textContent = `已选 ${state.form.styles.length} / 3`;
  }
  if (els.uploadCount) {
    els.uploadCount.textContent = `${state.form.referenceImages.length} / 4`;
  }
  const modelShort =
    state.modelCatalog.find((item) => item.id === state.form.modelId)?.label?.split("·")[0]?.trim() ||
    "模型";
  const brandPreview = resolveBrandAssetFromPrompt(state.form.prompt, { previousBrandAsset: state.form.brandAsset || "none" });
  const slots = getSelectedSlots();
  const slotText = slots.length === 1 ? `${slots[0].width}×${slots[0].height}` : `${slots.length} 个资源位`;
  els.submitSummary.textContent = `${brandLabel(brandPreview)} · ${modelShort} · ${slotText}`;
}

function setGeneratingUI(isGenerating) {
  els.generateButton.disabled = isGenerating || state.uploadingCount > 0;
  els.generateButton.classList.toggle("is-loading", isGenerating);
  els.generateLabel.textContent = isGenerating ? "生成中…" : state.uploadingCount > 0 ? "参考图上传中…" : "开始生成";
}

function renderReferences() {
  els.referenceList.innerHTML = state.form.referenceImages
    .map((item) => {
      const preview = isSafeImageUrl(item.previewUrl || item.url) ? item.previewUrl || item.url : "";
      return `
        <article class="reference-card ${item.status === "uploading" ? "is-uploading" : ""}">
          ${preview ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(item.fileName || "参考图")}" />` : ""}
          ${item.status === "uploading" ? '<div class="reference-progress">上传中…</div>' : ""}
          ${item.status === "error" ? '<div class="reference-progress">上传失败</div>' : ""}
          <button class="reference-remove" type="button" data-remove-reference="${escapeHtml(item.id)}" aria-label="删除参考图">×</button>
        </article>
      `;
    })
    .join("");
  updateSummary();
}

function showStage(name) {
  const stage = document.getElementById("creation-result");
  // Idle: hide the whole result panel (no empty placeholder).
  if (name === "empty") {
    if (stage) stage.hidden = true;
    if (els.emptyStage) els.emptyStage.hidden = true;
    if (els.progressCard) els.progressCard.hidden = true;
    if (els.errorCard) els.errorCard.hidden = true;
    if (els.resultSection) els.resultSection.hidden = true;
    return;
  }
  if (stage) stage.hidden = false;
  if (els.emptyStage) els.emptyStage.hidden = true;
  if (els.progressCard) els.progressCard.hidden = name !== "progress";
  if (els.errorCard) els.errorCard.hidden = name !== "error";
  if (els.resultSection) els.resultSection.hidden = name !== "result";
}

function renderStageFromState() {
  if (state.activeTask) {
    showStage("progress");
    renderProgress();
    return;
  }
  const session = getSession();
  if (session?.versions?.length) {
    showStage("result");
    renderResult();
    return;
  }
  if (session && ["FAILED", "TIMEOUT", "ABORTED"].includes(session.status)) {
    showErrorState(
      session.status,
      session.lastError ||
        (session.status === "ABORTED"
          ? "已取消本次生成。"
          : "服务暂时不可用，请稍后重试。")
    );
    return;
  }
  showStage("empty");
}

function renderProgress() {
  const task = state.activeTask;
  if (!task) return;
  const progress = Math.max(0, Math.min(99, Number(task.progress || 0)));
  els.progressNumber.textContent = `${Math.round(progress)}%`;
  els.progressMessage.textContent = task.content || "正在提交任务...";
  els.progressBarFill.style.width = `${progress}%`;
  els.progressRing.style.setProperty("--progress", `${progress * 3.6}deg`);
  els.taskStatusBadge.textContent = task.status || "RUNNING";
  $$(".progress-step", els.progressSteps).forEach((step, index, all) => {
    const threshold = Number(step.dataset.threshold);
    const nextThreshold = Number(all[index + 1]?.dataset.threshold || 101);
    step.classList.toggle("is-done", progress >= nextThreshold);
    step.classList.toggle("is-active", progress >= threshold && progress < nextThreshold);
  });
  renderPartialImages();
  setGeneratingUI(true);
}

function renderPartialImages() {
  const images = state.partialImages || [];
  if (!images.length) {
    els.partialResults.hidden = true;
    els.partialResults.innerHTML = "";
    return;
  }
  els.partialResults.hidden = false;
  els.partialResults.innerHTML = images
    .map((image) => {
      if (image.status === "FINISH" && image.url && isSafeImageUrl(image.url)) {
        return `<div class="partial-card"><img src="${escapeHtml(image.url)}" alt="生成中的阶段性结果" /></div>`;
      }
      return '<div class="partial-card skeleton" aria-label="图片生成中"></div>';
    })
    .join("");
}

function showErrorState(kind, message) {
  state.lastErrorKind = kind;
  const titles = {
    FAILED: "生成失败",
    TIMEOUT: "任务等待超时",
    ABORTED: "已取消生成",
    ASK_USER: "需要补充信息"
  };
  els.errorTitle.textContent = titles[kind] || "生成未完成";
  els.errorMessage.textContent = message;
  els.retryTask.textContent = kind === "ABORTED" ? "重新生成" : "重新生成";
  showStage("error");
  setGeneratingUI(false);
}

function aspectForRatio(ratio) {
  const map = {
    "1:1": "1 / 1",
    "4:3": "4 / 3",
    "16:9": "16 / 9",
    "3:4": "3 / 4",
    "9:16": "9 / 16"
  };
  return map[ratio] || "3 / 4";
}

function renderResult() {
  const session = getSession();
  const version = getCurrentVersion(session);
  if (!session || !version) {
    showStage("empty");
    return;
  }
  showStage("result");
  els.resultTime.textContent = `本次生成于 ${formatDate(version.createdAt)}`;
  els.resultMeta.innerHTML = [
    brandLabel(version.brandAsset || session.brandAsset),
    version.ratio || session.ratio,
    ...(version.styles || session.styles || []),
    `版本 V${version.version}`
  ]
    .filter(Boolean)
    .map((item) => `<span class="meta-chip">${escapeHtml(item)}</span>`)
    .join("");

  const images = version.images || [];
  const countClass = images.length >= 4 ? 4 : images.length === 2 ? 2 : 1;
  els.imageGrid.className = `image-grid count-${countClass}`;
  els.imageGrid.style.setProperty("--result-aspect", aspectForRatio(version.ratio));
  els.imageGrid.innerHTML = images
    .map((image, index) => renderImageCard(image, version, index))
    .join("");

  els.sessionIdDisplay.textContent = session.sessionId;
  els.sessionIdDisplay.title = session.sessionId;
  renderVersionStrip(session);
  setGeneratingUI(false);
}

function renderImageCard(image, version, index) {
  const auditFailed = image.status === "AUDIT_FAILED" || image.auditStatus === "FAILED";
  const safe = image.url && isSafeImageUrl(image.url);
  const imageId = image.id || `${version.version}-${index}`;

  if (auditFailed) {
    return `
      <article class="image-result-card">
        <div class="image-audit-failed">
          <div><strong>图片未通过内容安全审核</strong><span>该图片不可预览或下载，其他合格图片仍可正常使用。</span></div>
        </div>
      </article>
    `;
  }

  if (image.status === "RUNNING" || !safe) {
    return `
      <article class="image-result-card">
        <div class="image-frame skeleton" aria-label="图片加载中"></div>
      </article>
    `;
  }

  const favorite = image.favorite ? "is-favorite" : "";
  return `
    <article class="image-result-card">
      <div class="image-frame">
        <img
          src="${escapeHtml(image.url)}"
          alt="生成结果 ${index + 1}"
          data-preview-image="${escapeHtml(imageId)}"
          loading="lazy"
        />
        <div class="image-overlay">
          <span>V${version.version} · ${index + 1}/${version.images.length}</span>
          <span>${escapeHtml(image.model || "品牌视觉模型")}</span>
        </div>
      </div>
      <div class="image-actions">
        <button class="image-action" type="button" data-image-action="regenerate" data-image-id="${escapeHtml(imageId)}">重新生成</button>
        <button class="image-action" type="button" data-image-action="edit" data-image-id="${escapeHtml(imageId)}">继续编辑</button>
        <button class="image-action" type="button" data-image-action="download" data-image-id="${escapeHtml(imageId)}">下载</button>
        <button class="image-action ${favorite}" type="button" data-image-action="favorite" data-image-id="${escapeHtml(imageId)}">${image.favorite ? "已收藏" : "收藏"}</button>
        <button class="image-action" type="button" data-image-action="copy" data-image-id="${escapeHtml(imageId)}">复制链接</button>
        <button class="image-action" type="button" data-image-action="feedback" data-image-id="${escapeHtml(imageId)}">反馈不满意</button>
      </div>
    </article>
  `;
}

function renderVersionStrip(session) {
  const versions = [...(session.versions || [])].sort((a, b) => b.version - a.version);
  els.versionStrip.innerHTML = versions
    .map((version) => {
      const image = getUsableImages(version)[0];
      return `
        <article class="version-card ${version.version === session.currentVersion ? "is-current" : ""}" data-version="${version.version}">
          <div class="version-thumb">
            ${image ? `<img src="${escapeHtml(image.url)}" alt="版本 V${version.version}" />` : '<div class="history-thumb-placeholder">无可展示图片</div>'}
            <span class="version-badge">V${version.version}</span>
          </div>
          <div class="version-info">
            <strong>${version.version === session.currentVersion ? "当前版本" : "历史版本"}</strong>
            <span>${escapeHtml(formatDate(version.createdAt))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function normalizeImages(images = []) {
  return images.map((image, index) => ({
    id: image.id || uid(`image-${index + 1}`),
    url: typeof image.url === "string" ? normalizeAssetUrl(image.url) : "",
    status: image.status || "FINISH",
    prompt: image.prompt || "",
    model: image.model || "",
    auditStatus: image.auditStatus || image.audit_status || "PASSED",
    favorite: Boolean(image.favorite)
  }));
}

function buildRequest({ prompt, sessionId = null, contextImageUrl = null, parentVersion = 0 }) {
  const referenceImages = state.form.referenceImages
    .filter((item) => item.status === "ready" && item.url)
    .map((item) => item.url);
  const isAdjustment = Boolean(sessionId);
  const session = isAdjustment ? state.sessions.find((item) => item.id === sessionId) : null;
  const brandAsset = resolveBrandAssetFromPrompt(prompt, {
    isAdjustment,
    previousBrandAsset: session?.brandAsset || state.form.brandAsset || "none"
  });
  if (referenceImages.length) preferReliableImg2ImgModel({ toast: false });
  return {
    prompt,
    brandAsset,
    generationType: isAdjustment ? "image-edit" : state.form.generationType,
    ratio: state.form.ratio,
    size: (() => {
      const slots = getSelectedSlots();
      return `${slots[0].width}x${slots[0].height}`;
    })(),
    resourceSlots: getSelectedSlots(),
    styles: [],
    imageCount: getSelectedSlots().length,
    modelId: state.form.modelId || "modelscope-zimage",
    referenceImages,
    sessionId,
    ...(isAdjustment
      ? {
          contextImageUrl,
          parentVersion: Number(parentVersion || 0),
          context: {
            currentImageUrl: contextImageUrl,
            version: Number(parentVersion || 0)
          }
        }
      : {})
  };
}

async function startGeneration({
  prompt,
  sessionId = null,
  contextImageUrl = null,
  parentVersion = 0
}) {
  if (state.activeTask) {
    showToast("当前任务正在生成，请等待完成或先取消任务。", "error");
    return;
  }
  if (state.uploadingCount > 0 || state.form.referenceImages.some((item) => item.status === "uploading")) {
    showToast("参考图仍在上传，请等待上传完成。", "error");
    return;
  }

  const validation = validateMarketingPrompt(prompt);
  if (!validation.ok) {
    if (!sessionId) els.promptError.textContent = validation.message;
    showToast(validation.message, "error");
    if (!sessionId) els.prompt.focus();
    return;
  }
  els.promptError.textContent = "";

  const request = buildRequest({ prompt, sessionId, contextImageUrl, parentVersion });
  const isAdjustment = Boolean(sessionId);
  state.partialImages = [];
  state.pollErrors = 0;
  showStage("progress");
  scrollToSection("create", { behavior: "smooth", focusResult: true });
  state.activeTask = {
    sessionId: sessionId || null,
    taskId: null,
    assistantMessageId: null,
    status: "SUBMITTING",
    progress: 3,
    content: "正在提交异步生成任务...",
    request,
    isAdjustment,
    contextImageUrl,
    parentVersion,
    startedAt: new Date().toISOString()
  };
  renderProgress();

  try {
    const response = await api.submitTask(request);
    if (!response?.sessionId || !response?.taskId || !response?.assistantMessageId) {
      throw new Error("submit-task 返回缺少 sessionId、taskId 或 assistantMessageId。请检查 Function 返回结构。");
    }

    const now = new Date().toISOString();
    const effectiveSessionId = response.sessionId;
    state.currentSessionId = effectiveSessionId;
    const existing = getSession(effectiveSessionId) || (sessionId ? getSession(sessionId) : null);
    const userMessage = {
      id: uid("user-message"),
      role: "user",
      content: prompt,
      createdAt: now,
      parentVersion: Number(parentVersion || 0)
    };

    const session = existing
      ? {
          ...existing,
          sessionId: effectiveSessionId,
          messages: [...(existing.messages || []), userMessage],
          status: "RUNNING",
          taskId: response.taskId,
          assistantMessageId: response.assistantMessageId,
          updatedAt: now,
          lastError: "",
          lastRequest: request
        }
      : {
          sessionId: effectiveSessionId,
          title: deriveTitle(prompt),
          theme: TEMPLATE_OPTIONS.find((item) => prompt.includes(item.label.replace("海报", "")))?.label || "营销创作",
          messages: [userMessage],
          currentImageUrl: "",
          currentVersion: 0,
          versions: [],
          createdAt: now,
          updatedAt: now,
          brandAsset: request.brandAsset,
          ratio: request.ratio,
          styles: request.styles,
          status: "RUNNING",
          taskId: response.taskId,
          assistantMessageId: response.assistantMessageId,
          lastError: "",
          lastRequest: request
        };
    upsertSession(session);

    state.activeTask = {
      ...state.activeTask,
      ...response,
      sessionId: effectiveSessionId,
      status: response.status || "SUBMITTED",
      progress: 6,
      content: "任务已提交，等待生成服务处理..."
    };
    store.saveActiveTask(state.activeTask);
    renderProgress();
    schedulePoll(500);
  } catch (error) {
    state.activeTask = null;
    store.saveActiveTask(null);
    const message = normalizeErrorMessage(error);
    showErrorState("FAILED", message);
    showToast(message, "error");
  }
}

function schedulePoll(delay = api.config.pollIntervalMs) {
  window.clearTimeout(state.pollTimer);
  if (!state.activeTask?.taskId) return;
  state.pollTimer = window.setTimeout(pollActiveTask, delay);
}

async function pollActiveTask() {
  const task = state.activeTask;
  if (!task?.taskId) return;
  const taskId = task.taskId;
  try {
    const response = await api.pollTask({
      sessionId: task.sessionId,
      taskId: task.taskId,
      assistantMessageId: task.assistantMessageId
    });
    if (!state.activeTask || state.activeTask.taskId !== taskId) return;
    state.pollErrors = 0;
    await handlePollResponse(response);
  } catch (error) {
    if (!state.activeTask || state.activeTask.taskId !== taskId) return;
    state.pollErrors += 1;
    state.activeTask = {
      ...state.activeTask,
      content: `网络波动，正在重试（${state.pollErrors}/${api.config.maxPollErrors}）...`
    };
    store.saveActiveTask(state.activeTask);
    renderProgress();
    if (state.pollErrors >= api.config.maxPollErrors) {
      failTask("FAILED", "服务暂时不可用，请稍后重试。");
      return;
    }
    schedulePoll(api.config.pollIntervalMs);
  }
}

async function handlePollResponse(response) {
  if (!response || typeof response !== "object") {
    throw new Error("poll-task 返回格式无效。请检查 NoCode Function。 ");
  }
  const action = response._action;
  const status = String(response.status || "").toUpperCase();

  if (action === "display") {
    state.activeTask = {
      ...state.activeTask,
      status: status || "RUNNING",
      progress: Number(response.progress ?? state.activeTask.progress ?? 0),
      content: response.content || response.message || state.activeTask.content
    };
    store.saveActiveTask(state.activeTask);
    renderProgress();
    schedulePoll();
    return;
  }

  if (action === "show_images") {
    state.partialImages = normalizeImages(response.images || []);
    state.activeTask = {
      ...state.activeTask,
      status: status || "RUNNING",
      progress: Number(response.progress ?? 86),
      content: response.content || "图片结果正在更新..."
    };
    store.saveActiveTask(state.activeTask);
    renderProgress();
    if (["DONE", "FINISH"].includes(status) && response.notifyDone === true) {
      completeTask(response);
    } else {
      schedulePoll();
    }
    return;
  }

  if (action === "notify_done" || status === "DONE") {
    completeTask(response);
    return;
  }

  if (action === "notify_failed" || status === "FAILED") {
    const message = normalizeErrorMessage(response.error || response.message || "生成失败");
    failTask("FAILED", message);
    return;
  }

  if (action === "notify_timeout" || status === "TIMEOUT") {
    failTask(
      "TIMEOUT",
      "本次生成等待时间较长，任务可能仍在后台处理。你可以稍后查看历史记录，或重新发起生成。"
    );
    return;
  }

  if (action === "ask_user") {
    failTask("ASK_USER", response.content || response.message || "生成服务需要你补充更多信息。 ");
    return;
  }

  state.activeTask = {
    ...state.activeTask,
    status: status || "RUNNING",
    progress: Number(response.progress ?? state.activeTask.progress ?? 0),
    content: response.content || response.message || "任务仍在处理..."
  };
  store.saveActiveTask(state.activeTask);
  renderProgress();
  schedulePoll();
}

function completeTask(response) {
  const task = state.activeTask;
  if (!task) return;
  window.clearTimeout(state.pollTimer);
  const responseImages = normalizeImages(response.images || []);
  const images = responseImages.length ? responseImages : normalizeImages(state.partialImages || []);
  const now = new Date().toISOString();
  let session = getSession(task.sessionId);
  if (!session) {
    session = {
      sessionId: task.sessionId,
      title: deriveTitle(task.request.prompt),
      theme: "营销创作",
      messages: [],
      currentImageUrl: "",
      currentVersion: 0,
      versions: [],
      createdAt: now,
      updatedAt: now,
      brandAsset: task.request.brandAsset,
      ratio: task.request.ratio,
      styles: task.request.styles,
      status: "RUNNING"
    };
  }
  const maxVersion = Math.max(0, ...(session.versions || []).map((item) => Number(item.version || 0)));
  const nextVersion = maxVersion + 1;
  const version = {
    version: nextVersion,
    prompt: task.request.prompt,
    images,
    createdAt: now,
    brandAsset: task.request.brandAsset,
    generationType: task.request.generationType,
    ratio: task.request.ratio,
    size: task.request.size,
    styles: task.request.styles,
    imageCount: task.request.imageCount,
    referenceImages: task.request.referenceImages,
    contextImageUrl: task.contextImageUrl || "",
    parentVersion: Number(task.parentVersion || 0),
    taskId: task.taskId,
    assistantMessageId: task.assistantMessageId,
    watermark: response.watermark || ""
  };
  const currentImage = getUsableImages(version)[0]?.url || "";
  const assistantMessage = {
    id: task.assistantMessageId || uid("assistant-message"),
    role: "assistant",
    content: images.length ? `已完成第 ${nextVersion} 版，共生成 ${images.length} 张图片。` : "任务已完成，但没有可展示图片。",
    createdAt: now,
    version: nextVersion,
    images
  };
  session = {
    ...session,
    sessionId: task.sessionId,
    messages: [...(session.messages || []), assistantMessage],
    currentImageUrl: currentImage,
    currentVersion: nextVersion,
    versions: [...(session.versions || []), version],
    updatedAt: now,
    brandAsset: task.request.brandAsset,
    ratio: task.request.ratio,
    styles: task.request.styles,
    status: "DONE",
    lastError: "",
    taskId: task.taskId,
    assistantMessageId: task.assistantMessageId,
    lastRequest: task.request
  };
  upsertSession(session);
  state.currentSessionId = session.sessionId;
  state.activeTask = null;
  state.partialImages = [];
  state.editingImageUrl = currentImage;
  store.saveActiveTask(null);
  renderResult();
  renderHistory();
  renderPortfolio();
  showToast("营销图片已生成，可以继续调整。", "success");
}

function failTask(kind, message) {
  const task = state.activeTask;
  window.clearTimeout(state.pollTimer);
  if (task?.sessionId) {
    updateSession(task.sessionId, (session) => ({
      ...session,
      status: kind === "ASK_USER" ? "FAILED" : kind,
      lastError: message,
      updatedAt: new Date().toISOString(),
      lastRequest: task.request
    }));
    state.currentSessionId = task.sessionId;
  }
  state.activeTask = null;
  state.partialImages = [];
  store.saveActiveTask(null);
  showErrorState(kind, message);
  renderHistory();
  showToast(message, "error", 4800);
  if (/neuron|quota|rate.?limit|used up|billing|credit|exhausted|余额不足|额度|402|429/i.test(String(message || ""))) {
    maybeMarkExhaustedFromError(message);
  }
}

async function cancelActiveTask() {
  const task = state.activeTask;
  if (!task?.taskId) return;
  els.cancelTask.disabled = true;
  els.cancelTask.textContent = "取消中…";
  window.clearTimeout(state.pollTimer);
  try {
    await api.abortTask({ sessionId: task.sessionId, taskId: task.taskId });
  } catch (error) {
    showToast(`取消请求未确认：${normalizeErrorMessage(error)}`, "error");
  } finally {
    if (task.sessionId) {
      updateSession(task.sessionId, (session) => ({
        ...session,
        status: "ABORTED",
        lastError: "已取消本次生成。",
        updatedAt: new Date().toISOString(),
        lastRequest: task.request
      }));
      state.currentSessionId = task.sessionId;
    }
    state.activeTask = null;
    state.partialImages = [];
    store.saveActiveTask(null);
    els.cancelTask.disabled = false;
    els.cancelTask.textContent = "取消生成";
    showErrorState("ABORTED", "已取消本次生成。");
    renderHistory();
    showToast("已取消本次生成。", "success");
  }
}

async function startAdjustment(prompt, imageUrl = null, parentVersion = null) {
  const session = getSession();
  const version = getCurrentVersion(session);
  if (!session || !version) {
    showToast("请先完成一轮图片生成。", "error");
    return;
  }
  const contextImageUrl = imageUrl || state.editingImageUrl || session.currentImageUrl || getUsableImages(version)[0]?.url;
  if (!contextImageUrl) {
    showToast("当前版本没有可用于继续编辑的图片。", "error");
    return;
  }
  await startGeneration({
    prompt,
    sessionId: session.sessionId,
    contextImageUrl,
    parentVersion: parentVersion ?? version.version
  });
}

function findImageById(imageId) {
  const session = getSession();
  const version = getCurrentVersion(session);
  if (!session || !version) return { session, version, image: null };
  const image = (version.images || []).find((item, index) => (item.id || `${version.version}-${index}`) === imageId);
  return { session, version, image };
}

async function downloadImage(url, filename = "marketing-poster.png") {
  if (!isSafeImageUrl(url)) {
    showToast("图片链接无效，无法下载。", "error");
    return;
  }
  try {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  } catch {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
}

async function copyText(text, successMessage = "已复制。") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, "success");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    showToast(successMessage, "success");
  }
}

function toggleFavorite(imageId) {
  const session = getSession();
  const version = getCurrentVersion(session);
  if (!session || !version) return;
  let nowFavorite = false;
  const updatedVersions = session.versions.map((item) => {
    if (item.version !== version.version) return item;
    return {
      ...item,
      images: item.images.map((image, index) => {
        const id = image.id || `${item.version}-${index}`;
        if (id !== imageId) return image;
        nowFavorite = !image.favorite;
        return { ...image, favorite: nowFavorite };
      })
    };
  });
  updateSession(session.sessionId, (item) => ({ ...item, versions: updatedVersions, updatedAt: new Date().toISOString() }));
  renderResult();
  renderPortfolio();
  showToast(nowFavorite ? "已加入收藏，可在作品集「已收藏」查看。" : "已取消收藏。", "success");
}

function openLightbox(imageId) {
  const session = getSession();
  const version = getCurrentVersion(session);
  const images = getUsableImages(version);
  if (!images.length) return;
  const index = Math.max(0, images.findIndex((image) => image.id === imageId));
  state.lightboxImages = images;
  state.lightboxIndex = index;
  renderLightbox();
  openModal(els.lightboxModal);
}

function renderLightbox() {
  const image = state.lightboxImages[state.lightboxIndex];
  if (!image) return;
  els.lightboxImage.src = image.url;
  els.lightboxMeta.textContent = `${state.lightboxIndex + 1} / ${state.lightboxImages.length}${image.prompt ? ` · ${truncate(image.prompt, 80)}` : ""}`;
  els.lightboxPrev.disabled = state.lightboxImages.length <= 1;
  els.lightboxNext.disabled = state.lightboxImages.length <= 1;
}

function moveLightbox(direction) {
  const length = state.lightboxImages.length;
  if (length <= 1) return;
  state.lightboxIndex = (state.lightboxIndex + direction + length) % length;
  renderLightbox();
}

function restoreVersion(sessionId, versionNumber, continueEditing = false) {
  const session = getSession(sessionId);
  const version = session?.versions?.find((item) => item.version === Number(versionNumber));
  if (!session || !version) return;
  const image = getUsableImages(version)[0];
  updateSession(sessionId, (item) => ({
    ...item,
    currentVersion: version.version,
    currentImageUrl: image?.url || "",
    updatedAt: new Date().toISOString()
  }));
  state.currentSessionId = sessionId;
  state.editingImageUrl = image?.url || "";
  closeModal(els.detailModal);
  setView("create");
  renderResult();
  if (continueEditing) {
    els.adjustmentInput.focus();
    $("#adjustment-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  showToast(`已切换到版本 V${version.version}。`, "success");
}

function loadSession(sessionId, focusAdjustment = false) {
  const session = getSession(sessionId);
  if (!session) return;
  state.currentSessionId = sessionId;
  const version = getCurrentVersion(session);
  const firstUserPrompt = session.messages?.find((message) => message.role === "user")?.content || "";
  state.form = {
    ...state.form,
    prompt: firstUserPrompt || state.form.prompt,
    brandAsset: version?.brandAsset || session.brandAsset || state.form.brandAsset,
    generationType: "text-to-image",
    ratio: version?.ratio || session.ratio || state.form.ratio,
    imageCount: 1,
    styles: [...(version?.styles || session.styles || state.form.styles)].slice(0, 3)
  };
  state.editingImageUrl = session.currentImageUrl || getUsableImages(version)[0]?.url || "";
  syncFormToDom();
  persistDraft();
  setView("create");
  renderStageFromState();
  if (focusAdjustment && version) {
    setTimeout(() => {
      $("#adjustment-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
      els.adjustmentInput.focus();
    }, 220);
  }
}

function renderHistory() {
  const query = state.historySearch.trim().toLowerCase();
  const sessions = [...state.sessions]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .filter((session) => state.historyStatus === "all" || session.status === state.historyStatus)
    .filter((session) => {
      if (!query) return true;
      const haystack = [
        session.title,
        session.theme,
        brandLabel(session.brandAsset),
        ...(session.messages || []).map((message) => message.content)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

  els.historyGrid.innerHTML = sessions.map(renderHistoryCard).join("");
  els.historyEmpty.hidden = sessions.length > 0;
}

function renderHistoryCard(session) {
  const version = getCurrentVersion(session);
  const image = getUsableImages(version)[0];
  const prompt = session.messages?.find((message) => message.role === "user")?.content || session.lastRequest?.prompt || "";
  return `
    <article class="history-card">
      <div class="history-thumb">
        ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(session.title || "营销创作")}" loading="lazy" />` : `<div class="history-thumb-placeholder">${escapeHtml(session.lastError || "任务尚无可展示图片")}</div>`}
        <span class="status-badge history-status-float ${statusClass(session.status)}">${escapeHtml(STATUS_LABELS[session.status] || session.status || "未知")}</span>
        <span class="history-version-float">V${Number(session.currentVersion || 0)} · ${session.versions?.length || 0} 个版本</span>
      </div>
      <div class="history-body">
        <h3>${escapeHtml(session.title || "未命名营销创作")}</h3>
        <p>${escapeHtml(truncate(prompt, 72))}</p>
        <div class="history-metadata">
          <div><span>创建时间</span><strong>${escapeHtml(formatDate(session.createdAt))}</strong></div>
          <div><span>品牌 IP</span><strong>${escapeHtml(brandLabel(session.brandAsset))}</strong></div>
          <div><span>主题</span><strong>${escapeHtml(session.theme || "营销创作")}</strong></div>
          <div><span>当前版本</span><strong>V${Number(session.currentVersion || 0)}</strong></div>
        </div>
        <div class="history-actions">
          <button class="button button-primary" type="button" data-history-action="continue" data-session-id="${escapeHtml(session.sessionId)}" ${version ? "" : "disabled"}>继续编辑</button>
          <button class="button button-secondary" type="button" data-history-action="detail" data-session-id="${escapeHtml(session.sessionId)}">查看详情</button>
        </div>
      </div>
    </article>
  `;
}

function renderPortfolio() {
  const works = [];
  for (const session of state.sessions) {
    for (const version of session.versions || []) {
      for (const image of getUsableImages(version)) {
        works.push({ session, version, image, category: inferCategory(version.prompt || session.title) });
      }
    }
  }
  works.sort((a, b) => new Date(b.version.createdAt) - new Date(a.version.createdAt));
  const categories = ["全部", "已收藏", "节日大促", "新品上市", "日常运营", "品牌宣传", "其他"];
  const countFor = (category) => {
    if (category === "全部") return works.length;
    if (category === "已收藏") return works.filter((work) => work.image.favorite).length;
    return works.filter((work) => work.category === category).length;
  };
  const folders = categories
    .filter((category) => category !== "其他")
    .map((category) => ({
      category,
      count: countFor(category)
    }));
  els.folderCount.textContent = `${folders.length} 个项目`;
  els.folderGrid.innerHTML = folders
    .map(
      (folder) => `
        <button class="folder-card" type="button" data-portfolio-category="${escapeHtml(folder.category)}">
          <span class="folder-icon">□</span>
          <strong>${escapeHtml(folder.category === "全部" ? "全部作品" : folder.category === "已收藏" ? "已收藏" : folder.category)}</strong>
          <span>${folder.count} 个作品</span>
        </button>
      `
    )
    .join("");

  els.portfolioFilter.innerHTML = categories
    .map(
      (category) => `<button class="portfolio-chip ${state.portfolioCategory === category ? "is-selected" : ""}" type="button" data-portfolio-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
    )
    .join("");

  const filtered =
    state.portfolioCategory === "全部"
      ? works
      : state.portfolioCategory === "已收藏"
        ? works.filter((work) => work.image.favorite)
        : works.filter((work) => work.category === state.portfolioCategory);
  els.workCount.textContent = `${filtered.length} 个作品`;
  els.portfolioUpdated.textContent = `最后更新：${works[0] ? formatDate(works[0].version.createdAt, false) : "—"}`;
  els.portfolioGrid.innerHTML = filtered
    .map(
      ({ session, version, image, category }) => `
        <article class="portfolio-card">
          <div class="portfolio-thumb"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(session.title)}" loading="lazy" /></div>
          <div class="portfolio-body">
            <h3>${escapeHtml(session.title || "营销作品")}</h3>
            <p>${image.favorite ? "已收藏 · " : ""}${escapeHtml(category)} · V${version.version} · ${escapeHtml(formatDate(version.createdAt, false))}</p>
            <div class="portfolio-actions">
              <button class="button button-secondary" type="button" data-portfolio-action="download" data-session-id="${escapeHtml(session.sessionId)}" data-version="${version.version}" data-image-id="${escapeHtml(image.id)}">下载</button>
              <button class="button button-secondary" type="button" data-portfolio-action="share" data-url="${escapeHtml(image.url)}">分享</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function inferCategory(text = "") {
  if (/七夕|节日|大促|国庆|双11|双十二|春节|中秋/i.test(text)) return "节日大促";
  if (/新品|发布|首发|上市/i.test(text)) return "新品上市";
  if (/品牌|IP|吉祥物|招商/i.test(text)) return "品牌宣传";
  if (/日常|社交|门店|banner|运营/i.test(text)) return "日常运营";
  return "其他";
}

function openSessionDetail(sessionId) {
  const session = getSession(sessionId);
  if (!session) return;
  const version = getCurrentVersion(session);
  const cover = getUsableImages(version)[0];
  els.detailContent.innerHTML = `
    <section class="detail-summary">
      <div class="detail-cover">${cover ? `<img src="${escapeHtml(cover.url)}" alt="会话封面" />` : '<div class="history-thumb-placeholder">无可展示图片</div>'}</div>
      <div class="detail-info">
        <h3>${escapeHtml(session.title || "未命名营销创作")}</h3>
        <span class="status-badge ${statusClass(session.status)}">${escapeHtml(STATUS_LABELS[session.status] || session.status)}</span>
        <p>${escapeHtml(session.messages?.find((message) => message.role === "user")?.content || session.lastError || "—")}</p>
        <div class="detail-data-grid">
          <div><span>SESSION ID</span><strong>${escapeHtml(session.sessionId)}</strong></div>
          <div><span>品牌 IP</span><strong>${escapeHtml(brandLabel(session.brandAsset))}</strong></div>
          <div><span>当前版本</span><strong>V${Number(session.currentVersion || 0)}</strong></div>
          <div><span>更新时间</span><strong>${escapeHtml(formatDate(session.updatedAt))}</strong></div>
        </div>
      </div>
    </section>
    <section class="detail-sections">
      <div class="detail-panel">
        <h3>会话消息</h3>
        <div class="message-list">
          ${(session.messages || [])
            .map(
              (message) => `
                <article class="message-item ${message.role === "user" ? "is-user" : "is-assistant"}">
                  <header><strong>${message.role === "user" ? "用户" : "助手"}</strong><span>${escapeHtml(formatDate(message.createdAt))}</span></header>
                  <p>${escapeHtml(message.content || "")}</p>
                </article>
              `
            )
            .join("") || '<div class="empty-list"><p>暂无会话消息</p></div>'}
        </div>
      </div>
      <div class="detail-panel">
        <h3>历史版本</h3>
        <div class="detail-version-list">
          ${[...(session.versions || [])]
            .sort((a, b) => b.version - a.version)
            .map((item) => {
              const image = getUsableImages(item)[0];
              return `
                <article class="detail-version-item">
                  ${image ? `<img src="${escapeHtml(image.url)}" alt="版本 V${item.version}" />` : '<div class="history-thumb-placeholder">无图</div>'}
                  <div class="detail-version-copy">
                    <strong>版本 V${item.version}${item.version === session.currentVersion ? " · 当前" : ""}</strong>
                    <p>${escapeHtml(truncate(item.prompt, 55))}</p>
                    <div class="detail-version-actions">
                      <button class="button button-secondary" type="button" data-detail-action="restore" data-session-id="${escapeHtml(session.sessionId)}" data-version="${item.version}">恢复版本</button>
                      <button class="button button-primary" type="button" data-detail-action="edit" data-session-id="${escapeHtml(session.sessionId)}" data-version="${item.version}" ${image ? "" : "disabled"}>继续编辑</button>
                    </div>
                  </div>
                </article>
              `;
            })
            .join("") || '<div class="empty-list"><p>暂无成功版本</p></div>'}
        </div>
      </div>
    </section>
  `;
  openModal(els.detailModal);
}

function renderExampleModal() {
  const exampleItems = EXAMPLE_CATEGORIES;
  if (!exampleItems.some((item) => item.id === state.selectedExample)) {
    state.selectedExample = exampleItems[0].id;
  }
  els.exampleTabs.innerHTML = exampleItems
    .map(
      (item) => `<button class="example-tab ${item.id === state.selectedExample ? "is-selected" : ""}" type="button" data-example-id="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`
    )
    .join("");
  const selected = exampleItems.find((item) => item.id === state.selectedExample) || exampleItems[0];
  els.exampleContent.innerHTML = `
    <h3>✦ ${escapeHtml(selected.label)}</h3>
    <p>${escapeHtml(selected.description || "")}</p>
    <div class="example-prompt-box"><strong>示例描述：</strong> ${escapeHtml(selected.prompt)}</div>
    <h3>描述技巧</h3>
    <ul class="example-tips">
      ${(selected.tips || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}
    </ul>
    <p class="example-footer-note">如果需要调整主体姿势、背景细节、色彩倾向或构图比例，随时继续描述即可。</p>
    <div class="example-use-row"><button class="button button-primary" type="button" data-use-example="${escapeHtml(selected.id)}">使用该示例</button></div>
  `;
}

function openModal(modal) {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal(modal) {
  modal.hidden = true;
  if ($$(".modal-backdrop:not([hidden])").length === 0) document.body.style.overflow = "";
}

function resetCreation() {
  if (state.activeTask) {
    showToast("当前任务正在生成，请先取消或等待完成。", "error");
    return;
  }
  for (const item of state.form.referenceImages) {
    if (String(item.previewUrl || "").startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
  }
  state.form = structuredClone(DEFAULT_FORM);
  state.currentSessionId = null;
  state.editingImageUrl = null;
  state.partialImages = [];
  els.adjustmentInput.value = "";
  syncFormToDom();
  persistDraft();
  showStage("empty");
  setView("create");
  els.prompt.focus();
  showToast("已新建空白创作。", "success");
}

async function retryLastTask() {
  const session = getSession();
  const request = session?.lastRequest;
  if (session?.versions?.length && request?.prompt) {
    await startGeneration({
      prompt: request.prompt,
      sessionId: session.sessionId,
      contextImageUrl: request.contextImageUrl || request.context?.currentImageUrl || session.currentImageUrl,
      parentVersion: request.parentVersion || session.currentVersion
    });
    return;
  }
  const prompt = state.form.prompt || request?.prompt || "";
  await startGeneration({ prompt });
}

async function prepareReferenceUpload(file, maxDimension = 496) {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const largest = Math.max(bitmap.width, bitmap.height);
    if (largest <= maxDimension) return file;
    const scale = maxDimension / largest;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const outputType = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, 0.9));
    if (!blob) return file;
    const extension = outputType === "image/png" ? "png" : outputType === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "reference";
    return new File([blob], `${baseName}-ai-reference.${extension}`, {
      type: outputType,
      lastModified: file.lastModified
    });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

async function handleFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;
  const remaining = 4 - state.form.referenceImages.length;
  if (remaining <= 0) {
    showToast("最多只能上传 4 张参考图。", "error");
    return;
  }
  if (incoming.length > remaining) {
    showToast(`当前还可上传 ${remaining} 张，已忽略多余文件。`, "error");
  }
  const files = incoming.slice(0, remaining);
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showToast(`${file.name} 格式不支持。`, "error");
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name} 超过 10MB。`, "error");
      continue;
    }
    const id = uid("reference");
    const previewUrl = URL.createObjectURL(file);
    const record = {
      id,
      fileName: file.name,
      size: file.size,
      previewUrl,
      url: "",
      status: "uploading"
    };
    state.form.referenceImages.push(record);
    state.uploadingCount += 1;
    renderReferences();
    setGeneratingUI(Boolean(state.activeTask));
    try {
      const uploadFile = await prepareReferenceUpload(file);
      const response = await api.uploadReference(uploadFile);
      const index = state.form.referenceImages.findIndex((item) => item.id === id);
      if (index >= 0) {
        state.form.referenceImages[index] = {
          ...state.form.referenceImages[index],
          url: response.url,
          fileName: file.name,
          size: response.size ?? file.size,
          status: "ready"
        };
      }
      showToast(`${file.name} 上传完成。`, "success");
      preferReliableImg2ImgModel({ toast: true });
    } catch (error) {
      const index = state.form.referenceImages.findIndex((item) => item.id === id);
      if (index >= 0) state.form.referenceImages[index].status = "error";
      showToast(`${file.name} 上传失败：${normalizeErrorMessage(error)}`, "error");
    } finally {
      state.uploadingCount = Math.max(0, state.uploadingCount - 1);
      renderReferences();
      setGeneratingUI(Boolean(state.activeTask));
      persistDraft();
    }
  }
  els.referenceInput.value = "";
}

function removeReference(id) {
  const item = state.form.referenceImages.find((entry) => entry.id === id);
  if (item && String(item.previewUrl || "").startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
  state.form.referenceImages = state.form.referenceImages.filter((entry) => entry.id !== id);
  renderReferences();
  persistDraft();
}

function bindEvents() {
  if (els.modelSelect) {
    els.modelSelect.addEventListener("change", () => {
      const option = els.modelSelect.selectedOptions[0];
      if (option?.disabled) {
        renderModelSelect();
        showToast("该模型所属通道额度已用尽，请换其他模型。", "error");
        return;
      }
      state.form.modelId = els.modelSelect.value;
      updateSummary();
      persistDraft();
    });
  }

  document.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      setView(nav.dataset.nav);
      return;
    }

    const defaultCaseBtn = event.target.closest("[data-default-case]");
    if (defaultCaseBtn) {
      const item = DEFAULT_CASES.find((entry) => entry.id === defaultCaseBtn.dataset.defaultCase);
      applyDefaultCase(item);
      return;
    }

    const template = event.target.closest("[data-template-id]");
    if (template) {
      const item = TEMPLATE_OPTIONS.find((entry) => entry.id === template.dataset.templateId);
      if (item) {
        state.form.prompt = item.prompt;
        els.prompt.value = item.prompt;
        els.promptCount.textContent = `${item.prompt.length} / 3000`;
        els.promptError.textContent = "";
        persistDraft();
        els.prompt.focus();
        showToast(`已填入“${item.label}”示例需求。`, "success");
      }
      return;
    }

    const brand = event.target.closest("[data-brand]");
    if (brand) {
      state.form.brandAsset = brand.dataset.brand;
      syncFormToDom();
      persistDraft();
      return;
    }

    const generationType = event.target.closest("[data-generation-type]");
    if (generationType) {
      state.form.generationType = generationType.dataset.generationType;
      syncFormToDom();
      persistDraft();
      return;
    }

    const count = event.target.closest("[data-image-count]");
    if (count) {
      state.form.imageCount = Number(count.dataset.imageCount);
      syncFormToDom();
      persistDraft();
      return;
    }

    const toggleSlot = event.target.closest("[data-toggle-slot]");
    if (toggleSlot) {
      toggleResourceSlot(toggleSlot.dataset.toggleSlot);
      return;
    }

    const removeSlot = event.target.closest("[data-remove-slot]");
    if (removeSlot) {
      removeResourceSlot(removeSlot.dataset.removeSlot);
      return;
    }

    const ratio = event.target.closest("[data-ratio]");
    if (ratio) {
      state.form.ratio = ratio.dataset.ratio;
      syncFormToDom();
      persistDraft();
      return;
    }

    const style = event.target.closest("[data-style]");
    if (style) {
      const value = style.dataset.style;
      if (state.form.styles.includes(value)) {
        state.form.styles = state.form.styles.filter((item) => item !== value);
      } else if (state.form.styles.length >= 3) {
        showToast("风格偏好最多选择 3 个。", "error");
        return;
      } else {
        state.form.styles.push(value);
      }
      syncFormToDom();
      persistDraft();
      return;
    }

    const removeReferenceButton = event.target.closest("[data-remove-reference]");
    if (removeReferenceButton) {
      removeReference(removeReferenceButton.dataset.removeReference);
      return;
    }

    const adjustment = event.target.closest("[data-adjustment-id]");
    if (adjustment) {
      const item = ADJUSTMENT_OPTIONS.find((entry) => entry.id === adjustment.dataset.adjustmentId);
      if (!item) return;
      if (item.id === "custom") {
        els.adjustmentInput.focus();
        els.adjustmentInput.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        await startAdjustment(item.prompt);
      }
      return;
    }

    const exampleAdjustment = event.target.closest("[data-adjustment-example]");
    if (exampleAdjustment) {
      els.adjustmentInput.value = exampleAdjustment.dataset.adjustmentExample;
      els.adjustmentInput.focus();
      return;
    }

    const imageAction = event.target.closest("[data-image-action]");
    if (imageAction) {
      const action = imageAction.dataset.imageAction;
      const { session, version, image } = findImageById(imageAction.dataset.imageId);
      if (!session || !version || !image) return;
      if (action === "regenerate") {
        await startAdjustment(
          "请保持当前海报的营销主题、品牌 IP、文案留白和整体风格不变，重新生成一个构图更完整、视觉表现更精致的版本。",
          image.url,
          version.version
        );
      } else if (action === "edit") {
        state.editingImageUrl = image.url;
        els.adjustmentInput.focus();
        $("#adjustment-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
        showToast("已选择该图片作为下一轮调整上下文。", "success");
      } else if (action === "download") {
        await downloadImage(image.url, `marketing-poster-v${version.version}-${imageAction.dataset.imageId}.png`);
      } else if (action === "favorite") {
        toggleFavorite(imageAction.dataset.imageId);
      } else if (action === "copy") {
        await copyText(image.url, "图片链接已复制。 ");
      } else if (action === "feedback") {
        state.editingImageUrl = image.url;
        els.adjustmentInput.value = "当前结果不符合预期，请保留主题和品牌 IP，重新优化主体姿势、背景层次和营销信息留白。";
        els.adjustmentInput.focus();
        $("#adjustment-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const preview = event.target.closest("[data-preview-image]");
    if (preview) {
      openLightbox(preview.dataset.previewImage);
      return;
    }

    const versionCard = event.target.closest("[data-version]");
    if (versionCard && versionCard.closest("#version-strip")) {
      restoreVersion(state.currentSessionId, Number(versionCard.dataset.version), false);
      return;
    }

    const historyAction = event.target.closest("[data-history-action]");
    if (historyAction) {
      const sessionId = historyAction.dataset.sessionId;
      if (historyAction.dataset.historyAction === "continue") loadSession(sessionId, true);
      else openSessionDetail(sessionId);
      return;
    }

    const portfolioCategory = event.target.closest("[data-portfolio-category]");
    if (portfolioCategory) {
      state.portfolioCategory = portfolioCategory.dataset.portfolioCategory;
      renderPortfolio();
      return;
    }

    const portfolioAction = event.target.closest("[data-portfolio-action]");
    if (portfolioAction) {
      if (portfolioAction.dataset.portfolioAction === "share") {
        await copyText(portfolioAction.dataset.url, "作品链接已复制。 ");
      } else {
        const session = getSession(portfolioAction.dataset.sessionId);
        const version = session?.versions?.find((item) => item.version === Number(portfolioAction.dataset.version));
        const image = version?.images?.find((item) => item.id === portfolioAction.dataset.imageId);
        if (image) await downloadImage(image.url, `marketing-work-v${version.version}.png`);
      }
      return;
    }

    const exampleTab = event.target.closest("[data-example-id]");
    if (exampleTab) {
      state.selectedExample = exampleTab.dataset.exampleId;
      renderExampleModal();
      return;
    }

    const useExample = event.target.closest("[data-use-example]");
    if (useExample) {
      const item =
        EXAMPLE_CATEGORIES.find((entry) => entry.id === useExample.dataset.useExample) ||
        TEMPLATE_OPTIONS.find((entry) => entry.id === useExample.dataset.useExample);
      if (item) {
        state.form.prompt = item.prompt;
        if (els.prompt) {
          els.prompt.value = item.prompt;
          els.promptCount.textContent = `${item.prompt.length} / 3000`;
          els.promptError.textContent = "";
        }
        syncFormToDom();
        updateSummary();
        persistDraft();
        closeModal(els.exampleModal);
        setView("create");
        els.prompt?.focus();
        showToast(`已填入「${item.label}」示例描述。`, "success");
      }
      return;
    }

    const detailAction = event.target.closest("[data-detail-action]");
    if (detailAction) {
      restoreVersion(
        detailAction.dataset.sessionId,
        Number(detailAction.dataset.version),
        detailAction.dataset.detailAction === "edit"
      );
      return;
    }

    const close = event.target.closest("[data-close-modal]");
    if (close) {
      closeModal($(`#${close.dataset.closeModal}`));
      return;
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.form.prompt = els.prompt.value;
    persistDraft();
    startGeneration({ prompt: state.form.prompt });
  });

  els.prompt.addEventListener("input", () => {
    state.form.prompt = els.prompt.value;
    els.promptCount.textContent = `${els.prompt.value.length} / 3000`;
    els.promptError.textContent = "";
    persistDraft();
  });

  els.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.customWidth.addEventListener("input", () => {
    state.form.customWidth = Number(els.customWidth.value);
    updateSizePreview();
    persistDraft();
  });
  els.customHeight.addEventListener("input", () => {
    state.form.customHeight = Number(els.customHeight.value);
    updateSizePreview();
    persistDraft();
  });

  els.uploadZone.addEventListener("click", () => els.referenceInput.click());
  els.uploadZone.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      els.referenceInput.click();
    }
  });
  els.referenceInput.addEventListener("change", () => handleFiles(els.referenceInput.files));
  ["dragenter", "dragover"].forEach((name) =>
    els.uploadZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.uploadZone.classList.add("is-dragging");
    })
  );
  ["dragleave", "drop"].forEach((name) =>
    els.uploadZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.uploadZone.classList.remove("is-dragging");
    })
  );
  els.uploadZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));

  els.submitAdjustment.addEventListener("click", () => {
    const prompt = els.adjustmentInput.value.trim();
    if (!prompt) {
      showToast("请先描述需要调整的内容。", "error");
      els.adjustmentInput.focus();
      return;
    }
    startAdjustment(prompt);
  });
  els.adjustmentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.submitAdjustment.click();
    }
  });

  els.cancelTask.addEventListener("click", cancelActiveTask);
  els.retryTask.addEventListener("click", retryLastTask);
  els.errorHistory.addEventListener("click", () => setView("history"));
  els.newCreation?.addEventListener("click", resetCreation);
  els.historyEntry?.addEventListener("click", () => setView("history"));
  els.openExamples.addEventListener("click", () => openModal(els.exampleModal));
  els.addCustomSlot?.addEventListener("click", () => addCustomResourceSlot());

  els.historySearch.addEventListener("input", () => {
    state.historySearch = els.historySearch.value;
    renderHistory();
  });
  els.historyStatusFilter.addEventListener("change", () => {
    state.historyStatus = els.historyStatusFilter.value;
    renderHistory();
  });

  els.lightboxPrev.addEventListener("click", () => moveLightbox(-1));
  els.lightboxNext.addEventListener("click", () => moveLightbox(1));

  $$(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = $$(".modal-backdrop:not([hidden])").at(-1);
      if (open) closeModal(open);
    }
    if (!els.lightboxModal.hidden && event.key === "ArrowLeft") moveLightbox(-1);
    if (!els.lightboxModal.hidden && event.key === "ArrowRight") moveLightbox(1);
  });

  window.addEventListener("beforeunload", () => {
    persistDraft();
    if (state.activeTask) store.saveActiveTask(state.activeTask);
  });
}

function restoreActiveTask() {
  if (!state.activeTask?.taskId) {
    state.activeTask = null;
    store.saveActiveTask(null);
    return;
  }
  state.currentSessionId = state.activeTask.sessionId;
  state.activeTask = {
    ...state.activeTask,
    status: state.activeTask.status || "RUNNING",
    progress: Number(state.activeTask.progress || 8),
    content: state.activeTask.content || "正在恢复任务状态..."
  };
  showStage("progress");
  renderProgress();
  schedulePoll(250);
}

function init() {
  state.sessions = store.ensureDemoSessions(buildDemoSessions());
  setApiBadge();
  renderStaticControls();
  syncFormToDom();
  bindEvents();
  renderHistory();
  renderPortfolio();
  refreshModels({ silent: true });
  setupSectionSpy();
  // Long-page mode: all sections stay mounted
  els.views.forEach((section) => {
    section.hidden = false;
  });
  setNavActive("create");
  if (state.activeTask) restoreActiveTask();
  else showStage("empty");
}

init();
