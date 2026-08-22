# 智能营销生图助手（Cloudflare Workers AI 真生图版）

这是一个面向营销人员的品牌 IP 生图前端和本地 Function 后端。页面保留原有深色营销工具视觉与导航结构，同时实现真实的异步任务提交、轮询、取消、参考图上传、结果版本管理和多轮图片编辑。

当前默认模式是 **真实 Function 模式**。浏览器会调用同源的：

```text
POST /functions/submit-task
POST /functions/poll-task
POST /functions/abort-task
POST /functions/upload-reference
```

Mock 仍保留用于无凭证演示，可通过 `?api=mock` 明确启用。

## 本次真实联调结论

项目中的 Cloudflare 请求结构已经按官方 Workers AI 接口实现，并通过本地模拟 Cloudflare 服务的端到端测试。

在 ChatGPT 当前运行容器中，使用服务器环境变量尝试执行真实 Token 验证时，连接在收到任何 Cloudflare HTTP 响应之前失败：

```text
fetch failed
getaddrinfo EAI_AGAIN api.cloudflare.com
```

这说明当前容器没有公共网络 DNS/出站能力，**不能据此判断 Token 有效或无效**。Token 没有写入项目、日志、前端或压缩包。真实凭证验证需要在可访问公网的电脑、服务器或 Cloudflare Worker 上执行。

## 模型路由

默认模型：

```text
首轮生成：@cf/black-forest-labs/flux-2-klein-4b
多轮编辑：@cf/black-forest-labs/flux-2-klein-4b
首轮降级：@cf/black-forest-labs/flux-1-schnell
```

`flux-2-klein-4b` 使用 `multipart/form-data`，服务端会自动注入：

1. 当前版本图片（调整任务时）；
2. 内置品牌袋鼠参考图；
3. 用户上传的商品、场景或构图参考图。

最多向模型发送 4 张参考图。参考图片在服务端压缩到 512px 以下后再送入模型。

## 快速开始

要求：Node.js 20+。

```bash
cp .env.example .env
```

编辑 `.env`：

```dotenv
CLOUDFLARE_ACCOUNT_ID=你的账户ID
CLOUDFLARE_API_TOKEN=你的Workers-AI-Token

CLOUDFLARE_TEXT_MODEL=@cf/black-forest-labs/flux-2-klein-4b
CLOUDFLARE_EDIT_MODEL=@cf/black-forest-labs/flux-2-klein-4b
CLOUDFLARE_FALLBACK_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_OUTPUT_MAX_DIMENSION=496
CLOUDFLARE_REFERENCE_MAX_DIMENSION=496
PORT=4173
```

`.env` 已被 `.gitignore` 排除。不要把实际 Token 写入 `config.js`、`src/`、HTML、README 或 Git。

### 1. 先验证真实 Cloudflare 生图和二轮编辑

```bash
npm run test:cloudflare
```

成功时会执行：

1. 验证 Cloudflare API Token；
2. 生成一张真实七夕袋鼠海报 V1；
3. 把 V1 作为 `input_image_0`，连同品牌袋鼠参考图提交二轮编辑；
4. 保存：

```text
debug-output/cloudflare-v1.jpg
debug-output/cloudflare-v2.jpg
```

脚本不会打印 Token。

### 2. 启动完整页面

```bash
npm run dev
```

打开：

```text
http://localhost:4173/
```

当前 `config.js` 默认使用真实 Function。需要查看纯 Mock 演示时打开：

```text
http://localhost:4173/?api=mock
```

后端状态：

```text
http://localhost:4173/functions/health
```

## 创建临时可分享链接

macOS 安装 Cloudflare Tunnel：

```bash
brew install cloudflared
```

随后运行：

```bash
npm run share
```

终端会输出一个临时地址：

```text
https://随机名称.trycloudflare.com
```

该地址会代理整个前端和同源 Function，因此分享页面调用的仍是真实 Cloudflare Workers AI，而不是浏览器 Mock。终端退出后临时地址失效。

临时公开页面没有登录和额度保护。只适合短时间验收，不应长期公开，否则其他人可能消耗你的 Workers AI 额度。

## 已实现的真实流程

### 异步提交与轮询

`submit-task` 立即返回：

```json
{
  "_action": "submitted",
  "sessionId": "session-...",
  "taskId": "task-...",
  "assistantMessageId": "message-...",
  "status": "SUBMITTED"
}
```

后端在后台调用模型。前端每约 3 秒调用 `poll-task`，支持：

```text
display
show_images
notify_done
notify_failed
notify_timeout
```

### 多轮图片编辑

快捷调整和自定义调整都会复用当前 `sessionId`，并传入：

```json
{
  "generationType": "image-edit",
  "sessionId": "原会话ID",
  "contextImageUrl": "当前版本完整URL",
  "parentVersion": 2,
  "context": {
    "currentImageUrl": "当前版本完整URL",
    "version": 2
  }
}
```

后端会读取当前图片并作为 FLUX.2 参考输入。旧版本不覆盖，新版本继续追加到会话历史。

### 参考图上传

`upload-reference` 接收 `multipart/form-data`，支持 PNG、JPG、JPEG、WEBP，单张不超过 10MB。上传后的 URL 由后端保存并传给模型，品牌袋鼠素材始终由服务器统一注入。

### 取消任务

`abort-task` 会停止前端轮询并触发当前 Node 后端中的 `AbortController`。如果上游请求已经完成，任务结果会被丢弃。

## 在 GitHub Actions 中执行真实外网测试

仓库包含手动工作流：

```text
.github/workflows/cloudflare-live-test.yml
```

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 添加：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

随后在 `Actions → Cloudflare Workers AI live test → Run workflow` 手动运行。成功后可以下载 V1/V2 图片 Artifact。这样 Token 不进入仓库，测试也在具有公网访问能力的 GitHub Runner 中执行。

## 自动测试

```bash
npm run check
```

当前覆盖：

- Cloudflare Token 验证请求结构；
- FLUX.2 multipart 字段和模型 URL；
- Authorization 只存在于后端请求头；
- 品牌袋鼠参考图注入；
- 当前海报作为下一轮编辑上下文；
- 异步 `submit-task` / `poll-task`；
- 图片结果保存和访问；
- 参考图上传；
- 多轮 `sessionId` 复用；
- 任务取消；
- 前端输入校验和品牌保护。

## 目录

```text
.
├── index.html
├── styles.css
├── config.js
├── src/
│   ├── app.js
│   ├── store.js
│   ├── utils.js
│   └── api/
│       ├── client.js
│       └── mock.js
├── server/
│   ├── app-server.mjs
│   ├── cloudflare-provider.mjs
│   ├── image-utils.mjs
│   ├── source-loader.mjs
│   └── task-service.mjs
├── scripts/
│   ├── serve.mjs
│   ├── test-cloudflare-live.mjs
│   └── share-trycloudflare.sh
├── assets/brand-kangaroo.png
├── tests/
└── docs/
```

## 生产部署说明

当前 Node 后端适合本地联调、服务器部署和 `trycloudflare` 临时演示。正式 Cloudflare 部署建议改为：

```text
Cloudflare Pages / Worker
+ Workers AI Binding（env.AI）
+ KV 或 D1 任务状态
+ R2 图片与参考图
+ Queue / Workflow 后台任务
+ Cloudflare Access 或业务登录
```

生产 Worker 使用 Workers AI Binding 时不需要在运行代码中保存 Workers AI Token，权限由 Binding 提供。完整接口契约见 [`docs/NOCODE_FUNCTIONS.md`](docs/NOCODE_FUNCTIONS.md)。
