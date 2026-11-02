# Cursor hooks

钩子只做两件事：会话开始时注入工单，停止时把回执发回钉钉。实现在 `src/`。

```bash
node src/bridge.js
```

安装：

```bash
chmod +x scripts/macos/*.sh
scripts/macos/install.sh
```

说明见仓库根 [README.md](../../README.md) 和 [docs/OPERATIONS.md](../../docs/OPERATIONS.md)。
