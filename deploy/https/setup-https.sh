#!/usr/bin/env bash
#
# Ubuntu 局域网 HTTPS 一键部署（mkcert 自建 CA + Caddy 反代到 Nuxt:80）
#
# 用法（在 Ubuntu 服务器上，root 或用 sudo）：
#   sudo bash setup-https.sh [SERVER_HOST]
#     SERVER_HOST  对外访问的主机，默认取本机第一个内网 IP，如 192.168.1.50
#                   （若用局域网主机名/域名，如 mylab.local，请显式传入）
#
# 作用：
#   1) 安装 mkcert + Caddy
#   2) 建立本地根 CA，并给 SERVER_HOST(localhost/127.0.0.1) 签发证书到 /etc/certs
#   3) 生成并安装 Caddy 反代配置，监听 443 -> 127.0.0.1:80
#   4) 通过 systemd 让 Caddy 开机自启
#   5) 输出根证书 rootCA.pem 路径，供局域网设备安装信任
#
set -euo pipefail

# ---------- 配置 ----------
SERVER_HOST="${1:-$(hostname -I | awk '{print $1}')}"
if [[ -z "$SERVER_HOST" ]]; then
  echo "[错误] 未检测到内网 IP，请显式传入 SERVER_HOST，例如: sudo bash setup-https.sh 192.168.1.50" >&2
  exit 1
fi
CERT_DIR=/etc/certs
CAROOT="${CAROOT:-/root/.local/share/mkcert}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 部署 HTTPS 对外地址: https://$SERVER_HOST"

# ---------- 1) 安装依赖 ----------
echo "==> 安装 mkcert / caddy"
if ! command -v apt-get >/dev/null 2>&1; then
  echo "[错误] 仅支持 apt 系 Ubuntu。" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null

if ! command -v mkcert >/dev/null 2>&1; then
  apt-get install -y libnss3-tools wget >/dev/null
  VER=1.4.4
  wget -qO /tmp/mkcert "https://github.com/FiloSottile/mkcert/releases/download/v${VER}/mkcert-v${VER}-linux-amd64"
  install -m 0755 /tmp/mkcert /usr/local/bin/mkcert
  rm -f /tmp/mkcert
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "==> 安装 Caddy（官方 apt 仓库）"
  apt-get install -y curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list
  if ! apt-get update >/dev/null 2>&1 || ! apt-get install -y caddy >/dev/null 2>&1; then
    echo "==> apt 安装失败，改用官方静态二进制"
    curl -sL "https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_linux_amd64.tar.gz" -o /tmp/caddy.tgz
    tar -xzf /tmp/caddy.tgz -C /tmp caddy
    install -m 0755 /tmp/caddy /usr/bin/caddy
    rm -f /tmp/caddy.tgz /tmp/caddy
  fi
fi

# ---------- 2) 建 CA + 签发证书 ----------
echo "==> 初始化本地 CA"
mkdir -p "$CERT_DIR"
mkcert -install

# localhost / 127.0.0.1 总是并入，便于本机验证
mkcert -cert-file "$CERT_DIR/$SERVER_HOST.pem" \
       -key-file  "$CERT_DIR/$SERVER_HOST.key" \
       "$SERVER_HOST" localhost 127.0.0.1

echo "==> 证书已生成:"
ls -l "$CERT_DIR/$SERVER_HOST.pem" "$CERT_DIR/$SERVER_HOST.key"

# ---------- 3) 生成 Caddy 配置并安装 ----------
echo "==> 生成 Caddyfile 并安装"
sed -e "s/SERVER_HOST/$SERVER_HOST/g" \
    "$SCRIPT_DIR/Caddyfile" > /etc/caddy/Caddyfile
cat /etc/caddy/Caddyfile

systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
systemctl --no-pager --lines 0 status caddy || true

# ---------- 4) 结果汇总 ----------
ROOTCA="$CAROOT/rootCA.pem"
echo
echo "===================================================================="
echo " [成功] HTTPS 入口:  https://$SERVER_HOST"
echo "        反向代理:     443 -> 127.0.0.1:80（你的 Nuxt 服务）"
echo
echo " 局域网设备信任根证书（每个访问端执行一次）:"
echo "   - 服务器根证书路径: $ROOTCA"
echo "   - 把该文件分发给各设备，导入系统「受信任的根证书」"
echo "     · Windows: 双击 rootCA.pem -> 安装证书 -> 受信任的根证书颁发机构"
echo "     · macOS:   双击 -> 钥匙串登录 -> 标记为始终信任"
echo "     · 手机:    安装描述文件后到设置里启用信任"
echo "     导入后请完全退出并重开浏览器"
echo "===================================================================="