#!/usr/bin/env bash
set -euo pipefail

# 最简 PM2 启动脚本
# 用法：
#   bash scripts/start-meeting-signal-pm2.sh
#   APP_NAME=meeting-signal-prod SIGNAL_PORT=8081 bash scripts/start-meeting-signal-pm2.sh

APP_NAME="${APP_NAME:-meeting-signal}"
SIGNAL_HOST="${SIGNAL_HOST:-127.0.0.1}"
SIGNAL_PORT="${SIGNAL_PORT:-8787}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "未检测到 pm2，请先安装：npm i -g pm2" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 node，请先安装 Node.js 18+" >&2
  exit 1
fi

cd "$PROJECT_DIR"

echo "启动 PM2 应用: $APP_NAME (host=${SIGNAL_HOST}, port=${SIGNAL_PORT})"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
MEETING_SIGNAL_HOST="$SIGNAL_HOST" MEETING_SIGNAL_PORT="$SIGNAL_PORT" \
  pm2 start scripts/meeting-signal-server.mjs \
    --name "$APP_NAME" \
    --cwd "$PROJECT_DIR" \
    --interpreter node \
    --update-env
pm2 save

echo "完成。可用命令："
echo "  pm2 status"
echo "  pm2 logs $APP_NAME --lines 100"
echo "  curl -s http://${SIGNAL_HOST}:${SIGNAL_PORT}/health"
