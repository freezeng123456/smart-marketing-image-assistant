#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"
HEALTH_FILE="${TMPDIR:-/tmp}/marketing-health-$$.json"

if ! command -v cloudflared >/dev/null 2>&1; then
  cat >&2 <<'MSG'
未检测到 cloudflared。
macOS 安装：brew install cloudflared
其他系统：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
MSG
  exit 1
fi

cd "$ROOT"
node scripts/serve.mjs &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  rm -f "$HEALTH_FILE"
}
trap cleanup EXIT INT TERM

READY=0
for _ in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "本地服务启动失败。" >&2
    wait "$SERVER_PID"
    exit 1
  fi
  STATUS="$(curl -sS -o "$HEALTH_FILE" -w '%{http_code}' "http://127.0.0.1:${PORT}/functions/health" 2>/dev/null || true)"
  if [[ "$STATUS" == "200" ]]; then
    READY=1
    break
  fi
  if [[ "$STATUS" == "503" ]]; then
    echo "真实生图后端未启用，请先在 .env 配置 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN。" >&2
    cat "$HEALTH_FILE" >&2 || true
    exit 1
  fi
  sleep 0.25
done

if [[ "$READY" != "1" ]]; then
  echo "本地服务在规定时间内没有就绪。" >&2
  exit 1
fi

echo
echo "正在创建临时公网地址。终端输出中的 https://*.trycloudflare.com 即为分享链接。"
echo "停止分享请按 Ctrl+C。"
echo
cloudflared tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate
