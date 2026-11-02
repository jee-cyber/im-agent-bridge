#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="$(command -v node)"
DWS="$(command -v dws || true)"
LABEL="com.im-agent-bridge"
OLD_LABEL="com.cursor.dingtalk-im-bridge"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/im-agent-bridge"

if [[ -z "$NODE" ]]; then
  echo "未找到 node，请先安装 Node.js 并加入 PATH。" >&2
  exit 1
fi
if [[ -z "$DWS" ]]; then
  echo "未找到 dws，请先安装钉钉 DWS CLI。" >&2
  exit 1
fi

if [[ -z "${IM_BRIDGE_SELF_OPEN_ID:-}${DINGTALK_SELF_OPEN_ID:-}" ]]; then
  echo "警告: 未设置 IM_BRIDGE_SELF_OPEN_ID 或 DINGTALK_SELF_OPEN_ID，桥会把自己的消息也收进来。" >&2
fi

mkdir -p "$LOG_DIR" "$ROOT/data/state" "$ROOT/data/inbox" "$ROOT/data/media"
touch "$ROOT/data/auto-reply.flag"

NODE_BIN="$(dirname "$NODE")"
DWS_BIN="$(dirname "$DWS")"
CURSOR_BIN="/Applications/Cursor.app/Contents/Resources/app/bin"
USER_BIN="${HOME}/bin"
export PATH="$USER_BIN:$NODE_BIN:$DWS_BIN:$CURSOR_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  printf '%s' "$s"
}

plist_pair() {
  local key="$1"
  local val="$2"
  if [[ -n "$val" ]]; then
    printf '    <key>%s</key>\n    <string>%s</string>\n' "$key" "$(xml_escape "$val")"
  fi
}

ENV_EXTRA="$(plist_pair DWS_PROFILE "${DWS_PROFILE:-}")"
ENV_EXTRA+="$(plist_pair IM_BRIDGE_PROFILE "${IM_BRIDGE_PROFILE:-}")"
ENV_EXTRA+="$(plist_pair DINGTALK_PROFILE "${DINGTALK_PROFILE:-}")"
ENV_EXTRA+="$(plist_pair IM_BRIDGE_SELF_OPEN_ID "${IM_BRIDGE_SELF_OPEN_ID:-}")"
ENV_EXTRA+="$(plist_pair DINGTALK_SELF_OPEN_ID "${DINGTALK_SELF_OPEN_ID:-}")"
ENV_EXTRA+="$(plist_pair IM_BRIDGE_WORKSPACE "${IM_BRIDGE_WORKSPACE:-}")"
ENV_EXTRA+="$(plist_pair DINGTALK_AGENT_MODEL "${DINGTALK_AGENT_MODEL:-}")"
ENV_EXTRA+="$(plist_pair IM_BRIDGE_AGENT_MODEL "${IM_BRIDGE_AGENT_MODEL:-}")"
ENV_EXTRA+="$(plist_pair DINGTALK_FULL_AUTO "${DINGTALK_FULL_AUTO:-}")"
ENV_EXTRA+="$(plist_pair CURSOR_AGENT_BIN "${CURSOR_AGENT_BIN:-}")"

cat > "$PLIST_DEST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${ROOT}/src/bridge.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${USER_BIN}:${NODE_BIN}:${DWS_BIN}:${CURSOR_BIN}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
${ENV_EXTRA}  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${OLD_LABEL}" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl start "${LABEL}" 2>/dev/null || true

echo "已安装并启动 ${LABEL}"
echo "  日志: ${LOG_DIR}/stderr.log"
echo "  停止: ${ROOT}/scripts/macos/uninstall.sh"
echo "  手动: node ${ROOT}/src/bridge.js"
