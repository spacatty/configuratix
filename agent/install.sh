#!/bin/bash
set -euo pipefail

# Configuratix Agent Installer (standalone)
# Usage: curl -sSL http://YOUR_SERVER/install.sh | sudo bash -s -- YOUR_TOKEN
#   or:  CONFIGURATIX_SERVER=https://server sudo ./install.sh YOUR_TOKEN
#
# The server-served installer (backend/internal/handlers/install.go) also
# provisions nginx/ufw/fail2ban; this script only installs the agent.

TOKEN="${1:-}"
SERVER_URL="${CONFIGURATIX_SERVER:-http://localhost:8080}"
BIN_DIR="/opt/configuratix/bin"
AGENT_PATH="$BIN_DIR/configuratix-agent"

if [ -z "$TOKEN" ]; then
    echo "Error: Enrollment token is required"
    echo "Usage: curl -sSL http://YOUR_SERVER/install.sh | sudo bash -s -- YOUR_TOKEN"
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

echo "=== Configuratix Agent Installer ==="
echo "Server: $SERVER_URL"

case "$(uname -m)" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Error: unsupported architecture $(uname -m)"; exit 1 ;;
esac
echo "Architecture: $ARCH"

mkdir -p /etc/configuratix "$BIN_DIR" /var/lib/configuratix

echo "Downloading agent binary..."
TMP="$(mktemp "$BIN_DIR/.configuratix-agent.XXXXXX")"
HDRS="$(mktemp)"
trap 'rm -f "$TMP" "$HDRS"' EXIT
curl -fsSL -D "$HDRS" -o "$TMP" "$SERVER_URL/api/agent/download?arch=$ARCH"

EXPECTED="$(grep -i '^x-agent-checksum:' "$HDRS" | awk '{print $2}' | tr -d '\r' | tr 'A-F' 'a-f')"
if [ -z "$EXPECTED" ]; then
    echo "Error: server did not publish a checksum for the agent binary"
    exit 1
fi
ACTUAL="$(sha256sum "$TMP" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "Error: checksum mismatch (expected $EXPECTED, got $ACTUAL)"
    exit 1
fi
chmod 0755 "$TMP"
mv -f "$TMP" "$AGENT_PATH"
echo "Agent $("$AGENT_PATH" version) installed to $AGENT_PATH"

echo "Enrolling agent..."
"$AGENT_PATH" enroll --server "$SERVER_URL" --token "$TOKEN"

cat > /etc/systemd/system/configuratix-agent.service << EOF
[Unit]
Description=Configuratix Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$AGENT_PATH run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable configuratix-agent
systemctl restart configuratix-agent

echo ""
echo "=== Installation Complete ==="
echo "Check status: systemctl status configuratix-agent"
echo "View logs:    journalctl -u configuratix-agent -f"
