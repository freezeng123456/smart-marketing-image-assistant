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

export function createTaskService({ provider, runtimeDir, logger = console, taskTimeoutMs = 240_000 }) {
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
    const plannedSlots = Array.isArray(task.request.resourceSlots) && task.request.resourceSlots.length
      ? task.request.resourceSlots.slice(0, 1)
      : null;
    const plannedCount = plannedSlots ? plannedSlots.length : 1;
    // Img2Img multi-slot runs serially → need N× headroom; light parallel jobs need ~1.35×.
    const earlyHeavy =
      (Array.isArray(task.request?.referenceImages) && task.request.referenceImages.length > 0) ||
      task.request?.brandAsset === "brand-kangaroo" ||
      /美团|美團|meituan|品牌袋鼠/i.test(String(task.request?.prompt || ""));
    const effectiveTimeoutMs = Math.min(
      Number(process.env.TASK_TIMEOUT_MAX_MS) || 720_000,
      Math.max(
        taskTimeoutMs,
        earlyHeavy && plannedCount > 1
          ? taskTimeoutMs * plannedCount
          : Math.round(taskTimeoutMs * (plannedCount > 1 ? 1.35 : 1))
      )
    );
    const timeout = setTimeout(() => {
      task.timeoutTriggered = true;
      task.controller?.abort(new Error("task-timeout"));
    }, effectiveTimeoutMs);

    try {
      updateTask(task, {
        status: "RUNNING",
        progress: 12,
        content: stageContent(12)
      });
      const slots = plannedSlots;
      const count = plannedCount;
      const images = [];
      const taskDir = join(generatedDir, task.taskId);
      await mkdir(taskDir, { recursive: true });

      const slotJobs = Array.from({ length: count }, (_, index) => {
        const slot = slots?.[index] || null;
        const slotSize = slot ? `${slot.width}x${slot.height}` : task.request.size;
        const slotLabel = slot ? `${slot.label || "资源位"} ${slotSize}` : slotSize;
        return { index, slot, slotSize, slotLabel };
      });

      const hasRefs = Array.isArray(task.request.referenceImages) && task.request.referenceImages.length > 0;
      const heavyImg2Img =
        hasRefs ||
        task.request.brandAsset === "brand-kangaroo" ||
        /美团|美團|meituan|品牌袋鼠/i.test(String(task.request.prompt || ""));
      // Free Render OOMs easily with parallel Qwen-Edit + refs; run those slots one-by-one.
      const parallel = count > 1 && !heavyImg2Img;

      updateTask(task, {
        progress: 30,
        content: count > 1
          ? (parallel ? `正在并行生成 ${count} 个资源位...` : `正在依次生成 ${count} 个资源位（图生图串行更稳）...`)
          : (slotJobs[0]?.slotLabel ? `正在生成 ${slotJobs[0].slotLabel}...` : "正在调用生图模型...")
      });

      const runSlot = async ({ index, slot, slotSize, slotLabel }) => {
          if (task.aborted) throw new DOMException("Aborted", "AbortError");
          const result = await provider.generate(
            {
              ...task.request,
              size: slotSize,
              ratio: task.request.ratio || "custom"
            },
            index,
            { signal: task.controller.signal }
          );
          let outBuffer = result.buffer;
          let outMime = result.mime;
          const fileName = imageFileName(index, outMime);
          await writeFile(join(taskDir, fileName), outBuffer);
          const url = `/generated/${task.taskId}/${fileName}`;
          const image = {
            id: `${task.taskId}-image-${index + 1}`,
            url,
            status: "FINISH",
            prompt: task.request.prompt,
            model: result.model || provider.name,
            auditStatus: "PASSED",
            size: slotSize,
            slotLabel: slot?.label || ""
          };
          images[index] = image;
          const ready = images.filter(Boolean);
          updateTask(task, {
            images: ready,
            progress: Math.min(92, 35 + Math.round((ready.length / count) * 55)),
            content: ready.length < count
              ? `已完成 ${ready.length}/${count}（刚完成：${slotLabel}），继续生成中...`
              : "正在进行内容安全审核..."
          });
          return image;
      };

      let settled;
      if (parallel) {
        settled = await Promise.allSettled(slotJobs.map((job) => runSlot(job)));
      } else {
        settled = [];
        for (const job of slotJobs) {
          try {
            settled.push({ status: "fulfilled", value: await runSlot(job) });
          } catch (reason) {
            settled.push({ status: "rejected", reason });
          }
        }
      }

      if (task.aborted) throw new DOMException("Aborted", "AbortError");
      if (task.timeoutTriggered) throw new Error("task-timeout");

      const failures = settled
        .map((item, index) => (item.status === "rejected" ? { index, reason: item.reason } : null))
        .filter(Boolean);
      const ready = images.filter(Boolean);

      if (!ready.length) {
        const first = failures[0]?.reason;
        throw first || new Error("全部资源位生成失败");
      }

      updateTask(task, {
        status: "DONE",
        progress: 100,
        content: failures.length
          ? `已生成 ${ready.length}/${count} 张，有 ${failures.length} 个资源位失败可单独重试。`
          : "生成完成",
        images: ready,
        watermark: "图片由智能营销生图助手生成",
        completedAt: new Date().toISOString()
      });
      if (failures.length) {
        logger.warn?.(
          "[image-task] partial slot failures",
          failures.map((f) => ({ index: f.index, message: f.reason?.message || String(f.reason) }))
        );
      }
    } catch (error) {
      if (task.aborted) {
        updateTask(task, {
          status: "ABORTED",
          progress: task.progress || 0,
          error: "任务已取消"
        });
      } else if (task.timeoutTriggered) {
        const partial = Array.isArray(task.images) ? task.images : [];
        if (partial.length) {
          // Keep finished slots instead of discarding the whole multi-select run.
          updateTask(task, {
            status: "DONE",
            progress: 100,
            content: `已生成 ${partial.length} 张，其余资源位超时未完成，可单独再生成。`,
            images: partial,
            watermark: "图片由智能营销生图助手生成",
            partialTimeout: true,
            completedAt: new Date().toISOString()
          });
        } else {
          updateTask(task, {
            status: "TIMEOUT",
            error: "本次生成等待时间较长，任务已超时。"
          });
        }
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
        error:
          "任务不存在或服务已重启（Render 免费实例闲置会休眠/重载）。请重新生成；多资源位并行较耗时，更容易碰到这个问题。"
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
