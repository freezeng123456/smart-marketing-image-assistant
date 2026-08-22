# Function 与 Cloudflare Workers AI 接入说明

## 当前运行模式

`config.js` 默认：

```js
apiMode: "functions"
```

因此正常打开页面会请求真实同源 Function。可使用以下地址切换：

```text
/?api=functions   强制真实后端
/?api=mock        强制浏览器 Mock
```

所有 Token、API Key、模型路由和品牌素材路径都只存在于服务器环境或后端代码中。

## 真实模型调用

### 首轮和编辑模型

```text
@cf/black-forest-labs/flux-2-klein-4b
```

请求类型：`multipart/form-data`。

服务端字段：

```text
prompt
width
height
guidance
seed
input_image_0
input_image_1
input_image_2
input_image_3
```

调整任务中：

```text
input_image_0 = 当前海报版本
input_image_1 = 品牌袋鼠参考图
input_image_2+ = 用户参考图
```

首轮生成中：

```text
input_image_0 = 品牌袋鼠参考图
input_image_1+ = 用户参考图
```

输入参考图在服务器端压缩到 512px 以下。浏览器不能指定内部模型参数或覆盖品牌素材。

### 首轮降级模型

```text
@cf/black-forest-labs/flux-1-schnell
```

仅在首轮 FLUX.2 因模型权限、额度、合作模型可用性等错误失败时降级。Schnell 是文生图模型，因此不会用于需要当前图片上下文的二轮编辑。

## 1. POST `/functions/submit-task`

首轮请求：

```json
{
  "prompt": "用户原始营销需求",
  "brandAsset": "brand-kangaroo",
  "generationType": "text-to-image",
  "ratio": "9:16",
  "size": "1080x1920",
  "styles": ["品牌官方", "节日氛围"],
  "imageCount": 2,
  "referenceImages": [],
  "sessionId": null
}
```

多轮调整：

```json
{
  "prompt": "把袋鼠改成双手比心",
  "brandAsset": "brand-kangaroo",
  "generationType": "image-edit",
  "ratio": "9:16",
  "size": "1080x1920",
  "styles": ["品牌官方", "节日氛围"],
  "imageCount": 2,
  "referenceImages": [],
  "sessionId": "session-001",
  "contextImageUrl": "https://example.com/current.jpg",
  "parentVersion": 2,
  "context": {
    "currentImageUrl": "https://example.com/current.jpg",
    "version": 2
  }
}
```

返回 HTTP 202：

```json
{
  "_action": "submitted",
  "sessionId": "session-001",
  "taskId": "task-001",
  "assistantMessageId": "message-001",
  "status": "SUBMITTED"
}
```

该接口只创建任务并立即返回，不等待图片完成。

## 2. POST `/functions/poll-task`

```json
{
  "sessionId": "session-001",
  "taskId": "task-001",
  "assistantMessageId": "message-001"
}
```

支持返回：

```text
_action: display
_action: show_images
_action: notify_done
_action: notify_failed
_action: notify_timeout
```

完成结果中的图片 URL 保持完整，不截断 query 参数。

## 3. POST `/functions/abort-task`

```json
{
  "sessionId": "session-001",
  "taskId": "task-001"
}
```

返回：

```json
{ "status": "ABORTED" }
```

## 4. POST `/functions/upload-reference`

请求：`multipart/form-data`，字段名 `file`。

返回：

```json
{
  "url": "https://example.com/uploads/image-001.png",
  "fileName": "image-001.png",
  "size": 102400
}
```

## 环境变量

```dotenv
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_TEXT_MODEL=@cf/black-forest-labs/flux-2-klein-4b
CLOUDFLARE_EDIT_MODEL=@cf/black-forest-labs/flux-2-klein-4b
CLOUDFLARE_FALLBACK_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_OUTPUT_MAX_DIMENSION=496
CLOUDFLARE_REFERENCE_MAX_DIMENSION=496
```

凭证必须位于服务器环境或 `.env`；`.env` 不得提交到 Git。

## 联调命令

```bash
npm run test:cloudflare
npm run dev
npm run share
```

浏览器 Network 面板应看到一次提交、固定间隔轮询、完成后停止轮询；调整时请求继续使用原 `sessionId`。
