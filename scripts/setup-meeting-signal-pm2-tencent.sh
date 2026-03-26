#!/usr/bin/env bash
set -euo pipefail

# 腾讯云 PM2 方案一键部署脚本：
# 1) 安装/校验 Nginx
# 2) 安装 Node 依赖 + PM2
# 3) 生成并启动 PM2 进程
# 4) 写入 Nginx 反代配置
#
# 用法：
# sudo bash scripts/setup-meeting-signal-pm2-tencent.sh \
#   --domain meet.example.com \
#   --project-dir /opt/memo-app \
#   --run-user root \
#   --signal-port 8787

DOMAIN=""
PROJECT_DIR=""
RUN_USER=""
SIGNAL_PORT="8787"
SITE_NAME="meeting-signal"
APP_NAME="meeting-signal"

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
    --app-name)
      APP_NAME="${2:-}"
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
sudo bash scripts/setup-meeting-signal-pm2-tencent.sh \
  --domain meet.example.com \
  --project-dir /opt/memo-app \
  --run-user root \
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

if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  echo "run-user 不存在: $RUN_USER" >&2
  exit 1
fi

NPM_BIN="$(command -v npm || true)"
if [[ -z "$NPM_BIN" ]]; then
  echo "未检测到 npm，请先安装 Node.js 18+ 与 npm。" >&2
  exit 1
fi

RUN_HOME="$(eval echo "~${RUN_USER}")"

echo "[1/7] 安装 Nginx..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx
else
  echo "不支持的包管理器，请手动安装 nginx" >&2
  exit 1
fi

echo "[2/7] 安装 Node 依赖..."
cd "$PROJECT_DIR"
"$NPM_BIN" install --omit=dev

echo "[3/7] 安装 PM2..."
"$NPM_BIN" install -g pm2

echo "[4/7] 生成 PM2 配置..."
mkdir -p "$PROJECT_DIR/logs"
PM2_CONFIG_FILE="$PROJECT_DIR/scripts/meeting-signal.pm2.config.cjs"
sed \
  -e "s|__APP_NAME__|$APP_NAME|g" \
  -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
  -e "s|__SIGNAL_PORT__|$SIGNAL_PORT|g" \
  "$PROJECT_DIR/scripts/meeting-signal.pm2.config.template.cjs" > "$PM2_CONFIG_FILE"

echo "[5/7] 启动 PM2 服务..."
su - "$RUN_USER" -c "cd '$PROJECT_DIR' && pm2 delete '$APP_NAME' >/dev/null 2>&1 || true && pm2 start '$PM2_CONFIG_FILE' --only '$APP_NAME' && pm2 save"
pm2 startup systemd -u "$RUN_USER" --hp "$RUN_HOME" >/dev/null 2>&1 || true

NGINX_CONF="/etc/nginx/conf.d/${SITE_NAME}.conf"
echo "[6/7] 写入 Nginx 配置: $NGINX_CONF"
sed \
  -e "s|__SERVER_NAME__|$DOMAIN|g" \
  -e "s|__UPSTREAM_PORT__|$SIGNAL_PORT|g" \
  "$PROJECT_DIR/scripts/nginx-meeting-signal.conf.template" > "$NGINX_CONF"

if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

echo "[7/7] 重载 Nginx..."
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1; then
  ufw allow 'Nginx Full' || true
fi

echo ""
echo "部署完成（PM2 模式）。"
echo "进程状态："
echo "  su - ${RUN_USER} -c 'pm2 status'"
echo "  su - ${RUN_USER} -c 'pm2 logs ${APP_NAME} --lines 100'"
echo ""
echo "健康检查："
echo "  curl -s http://127.0.0.1:${SIGNAL_PORT}/health"
echo "  curl -s http://${DOMAIN}/health"
