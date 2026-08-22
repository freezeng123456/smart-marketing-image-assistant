import {
  TEMPLATE_OPTIONS,
  BRAND_OPTIONS,
  GENERATION_TYPES,
  RATIO_OPTIONS,
  IMAGE_COUNTS,
  STYLE_OPTIONS,
  ADJUSTMENT_OPTIONS,
  MORE_ADJUSTMENT_EXAMPLES,
  PROGRESS_STEPS,
  DEFAULT_FORM,
  STATUS_LABELS
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
  views: $$(".page-view"),
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
  ratioOptions: $("#ratio-options"),
  sizePreview: $("#size-preview"),
  customSizeRow: $("#custom-size-row"),
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
    styles: Array.isArray(persistedDraft?.styles)
      ? persistedDraft.styles.slice(0, 3)
      : [...DEFAULT_FORM.styles],
    referenceImages: restoredReferences.map((item) => ({
      ...item,
      id: item.id || uid("reference"),
      previewUrl: item.previewUrl || item.url,
      status: "ready"
    }))
  },
  sessions: store.getSessions(),
  currentSessionId: null,
  activeTask: store.getActiveTask(),
  partialImages: [],
  pollTimer: null,
  pollErrors: 0,
  uploadingCount: 0,
  selectedExample: TEMPLATE_OPTIONS[0].id,
  historySearch: "",
  historyStatus: "all",
  portfolioCategory: "全部",
  editingImageUrl: null,
  lightboxImages: [],
  lightboxIndex: 0,
  lastErrorKind: "FAILED"
};

function persistSessions() {
  store.saveSessions(state.sessions);
}

