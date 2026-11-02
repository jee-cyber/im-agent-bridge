#!/usr/bin/env bash
# 绕过 root 拥有的 ~/.local，安装到 ~/.cursor/cursor-agent
set -euo pipefail

VERSION="2026.10.22-27dcf5f"
URL="https://downloads.cursor.com/lab/${VERSION}/darwin/arm64/agent-cli-package.tar.gz"
ROOT="${HOME}/.cursor/cursor-agent"
VERSION_DIR="${ROOT}/versions/${VERSION}"
BIN="${HOME}/bin/cursor-agent"

echo "安装目录: ${VERSION_DIR}"
mkdir -p "${ROOT}/versions"
rm -rf "${ROOT}/versions/.tmp-install"
mkdir -p "${ROOT}/versions/.tmp-install"

echo "下载 ${URL} ..."
curl -fL --retry 3 -o "${ROOT}/versions/.tmp-install/pkg.tar.gz" "${URL}"
tar --strip-components=1 -xzf "${ROOT}/versions/.tmp-install/pkg.tar.gz" -C "${ROOT}/versions/.tmp-install"
rm -f "${ROOT}/versions/.tmp-install/pkg.tar.gz"

rm -rf "${VERSION_DIR}"
mv "${ROOT}/versions/.tmp-install" "${VERSION_DIR}"

mkdir -p "${HOME}/bin"
ln -sf "${VERSION_DIR}/cursor-agent" "${BIN}"
ln -sf "${VERSION_DIR}/cursor-agent" "${HOME}/bin/agent"

echo "OK: ${BIN}"
"${BIN}" --version 2>/dev/null || "${BIN}" version 2>/dev/null || true
echo ""
echo "请确保 PATH 含 ~/bin，例如在 ~/.zshrc 加: export PATH=\"\$HOME/bin:\$PATH\""
echo "钉钉 bridge 已会探测: ${BIN}"
