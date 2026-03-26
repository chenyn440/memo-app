#!/usr/bin/env bash
set -euo pipefail

# 腾讯云 Ubuntu/CentOS 兼容的一键部署脚本：
# 1) 安装/校验 Nginx
# 2) 安装 meeting-signal systemd 服务
# 3) 写入并启用 Nginx 反代配置
#
# 用法：
# sudo bash scripts/setup-meeting-signal-tencent.sh \
#   --domain meet.example.com \
#   --project-dir /opt/memo-app \
#   --run-user ubuntu \
#   --signal-port 8787

DOMAIN=""
PROJECT_DIR=""
RUN_USER=""
SIGNAL_PORT="8787"
SITE_NAME="meeting-signal"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --project-dir)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --run-user)
      RUN_USER="${2:-}"
      shift 2
      ;;
    --signal-port)
      SIGNAL_PORT="${2:-}"
      shift 2
      ;;
    --site-name)
      SITE_NAME="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行（sudo）" >&2
  exit 1
fi

if [[ -z "$DOMAIN" || -z "$PROJECT_DIR" ]]; then
  cat >&2 <<'USAGE'
缺少必要参数。
示例：
sudo bash scripts/setup-meeting-signal-tencent.sh \
  --domain meet.example.com \
  --project-dir /opt/memo-app \
  --run-user ubuntu \
  --signal-port 8787
USAGE
  exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "project-dir 不存在: $PROJECT_DIR" >&2
  exit 1
fi

if [[ -z "$RUN_USER" ]]; then
  RUN_USER="$(stat -c %U "$PROJECT_DIR" 2>/dev/null || echo root)"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 npm，请先安装 Node.js 18+ 与 npm。" >&2
  exit 1
fi

echo "[1/6] 安装 Nginx..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx
else
  echo "不支持的包管理器，请手动安装 nginx" >&2
  exit 1
fi

echo "[2/6] 安装 Node 依赖..."
cd "$PROJECT_DIR"
npm install --omit=dev

SERVICE_FILE="/etc/systemd/system/meeting-signal.service"
echo "[3/6] 写入 systemd 服务: $SERVICE_FILE"
sed \
  -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
  -e "s|__SIGNAL_PORT__|$SIGNAL_PORT|g" \
  -e "s|__RUN_USER__|$RUN_USER|g" \
  "$PROJECT_DIR/scripts/meeting-signal.service.template" > "$SERVICE_FILE"

echo "[4/6] 启动 meeting-signal 服务..."
systemctl daemon-reload
systemctl enable --now meeting-signal

NGINX_CONF="/etc/nginx/conf.d/${SITE_NAME}.conf"
echo "[5/6] 写入 Nginx 配置: $NGINX_CONF"
sed \
  -e "s|__SERVER_NAME__|$DOMAIN|g" \
  -e "s|__UPSTREAM_PORT__|$SIGNAL_PORT|g" \
  "$PROJECT_DIR/scripts/nginx-meeting-signal.conf.template" > "$NGINX_CONF"

if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

echo "[6/6] 重载 Nginx..."
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1; then
  ufw allow 'Nginx Full' || true
fi

echo ""
echo "部署完成。"
echo "服务状态："
echo "  systemctl status meeting-signal --no-pager"
echo "  systemctl status nginx --no-pager"
echo ""
echo "健康检查："
echo "  curl -s http://127.0.0.1:${SIGNAL_PORT}/health"
echo "  curl -s http://${DOMAIN}/health"
echo ""
echo "若要启用 HTTPS，可执行："
echo "  sudo apt-get install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d ${DOMAIN}"
