import { store } from "../store.js";
import { uid } from "../utils.js";

const DEFAULT_DURATION_MS = 10500;

function sleep(ms = 180) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveTask(task) {
  const tasks = store.getMockTasks();
  tasks[task.taskId] = task;
  store.saveMockTasks(tasks);
}

function loadTask(taskId) {
  return store.getMockTasks()[taskId] || null;
}

function buildMockImage(task, index, status = "FINISH") {
  const variant = ((task.version || 1) * 2 + index + (task.isAdjustment ? 1 : 0)) % 6 || 6;
  const url = new URL(`../../mock/poster-${variant}.svg`, import.meta.url).href;
  return {
    id: `${task.taskId}-image-${index + 1}`,
    url,
    status,
    prompt: task.request.prompt,
    model: "mock-brand-studio-v1",
    auditStatus: "PASSED"
  };
}

function stageForElapsed(elapsed, duration) {
  const progress = Math.min(99, Math.round((elapsed / duration) * 100));
  if (progress < 18) return { progress: Math.max(8, progress), content: "正在理解营销需求..." };
  if (progress < 34) return { progress, content: "正在生成创作方案..." };
  if (progress < 50) return { progress, content: "正在调用品牌 IP 模型..." };
  if (progress < 72) return { progress, content: "正在生成图片..." };
  if (progress < 90) return { progress, content: "正在进行内容安全审核..." };
  return { progress, content: "即将展示生成结果..." };
}

export async function submitMockTask(request) {
  await sleep(220);
  const sessionId = request.sessionId || uid("session");
  const taskId = uid("task");
  const assistantMessageId = uid("message");
  const version = Number(request.parentVersion || 0) + 1;
  const task = {
    sessionId,
    taskId,
    assistantMessageId,
    request,
    version,
    isAdjustment: Boolean(request.sessionId),
    createdAt: Date.now(),
    durationMs: DEFAULT_DURATION_MS + ((version % 3) - 1) * 900,
    aborted: false
  };
  saveTask(task);
  return {
    _action: "submitted",
    sessionId,
    taskId,
    assistantMessageId,
    status: "SUBMITTED"
  };
}

export async function pollMockTask({ taskId }) {
  await sleep(120);
  const task = loadTask(taskId);
  if (!task) {
    return {
      _action: "notify_failed",
      status: "FAILED",
      error: "Mock 任务不存在或已被清理。"
    };
  }
  if (task.aborted) {
    return {
      _action: "notify_failed",
      status: "FAILED",
      error: "任务已取消"
    };
  }

  const prompt = String(task.request.prompt || "");
  const elapsed = Date.now() - task.createdAt;

  if (/\[mock:audit\]/i.test(prompt) && elapsed > 4500) {
    return {
      _action: "notify_failed",
      status: "FAILED",
      error: "当前需求或生成结果未通过内容安全审核"
    };
  }
  if (/\[mock:failed\]/i.test(prompt) && elapsed > 4500) {
    return {
      _action: "notify_failed",
      status: "FAILED",
      error: "Mock 生图服务返回失败"
    };
  }
  if (/\[mock:timeout\]/i.test(prompt) && elapsed > 9000) {
    return { _action: "notify_timeout", status: "TIMEOUT" };
  }

  if (elapsed >= task.durationMs) {
    const images = Array.from({ length: Number(task.request.imageCount || 1) }, (_, index) =>
      buildMockImage(task, index, "FINISH")
    );
    return {
      _action: "notify_done",
      status: "DONE",
      sessionId: task.sessionId,
      taskId: task.taskId,
      images,
      watermark: "图片由智能营销生图助手生成"
    };
  }

  if (elapsed >= task.durationMs * 0.72) {
    const imageCount = Number(task.request.imageCount || 1);
    const readyCount = Math.max(1, Math.floor(imageCount / 2));
    const images = Array.from({ length: imageCount }, (_, index) =>
      index < readyCount
        ? buildMockImage(task, index, "FINISH")
        : {
            id: `${task.taskId}-image-${index + 1}`,
            url: "",
            status: "RUNNING",
            prompt: task.request.prompt,
            model: "mock-brand-studio-v1"
          }
    );
    const stage = stageForElapsed(elapsed, task.durationMs);
    return {
      _action: "show_images",
      status: "RUNNING",
      progress: Math.max(76, stage.progress),
      content: stage.content,
      images
    };
  }

  const stage = stageForElapsed(elapsed, task.durationMs);
  return {
    _action: "display",
    status: "RUNNING",
    progress: stage.progress,
    content: stage.content
  };
}

export async function abortMockTask({ taskId }) {
  await sleep(150);
  const task = loadTask(taskId);
  if (task) saveTask({ ...task, aborted: true, abortedAt: Date.now() });
  return { status: "ABORTED" };
}

export async function uploadMockReference(file) {
  await sleep(250);
  return {
    url: URL.createObjectURL(file),
    fileName: file.name,
    size: file.size,
    mock: true
  };
}
