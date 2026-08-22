/**
 * 运行时配置。这里只能放非敏感配置，禁止写入 token、API Key 或内部鉴权信息。
 *
 * apiMode:
 * - "functions": 默认调用真实 /functions/* 后端
 * - "mock": 使用浏览器内 mock（可通过 ?api=mock 临时切换）
 * - "auto": localhost 使用 mock，其他环境使用真实 Function
 */
window.__MARKETING_ASSISTANT_CONFIG__ = Object.freeze({
  apiMode: "functions",
  functionsBaseUrl: "",
  pollIntervalMs: 3000,
  requestTimeoutMs: 30000,
  maxPollErrors: 3
});
