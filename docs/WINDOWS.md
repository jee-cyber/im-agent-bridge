# Windows 部署方案

在 Windows 上跑与 macOS 相同的链路：**dws 监听 → bridge 入队 → cursor-agent FULL_AUTO → pending-reply 回钉钉**。

## 前置条件

| 组件 | 说明 |
|------|------|
| Node.js 18+ | `node -v`，安装时勾选加入 PATH |
| 钉钉 DWS | 安装 CLI 后 `dws auth login` |
| Cursor + cursor-agent | 本机已登录 Cursor；CLI 用 `install-cursor-agent.ps1` 或官方安装器 |
| 项目根 | clone 本仓后，把业务仓库放在**同一项目根**（`.cursor` 与代码同级） |

## 目录与日志

| 路径 | 用途 |
|------|------|
| `data/inbox/` | 工单 JSON（勿提交） |
| `data/state/` | 会话、门禁缓存 |
| `%LOCALAPPDATA%\im-agent-bridge\logs\` | `agent-<jobId>.log` |

## 安装步骤（推荐）

在 **PowerShell** 中（项目根 = 含 `.cursor` 的目录）：

```powershell
cd scripts\windows
Copy-Item env.example.ps1 env.local.ps1
# 编辑 env.local.ps1：$env:DINGTALK_SELF_OPEN_ID = "你的openId"

# 可选：安装 cursor-agent
.\install-agent.ps1
cursor-agent login
# 或 NO_OPEN_BROWSER=1 cursor-agent login 后浏览器完成授权

# 注册登录自启计划任务
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\install.ps1
.\status.ps1
```

前台调试（看实时 stderr）：

```powershell
.\start.ps1
```

卸载：

```powershell
.\uninstall.ps1
```

## 与 macOS 差异

| 项 | macOS | Windows |
|----|--------|---------|
| 常驻 | LaunchAgent `scripts/macos/install.sh` | 计划任务 `scripts/windows/install.ps1` |
| 环境变量 | shell / plist | `scripts/windows/env.local.ps1` |
| 日志 | `~/Library/Logs/im-agent-bridge` | `%LOCALAPPDATA%\im-agent-bridge\logs` |
| cursor-agent | `scripts/macos/install-agent.sh` | `scripts/windows/install-agent.ps1` |

## 门禁策略（与 mac 一致）

默认仅 **部门名含 `云交付`**（可改 `DINGTALK_REPLY_DEPT`）且 **工作/需求/DIP 类** 才回复；闲聊静默。在 `env.local.ps1` 中：

```powershell
$env:DINGTALK_GATE_CLOUD_DEPT = "0"  # 关闭部门门禁
$env:DINGTALK_GATE_WORK = "0"        # 关闭工作类门禁
```

## cursor-agent 登录常见问题

1. 浏览器授权后终端无反应：保持终端不关；试 `NO_OPEN_BROWSER=1 cursor-agent login` 用 Chrome 打开链接；或终端按 `q` 扫 QR。
2. `Error: [unavailable]`：检查公司代理/VPN；或在 Cursor 设置创建 **API Key**，写入 `env.local.ps1` 的 `CURSOR_API_KEY`。
3. 计划任务环境 PATH 不全：在 `env.local.ps1` 里显式设置 `CURSOR_AGENT_BIN` 为 `cursor-agent.exe` 全路径。

## Cursor hooks

Windows 上 Cursor 仍读取项目 `.cursor/hooks.json`（从 `hooks.json.example` 合并）。`sessionStart` / `stop` 负责注入工单与发送 `pending-reply.json`。

## 安全

- 勿提交 `env.local.ps1`、`inbox/`、`state/`、API Key。
- 睡眠/锁屏/断网期间 dws 可能丢事件；恢复后需 bridge 进程在跑。
