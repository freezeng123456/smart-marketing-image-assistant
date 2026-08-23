import { shouldUseBrandKangaroo, BRAND_KANGAROO_CONSTRAINT } from "./brand-policy.mjs";
import { withEnglishModelPrompt } from "./model-brief-en.mjs";
import { normalizeModelSize } from "./cloudflare-provider.mjs";

const DEFAULT_BASE = "https://image.pollinations.ai/prompt";
const AUTH_GENERATIONS = "https://gen.pollinations.ai/v1/images/generations";

function buildPrompt(request) {
  const styles = Array.isArray(request.styles) && request.styles.length ? request.styles.join(", ") : "commercial marketing";
  const original = String(request.prompt || "").trim();
  const brand = shouldUseBrandKangaroo(request) ? BRAND_KANGAROO_CONSTRAINT : "";
  return [
    `Brief: ${original}`,
    brand,
    `Styles: ${styles}. Ratio ${request.ratio || "9:16"}, size ${request.size || "1080x1920"}.`,
    "Full-bleed commercial marketing poster; clear subject."
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

let chain = Promise.resolve();
function enqueue(job) {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}

export function createPollinationsProvider({
  apiKey = process.env.POLLINATIONS_API_KEY || "",
  apiBase = process.env.POLLINATIONS_API_BASE || (apiKey ? AUTH_GENERATIONS : DEFAULT_BASE),
  model = process.env.POLLINATIONS_MODEL || (apiKey ? "flux" : "flux"),
  outputMaxDimension = Number(process.env.POLLINATIONS_OUTPUT_MAX_DIMENSION || process.env.CLOUDFLARE_OUTPUT_MAX_DIMENSION || 768),
  maxRetries = Number(process.env.POLLINATIONS_MAX_RETRIES || 4),
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const useOpenAICompat = /\/v1\/images\/generations\/?$/.test(apiBase) || Boolean(apiKey);

  async function generateOnce(request, index = 0, { signal } = {}) {
    request = await withEnglishModelPrompt(request, { fetchImpl, logger });
    const activeModel = request.modelOverride || model;
    const prompt = buildPrompt(request);
    const { width, height } = normalizeModelSize(request.size, outputMaxDimension);
    const seed = (Date.now() + index * 7919) % 2147483647;

    if (useOpenAICompat) {
      const endpoint = apiBase.includes("/v1/images/generations") ? apiBase : AUTH_GENERATIONS;
      logger.info?.(`[Pollinations] generations ${width}x${height} via ${activeModel} (auth)`);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          prompt,
          model: activeModel,
          size: `${width}x${height}`,
          response_format: "b64_json",
          seed
        })
      });
      const text = await response.text();
      let payload = {};
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 300) };
      }
      if (!response.ok) {
        throw Object.assign(new Error(payload?.error?.message || payload?.message || text.slice(0, 400) || `Pollinations failed (${response.status})`), {
          status: response.status,
          payload
        });
      }
      const b64 = payload?.data?.[0]?.b64_json || payload?.data?.[0]?.b64;
      const url = payload?.data?.[0]?.url;
      let buffer;
      let mime = "image/jpeg";
      if (b64) {
        buffer = Buffer.from(b64, "base64");
      } else if (url) {
        const img = await fetchImpl(url, { signal });
        if (!img.ok) throw Object.assign(new Error(`image download failed (${img.status})`), { status: img.status });
        buffer = Buffer.from(await img.arrayBuffer());
        mime = img.headers.get("content-type") || mime;
      } else {
        throw new Error("Pollinations returned no image data");
      }
      return { buffer, mime, model: `pollinations/${activeModel}`, prompt };
    }

    const url = new URL(`${apiBase.replace(/\/$/, "")}/${encodeURIComponent(prompt)}`);
    url.searchParams.set("width", String(width));
    url.searchParams.set("height", String(height));
    url.searchParams.set("nologo", "true");
    url.searchParams.set("model", activeModel);
    url.searchParams.set("seed", String(seed));
    url.searchParams.set("enhance", "true");
    const headers = { Accept: "image/*" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    logger.info?.(`[Pollinations] generating ${width}x${height} via ${model}`);
    const response = await fetchImpl(url, { method: "GET", signal, headers });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw Object.assign(new Error(errText.slice(0, 400) || `Pollinations failed (${response.status})`), {
        status: response.status
      });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get("content-type") || "image/jpeg";
    return { buffer, mime, model: `pollinations/${activeModel}`, prompt };
  }

  async function generate(request, index = 0, options = {}) {
    return enqueue(async () => {
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          return await generateOnce(request, index, options);
        } catch (error) {
          lastError = error;
          const status = Number(error?.status || 0);
          const retryable = status === 429 || status === 502 || status === 503;
          if (!retryable || attempt === maxRetries) throw error;
          const waitMs = Math.min(60_000, 8_000 * (attempt + 1));
          logger.warn?.(`[Pollinations] ${status} on attempt ${attempt + 1}, retry in ${waitMs}ms`);
          await sleep(waitMs, options.signal);
        }
      }
      throw lastError;
    });
  }

  return {
    name: "pollinations",
    textModel: `pollinations/${model}`,
    editModel: `pollinations/${model}`,
    generate
  };
}

export function createFailoverProvider({ primary, fallback, logger = console, onQuotaError = null } = {}) {
  if (!primary?.generate) throw new Error("primary provider required");
  if (!fallback?.generate) throw new Error("fallback provider required");

  function quotaLike(error) {
    const message = String(error?.message || "");
    const status = Number(error?.status || 0);
    return (
      status === 402 ||
      status === 429 ||
      /neuron|quota|rate.?limit|used up|free allocation|billing|credit|queue full|insufficient|exhausted|余额不足|额度/i.test(message)
    );
  }

  async function generate(request, index = 0, options = {}) {
    try {
      return await primary.generate(request, index, options);
    } catch (error) {
      if (!quotaLike(error)) throw error;
      try { await onQuotaError?.(error); } catch {}
      logger.warn?.(`[Failover] primary failed (${error.status || "n/a"}): ${error.message}. Trying ${fallback.name}.`);
      return fallback.generate(request, index, options);
    }
  }

  return {
    name: `${primary.name}+${fallback.name}`,
    textModel: primary.textModel,
    editModel: primary.editModel,
    accountId: primary.accountId,
    generate,
    verifyToken: primary.verifyToken?.bind(primary),
    primary,
    fallback
  };
}
