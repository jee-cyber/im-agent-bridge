# IM → Agent 桥

钉钉 **@我 / 单聊** → 本机 **dws 监听** → 按 profile 分流 → 工单队列 → **本机 Agent** → 结果回钉钉。

管道与具体 IDE 无关。当前执行器是 Cursor Agent，业务规则在 `profiles/`，不写进 `src/`。

## 布局

| 路径 | 内容 |
|------|------|
| `src/` | 桥接、路由、门禁、IM 适配 |
| `profiles/` | 业务配置。未设置环境变量时用 `yurun-tms.json` |
| `data/` | inbox / state / media / 回执（不提交） |
| `.cursor/hooks/` | Cursor 的 sessionStart / stop 薄入口 |
| `scripts/macos` `scripts/windows` | 安装、状态、卸载 |
| `docs/AGENT-PROMPTS.md` | Agent 按 phase 执行的说明 |

换一套业务：复制 `profiles/default.json` 为 `profiles/local.json`，或设置 `IM_BRIDGE_PROFILE`。

## 安装

1. 把本仓库放在工作区根，或用 `IM_BRIDGE_WORKSPACE` 指向客户仓所在的总目录。
2. 复制 `.cursor/hooks.json.example` 为 `.cursor/hooks.json`。

### macOS

```bash
export DINGTALK_SELF_OPEN_ID="<你的 openDingTalkId>"
export DWS_PROFILE=""
chmod +x scripts/macos/*.sh
scripts/macos/install.sh
```

`IM_BRIDGE_SELF_OPEN_ID` 与 `DINGTALK_SELF_OPEN_ID` 等价，前者优先。

### Windows

见 [docs/WINDOWS.md](docs/WINDOWS.md)。

```powershell
cd scripts\windows
Copy-Item env.example.ps1 env.local.ps1
.\install.ps1
```

## 环境变量

| 变量 | 含义 |
|------|------|
| `IM_BRIDGE_SELF_OPEN_ID` / `DINGTALK_SELF_OPEN_ID` | 必填，过滤自己的消息 |
| `IM_BRIDGE_PROFILE` | profile 名，默认 `yurun-tms` |
| `IM_BRIDGE_WORKSPACE` | Agent 工作区根，默认本仓库根 |
| `IM_BRIDGE_FULL_AUTO` / `DINGTALK_FULL_AUTO` | `0` 关闭后台 Agent |
| `IM_BRIDGE_GATE_DEPT` / `DINGTALK_GATE_CLOUD_DEPT` | `0` 关闭部门门禁 |
| `IM_BRIDGE_GATE_WORK` / `DINGTALK_GATE_WORK` | `0` 关闭业务门禁 |
| `IM_BRIDGE_GATE_LINKS` / `DINGTALK_GATE_LINKS` | `0` 关闭链接门禁 |
| `DINGTALK_REPLY_DEPT` | 部门名子串，覆盖 profile |
| `DINGTALK_AGENT_MODEL` | 默认 `composer-2.5` |
| `CURSOR_AGENT_BIN` / `CURSOR_API_KEY` | Agent 可执行文件或 API Key |
| `DWS_PROFILE` | dws profile |

## 安全

不要提交 `data/`、`profiles/local.json`、`scripts/windows/env.local.ps1`。E2E 从环境变量读 openDingTalkId，不要写进源码。

## License

MIT