function persistDraft() {
  store.saveDraft({
    prompt: state.form.prompt,
    brandAsset: state.form.brandAsset,
    generationType: state.form.generationType,
    ratio: state.form.ratio,
    customWidth: state.form.customWidth,
    customHeight: state.form.customHeight,
    imageCount: state.form.imageCount,
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
  return BRAND_OPTIONS.find((item) => item.value === value)?.label || value || "—";
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

function setView(view) {
  state.currentView = view;
  els.views.forEach((section) => {
    const active = section.dataset.view === view;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  });
  $$(".nav-item").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.nav === view)
  );
  if (view === "history") renderHistory();
  if (view === "portfolio") renderPortfolio();
  if (view === "create") renderStageFromState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setApiBadge() {
  const isMock = api.mode === "mock";
  els.apiBadge.innerHTML = `
    <span class="status-dot" style="background:${isMock ? "var(--warning)" : "var(--success)"}"></span>
    <span>${isMock ? "Mock 预览模式" : "NoCode Function"}</span>
  `;
  els.apiBadge.title = isMock
    ? "本地预览使用浏览器内 mock；生产环境默认调用真实 NoCode Function"
    : "正在调用真实 NoCode Function：/functions/*";
}

function renderStaticControls() {
  els.templateGrid.innerHTML = TEMPLATE_OPTIONS.map(
    (item) => `
      <button class="template-card" type="button" data-template-id="${escapeHtml(item.id)}">
        <span class="template-icon">${escapeHtml(item.icon)}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `
  ).join("");

  els.brandOptions.innerHTML = BRAND_OPTIONS.map(
    (item) => `
      <button class="option-card" type="button" data-brand="${escapeHtml(item.value)}">
        <span class="option-card-symbol">${escapeHtml(item.icon)}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `
  ).join("");

  els.generationTypes.innerHTML = GENERATION_TYPES.map(
    (item) => `
      <button class="segment-button" type="button" data-generation-type="${escapeHtml(item.value)}">
        ${escapeHtml(item.label)}
      </button>
    `
  ).join("");

  els.imageCounts.innerHTML = IMAGE_COUNTS.map(
    (count) => `
      <button class="segment-button" type="button" data-image-count="${count}">${count} 张</button>
    `
  ).join("");

  const shapeMap = {
    "1:1": [20, 20],
    "4:3": [24, 18],
    "16:9": [26, 15],
    "3:4": [17, 23],
    "9:16": [14, 25],
    custom: [21, 18]
  };
  els.ratioOptions.innerHTML = RATIO_OPTIONS.map((item) => {
    const [width, height] = shapeMap[item.value] || [18, 22];
    return `
      <button class="ratio-button" type="button" data-ratio="${escapeHtml(item.value)}">
        <span class="ratio-shape" style="--shape-w:${width}px;--shape-h:${height}px"></span>
        ${escapeHtml(item.label)}
      </button>
    `;
  }).join("");

  els.styleOptions.innerHTML = STYLE_OPTIONS.map(
    (style) => `<button class="style-pill" type="button" data-style="${escapeHtml(style)}">${escapeHtml(style)}</button>`
  ).join("");

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
  $$('[data-ratio]').forEach((button) =>
    button.classList.toggle("is-selected", button.dataset.ratio === state.form.ratio)
  );
  $$('[data-style]').forEach((button) =>
    button.classList.toggle("is-selected", state.form.styles.includes(button.dataset.style))
  );
  els.customSizeRow.hidden = state.form.ratio !== "custom";
  updateSizePreview();
  updateSummary();
  renderReferences();
}

function updateSizePreview() {
  const size = buildSize(state.form.ratio, state.form.customWidth, state.form.customHeight);
  els.sizePreview.textContent = size;
}

function updateSummary() {
  const styleCount = state.form.styles.length;
  els.styleLimit.textContent = `已选 ${styleCount} / 3`;
  els.uploadCount.textContent = `${state.form.referenceImages.length} / 4`;
  els.submitSummary.textContent = `${brandLabel(state.form.brandAsset)} · ${state.form.ratio === "custom" ? "自定义" : state.form.ratio} · ${state.form.imageCount} 张`;
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
  els.emptyStage.hidden = name !== "empty";
  els.progressCard.hidden = name !== "progress";
  els.errorCard.hidden = name !== "error";
  els.resultSection.hidden = name !== "result";
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
    url: typeof image.url === "string" ? image.url : "",
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
  return {
    prompt,
    brandAsset: state.form.brandAsset,
    generationType: isAdjustment ? "image-edit" : state.form.generationType,
    ratio: state.form.ratio,
    size: buildSize(state.form.ratio, state.form.customWidth, state.form.customHeight),
    styles: [...state.form.styles],
    imageCount: Number(state.form.imageCount),
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
  const updatedVersions = session.versions.map((item) => {
    if (item.version !== version.version) return item;
    return {
      ...item,
      images: item.images.map((image, index) => {
        const id = image.id || `${item.version}-${index}`;
        return id === imageId ? { ...image, favorite: !image.favorite } : image;
      })
    };
  });
  updateSession(session.sessionId, (item) => ({ ...item, versions: updatedVersions, updatedAt: new Date().toISOString() }));
  renderResult();
  renderPortfolio();
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
    imageCount: version?.imageCount || state.form.imageCount,
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
  const categories = ["全部", "节日大促", "新品上市", "日常运营", "品牌宣传", "其他"];
  const folders = categories.slice(0, -1).map((category) => ({
    category,
    count: category === "全部" ? works.length : works.filter((work) => work.category === category).length
  }));
  els.folderCount.textContent = `${folders.length} 个项目`;
  els.folderGrid.innerHTML = folders
    .map(
      (folder) => `
        <button class="folder-card" type="button" data-portfolio-category="${escapeHtml(folder.category)}">
          <span class="folder-icon">□</span>
          <strong>${escapeHtml(folder.category === "全部" ? "全部作品" : folder.category)}</strong>
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

  const filtered = state.portfolioCategory === "全部"
    ? works
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
            <p>${escapeHtml(category)} · V${version.version} · ${escapeHtml(formatDate(version.createdAt, false))}</p>
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
  const exampleItems = [
    TEMPLATE_OPTIONS[0],
    TEMPLATE_OPTIONS[3],
    TEMPLATE_OPTIONS[6],
    TEMPLATE_OPTIONS[4]
  ];
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
    <p>结构化描述会帮助系统准确理解营销场景，并由后端统一注入品牌 IP。</p>
    <div class="example-prompt-box"><strong>示例描述：</strong> ${escapeHtml(selected.prompt)}</div>
    <h3>描述技巧</h3>
    <ul class="example-tips">
      <li>说明活动主题、营销场景和品牌 IP 的主要动作</li>
      <li>指定背景元素、装饰风格和希望保留的文字区域</li>
      <li>明确色彩倾向、构图比例、尺寸与投放渠道</li>
      <li>写清活动名称、商品名称、优惠信息等不可遗漏内容</li>
    </ul>
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
  document.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      setView(nav.dataset.nav);
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
      const item = TEMPLATE_OPTIONS.find((entry) => entry.id === useExample.dataset.useExample);
      if (item) {
        state.form.prompt = item.prompt;
        syncFormToDom();
        persistDraft();
        closeModal(els.exampleModal);
        setView("create");
        els.prompt.focus();
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
  els.newCreation.addEventListener("click", resetCreation);
  els.historyEntry.addEventListener("click", () => setView("history"));
  els.openExamples.addEventListener("click", () => openModal(els.exampleModal));

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
  setApiBadge();
  renderStaticControls();
  syncFormToDom();
  bindEvents();
  renderHistory();
  renderPortfolio();
  if (state.activeTask) restoreActiveTask();
  else showStage("empty");
}

init();
