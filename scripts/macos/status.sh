#!/usr/bin/env bash
set -euo pipefail

LABEL="com.im-agent-bridge"
LOG_DIR="$HOME/Library/Logs/im-agent-bridge"
if [[ ! -d "$LOG_DIR" && -d "$HOME/Library/Logs/cursor-dingtalk-bridge" ]]; then
  LOG_DIR="$HOME/Library/Logs/cursor-dingtalk-bridge"
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INBOX="$ROOT/data/inbox"

echo "=== launchctl ==="
launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -20 || echo "未运行或未安装"

echo ""
echo "=== 最近日志 (stderr) ==="
if [[ -f "$LOG_DIR/stderr.log" ]]; then
  tail -n 15 "$LOG_DIR/stderr.log"
else
  echo "无日志"
fi

echo ""
echo "=== inbox 工单 ==="
if [[ -d "$INBOX" ]]; then
  ls -la "$INBOX" 2>/dev/null || echo "空"
else
  echo "无 inbox"
fi
