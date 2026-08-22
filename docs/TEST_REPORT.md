# 验收与真实联调记录

测试日期：2026-08-22

## 结论

- 前端到四个 Function 的真实调用路径已实现。
- Node Function 后端到 Cloudflare Workers AI 的 REST 适配已实现。
- FLUX.2 多参考图和二轮图片编辑请求结构已实现。
- 本地自动化测试全部通过。
- 当前 ChatGPT 容器无法访问公共网络，真实 Cloudflare Token 尚未获得 Cloudflare 服务端响应，因此不能宣称外部真生图已经在该容器中通过。

## 真实凭证尝试

凭证仅通过进程环境变量传入，没有写入文件。

执行：

```bash
npm run test:cloudflare
```

真实调用在第一步 Token 验证阶段失败：

```text
1/3 Verifying Cloudflare API token...
LIVE TEST FAILED
Name: TypeError
Message: fetch failed
Cause: getaddrinfo EAI_AGAIN api.cloudflare.com
```

该错误发生在 DNS 解析阶段，未收到 HTTP 状态码或 Cloudflare JSON。因此：

```text
Token 是否有效：未判定
Account ID 是否匹配：未判定
模型权限和额度：未判定
失败原因：测试容器公共网络不可达
```

## 代码修正

真实联调脚本首次执行时发现 `extensionForMime` 未导出。现已修复并增加显式导出，脚本可以正常进入外部 Token 验证阶段。

同时完成：

- `config.js` 默认由 Mock 改为真实 Function；
- `.env` 自动加载；
- FLUX.2 参考图片压缩到 512px 以下；
- `file://` 本地图片路径限制在项目和运行目录；
- 增加 `npm run share` 的 trycloudflare 临时分享脚本；
- 确认项目中不存在实际 Account ID 或 Token 字符串。

## 自动测试

执行：

```bash
npm run check
```

结果：

```text
22 个 JavaScript 文件语法检查通过
13 / 13 Node tests passed
```

覆盖内容：

1. Cloudflare Token 验证请求 URL 和 Authorization Header。
2. FLUX.2 Klein multipart 请求。
3. 品牌袋鼠参考图由服务器注入。
4. Token 不出现在请求 JSON、前端或持久化任务数据中。
5. 当前海报被作为二轮编辑参考图。
6. `submit-task` 立即返回，后台任务与 `poll-task` 分离。
7. 阶段图片和最终图片保存与访问。
8. 参考图上传。
9. 多轮调整复用同一个 `sessionId`。
10. 取消正在生成的任务。

## 在有公网的环境完成最后验证

```bash
cp .env.example .env
# 写入新的 Cloudflare Account ID 和 Token
npm run test:cloudflare
```

成功标志：

```text
LIVE TEST PASSED
```

并生成：

```text
debug-output/cloudflare-v1.jpg
debug-output/cloudflare-v2.jpg
```

随后运行：

```bash
npm run dev
```

打开 `http://localhost:4173/`，页面默认使用真实 Function。
