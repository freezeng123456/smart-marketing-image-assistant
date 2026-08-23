import { DEFAULT_MODEL_ID, findModel, isQuotaError, resolveModelForRequest } from "./model-catalog.mjs";
export function createRouterProvider({
  providersByChannel,
  defaultChain,
  exhaustedStore,
  logger = console
} = {}) {
  if (!defaultChain?.generate) throw new Error("defaultChain required");

  async function generate(request, index = 0, options = {}) {
    const entry = resolveModelForRequest(request);
    const requestedId = request.modelId || request.preferredModelId || DEFAULT_MODEL_ID;
    if (entry?.id && entry.id !== requestedId) {
      logger.warn?.(
        `[Router] model ${requestedId} is weak for img2img; switching to ${entry.id} because reference/brand images are present`
      );
    }
    const channel = entry?.channel;
    const target = channel ? providersByChannel[channel] : null;

    const run = async (provider, label) => {
      try {
        const nextRequest = {
          ...request,
          modelOverride: entry?.model || request.modelOverride,
          modelId: entry?.id || requestedId
        };
        return await provider.generate(nextRequest, index, options);
      } catch (error) {
        if (channel && isQuotaError(error) && exhaustedStore) {
          await exhaustedStore.mark(channel, error.message);
          logger.warn?.(`[Router] marked ${channel} exhausted: ${error.message}`);
        }
        error.channel = channel || label;
        error.modelId = entry?.id || requestedId;
        throw error;
      }
    };

    // Explicit model pick: use that channel only (no silent failover to another family)
    if (target?.generate) {
      logger.info?.(`[Router] using ${channel} / ${entry.model}`);
      return run(target, channel);
    }

    // Auto / missing: failover chain
    try {
      return await defaultChain.generate(request, index, options);
    } catch (error) {
      if (isQuotaError(error) && exhaustedStore) {
        const guessed =
          /dashscope|bailian|百炼|wanx/i.test(error.message) ? "dashscope"
          : /modelscope|魔搭/i.test(error.message) ? "modelscope"
          : /silicon|kolors/i.test(error.message) ? "siliconflow"
          : /cloudflare|neuron|workers ai/i.test(error.message) ? "cloudflare"
          : /pollinations/i.test(error.message) ? "pollinations"
          : null;
        if (guessed) await exhaustedStore.mark(guessed, error.message);
      }
      throw error;
    }
  }

  return {
    name: "router",
    textModel: defaultChain.textModel,
    editModel: defaultChain.editModel,
    generate,
    providersByChannel,
    defaultChain
  };
}
