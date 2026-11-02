#!/usr/bin/env bash
set -euo pipefail

for LABEL in com.im-agent-bridge com.cursor.dingtalk-im-bridge; do
  PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST_DEST"
done
echo "已卸载常驻进程（data/ 未删除）"
