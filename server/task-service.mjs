import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageFileName } from "./image-utils.mjs";

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function stageContent(progress) {
  if (progress < 18) return "正在理解营销需求...";
  if (progress < 34) return "正在生成创作方案...";
  if (progress < 50) return "正在调用品牌 IP 模型...";
  if (progress < 82) return "正在生成图片...";
  if (progress < 95) return "正在进行内容安全审核...";
  return "即将展示生成结果...";
}

function publicTask(task) {
  const { controller, completion, origin, ...serializable } = task;
  return serializable;
}

export function createTaskService({ provider, runtimeDir, logger = console, taskTimeoutMs = 180_000 }) {
  if (!provider?.generate) throw new Error("A real image provider is required.");
  const tasks = new Map();
  const taskFile = join(runtimeDir, "tasks.json");
  const generatedDir = join(runtimeDir, "generated");
  let persistQueue = Promise.resolve();

  async function persist() {
    const payload = Object.fromEntries([...tasks.entries()].map(([id, task]) => [id, publicTask(task)]));
    persistQueue = persistQueue
      .catch(() => undefined)
      .then(() => writeFile(taskFile, JSON.stringify(payload, null, 2), "utf8"));
    return persistQueue;
  }

  async function init() {
    await mkdir(generatedDir, { recursive: true });
    try {
      const stored = JSON.parse(await readFile(taskFile, "utf8"));
      for (const [id, task] of Object.entries(stored || {})) {
        if (task.status === "RUNNING" || task.status === "SUBMITTED") {
          task.status = "FAILED";
          task.error = "服务重启后，未完成任务无法继续执行，请重新生成。";
        }
        tasks.set(id, { ...task, controller: null, origin: task.origin || "" });
      }
    } catch {
      // Fresh runtime.
    }
  }

  function updateTask(task, patch) {
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    void persist();
  }

  async function runTask(task) {
    const timeout = setTimeout(() => {
      task.timeoutTriggered = true;
      task.controller?.abort(new Error("task-timeout"));
    }, taskTimeoutMs);

    try {
      updateTask(task, {
        status: "RUNNING",
        progress: 12,
        content: stageContent(12)
      });
      const slots = Array.isArray(task.request.resourceSlots) && task.request.resourceSlots.length
        ? task.request.resourceSlots.slice(0, 4)
        : null;
      const count = slots ? slots.length : 1;
      const images = [];

      for (let index = 0; index < count; index += 1) {
        if (task.aborted) throw new DOMException("Aborted", "AbortError");
        const slot = slots?.[index] || null;
        const slotSize = slot ? `${slot.width}x${slot.height}` : task.request.size;
        const slotLabel = slot ? `${slot.label || "资源位"} ${slotSize}` : "";
        const baseProgress = 30 + Math.round((index / count) * 52);
        updateTask(task, {
          progress: baseProgress,
          content: index === 0
            ? (slotLabel ? `正在生成 ${slotLabel}...` : "正在调用生图模型...")
            : `正在生成第 ${index + 1}/${count} 张（${slotLabel || slotSize}）...`
        });

        const result = await provider.generate(
          {
            ...task.request,
            size: slotSize,
            ratio: task.request.ratio || "custom"
          },
          index,
          { signal: task.controller.signal }
        );
        const fileName = imageFileName(index, result.mime);
        const taskDir = join(generatedDir, task.taskId);
        await mkdir(taskDir, { recursive: true });
        await writeFile(join(taskDir, fileName), result.buffer);
        const url = `/generated/${task.taskId}/${fileName}`; // relative: survives http tunnels & host changes
        images.push({
          id: `${task.taskId}-image-${index + 1}`,
          url,
          status: "FINISH",
          prompt: task.request.prompt,
          model: result.model || provider.name,
          auditStatus: "PASSED",
          size: slotSize,
          slotLabel: slot?.label || ""
        });
        updateTask(task, {
          images,
          progress: 45 + Math.round(((index + 1) / count) * 40),
          content: index + 1 < count ? `第 ${index + 1} 张已完成，继续生成...` : "正在进行内容安全审核..."
        });
      }

      updateTask(task, {
        status: "DONE",
        progress: 100,
        content: "生成完成",
        images,
        watermark: "图片由智能营销生图助手生成",
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      if (task.aborted) {
        updateTask(task, {
          status: "ABORTED",
          progress: task.progress || 0,
          error: "任务已取消"
        });
      } else if (task.timeoutTriggered) {
        updateTask(task, {
          status: "TIMEOUT",
          error: "本次生成等待时间较长，任务已超时。"
        });
      } else {
        logger.error?.("[image-task]", error);
        updateTask(task, {
          status: "FAILED",
          error: error?.message || "Cloudflare Workers AI 生成失败"
        });
      }
    } finally {
      clearTimeout(timeout);
      task.controller = null;
      void persist();
    }
  }

  async function submit(request, origin) {
    const sessionId = request.sessionId || uid("session");
    const taskId = uid("task");
    const assistantMessageId = uid("message");
    const now = new Date().toISOString();
    const controller = new AbortController();
    const task = {
      sessionId,
      taskId,
      assistantMessageId,
      request,
      origin,
      status: "SUBMITTED",
      progress: 5,
      content: "任务已提交，等待生成服务处理...",
      images: [],
      aborted: false,
      timeoutTriggered: false,
      createdAt: now,
      updatedAt: now,
      controller
    };
    tasks.set(taskId, task);
    await persist();
    task.completion = new Promise((resolve) => {
      setImmediate(() => resolve(runTask(task)));
    });
    return {
      _action: "submitted",
      sessionId,
      taskId,
      assistantMessageId,
      status: "SUBMITTED"
    };
  }

  function poll({ sessionId, taskId, assistantMessageId }) {
    const task = tasks.get(taskId);
    if (!task || task.sessionId !== sessionId || task.assistantMessageId !== assistantMessageId) {
      return {
        _action: "notify_failed",
        status: "FAILED",
        error: "任务不存在、已过期或会话标识不匹配。"
      };
    }
    if (task.status === "DONE") {
      return {
        _action: "notify_done",
        status: "DONE",
        sessionId: task.sessionId,
        taskId: task.taskId,
        images: task.images,
        watermark: task.watermark
      };
    }
    if (task.status === "FAILED") {
      return { _action: "notify_failed", status: "FAILED", error: task.error };
    }
    if (task.status === "TIMEOUT") {
      return { _action: "notify_timeout", status: "TIMEOUT" };
    }
    if (task.status === "ABORTED") {
      return { _action: "notify_failed", status: "FAILED", error: "任务已取消" };
    }
    if (task.images?.length) {
      return {
        _action: "show_images",
        status: "RUNNING",
        progress: task.progress,
        content: task.content,
        images: task.images
      };
    }
    return {
      _action: "display",
      status: "RUNNING",
      progress: task.progress,
      content: task.content
    };
  }

  async function abort({ sessionId, taskId }) {
    const task = tasks.get(taskId);
    if (task && task.sessionId === sessionId && !["DONE", "FAILED", "TIMEOUT", "ABORTED"].includes(task.status)) {
      task.aborted = true;
      task.controller?.abort(new Error("user-aborted"));
      updateTask(task, { status: "ABORTED", error: "任务已取消" });
      await task.completion?.catch(() => undefined);
      await persist();
    }
    return { status: "ABORTED" };
  }

  return { init, submit, poll, abort, tasks };
}
