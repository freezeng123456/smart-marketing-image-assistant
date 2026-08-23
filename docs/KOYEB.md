# 在 Koyeb Free 上部署本项目

本文说明如何用 **Koyeb 免费实例** 从 GitHub 仓库 `freezeng123456/smart-marketing-image-assistant` 的 `main` 分支部署本应用。

## 前置条件

- GitHub 账号，且能访问仓库 `freezeng123456/smart-marketing-image-assistant`
- Koyeb 账号（可用 GitHub 登录）
- 准备好环境变量占位值（不要把真实密钥写进仓库；参考根目录 `.env.example`）

## 免费层注意（部署前必读）

1. **约 1 小时无流量后休眠**：Free 实例空闲一段时间会 sleep，再次访问需等待冷启动。
2. **磁盘临时（ephemeral）**：重启/休眠后本地写入会丢失，不要依赖容器内持久化文件。
3. **每个 Organization 仅 1 个 Free 服务**：同一 org 下已有 Free 服务时，需删除或升级后再建。

## 步骤

### 1. 用 GitHub 登录 Koyeb

1. 打开 https://app.koyeb.com
2. 选择 Continue with GitHub
3. 授权读取要部署的仓库

### 2. 创建服务并选择仓库

1. 点击 Create App / Create Service
2. 选择 GitHub 作为源
3. 选择仓库：freezeng123456/smart-marketing-image-assistant
4. 分支选择：main

### 3. 构建方式

1. Builder 选择 Buildpack
2. 确认 package.json engines 为 node 20.x
3. 启动命令：使用仓库根目录 Procfile，执行 npm start

### 4. 实例与区域

1. Instance 选择 Free
2. Region 建议：FRA 或 IAD

### 5. 端口与健康检查

- 应用监听端口：8000（环境变量 PORT=8000）
- Health check 路径：/functions/health
- 协议：HTTP

在 Koyeb 中把 Public HTTP port 设为 8000，健康检查路径设为 /functions/health。

### 6. 环境变量

在 Koyeb Environment variables 中按需添加（占位见 .env.example，填真实值，勿提交 Git）：

- PORT=8000（建议显式设置）
- MODELSCOPE_API_TOKEN
- SILICONFLOW_API_KEY
- CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN 及可选 CLOUDFLARE_*
- POLLINATIONS_API_KEY 等 POLLINATIONS_*（可选）

至少配置一种可用的生图 Provider。

### 7. 部署并访问

1. 点击 Deploy / Create
2. 等待 Buildpack 构建与实例就绪
3. 打开公网 URL，前端走 Functions API 时加查询参数：

   https://<你的-koyeb-域名>/?api=functions

4. 健康检查：

   https://<你的-koyeb-域名>/functions/health

## 常见问题

- 冷启动慢 / 504：Free 休眠唤醒需要时间，稍等再试。
- 健康检查失败：确认 PORT=8000、公网端口 8000、路径 /functions/health。
- 无法再建 Free 服务：检查 Organization 是否已有一个 Free 服务。
- 密钥泄露：切勿把 .env 提交进 Git；只用 Koyeb 控制台注入密钥。

## 相关文件

- Procfile — web 进程启动配置
- package.json — engines.node = 20.x
- .env.example — 环境变量占位说明
