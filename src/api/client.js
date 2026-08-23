import {
  submitMockTask,
  pollMockTask,
  abortMockTask,
  uploadMockReference
} from "./mock.js";
import { getRuntimeConfig, normalizeErrorMessage } from "../utils.js";

const config = getRuntimeConfig();

function endpoint(path) {
  return `${config.functionsBaseUrl}${path}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const timer = setTimeout(() => controller.abort("request-timeout"), config.requestTimeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {})
      }
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { error: await response.text() };

    if (!response.ok) {
      const error = new Error(payload?.error || payload?.message || `请求失败（${response.status}）`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("请求超时，请稍后重试。", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function postJson(path, body) {
  return fetchWithTimeout(endpoint(path), {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export const api = {
  mode: config.apiMode,
  config,

  async submitTask(request) {
    if (config.apiMode === "mock") return submitMockTask(request);
    return postJson("/functions/submit-task", request);
  },

  async pollTask(request) {
    if (config.apiMode === "mock") return pollMockTask(request);
    return postJson("/functions/poll-task", request);
  },

  async abortTask(request) {
    if (config.apiMode === "mock") return abortMockTask(request);
    return postJson("/functions/abort-task", request);
  },

  async uploadReference(file) {
    if (config.apiMode === "mock") return uploadMockReference(file);
    const formData = new FormData();
    formData.append("file", file, file.name);
    return fetchWithTimeout(endpoint("/functions/upload-reference"), {
      method: "POST",
      body: formData
    });
  },

  async listModels() {
    if (config.apiMode === "mock") {
      return {
        defaultModelId: "modelscope-zimage",
        models: [
          {
            id: "modelscope-zimage",
            label: "魔搭 · Z-Image-Turbo（调试快）",
            channel: "modelscope",
            available: true,
            exhausted: false,
            disabled: false
          }
        ],
        exhausted: {}
      };
    }
    return fetchWithTimeout(endpoint("/functions/models"), { method: "GET" });
  },

  async clearExhausted(channel = null) {
    if (config.apiMode === "mock") return { ok: true, exhausted: {} };
    return postJson("/functions/clear-exhausted", channel ? { channel } : {});
  },

  friendlyError(error) {
    return normalizeErrorMessage(error);
  }
};
