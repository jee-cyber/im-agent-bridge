# 钉钉 IM 桥接

监听 **@我** 与 **单聊**，以你的 `dws` 身份 ack、分流、入队，并唤醒 Cursor Agent。

## 策略（当前）

| 项 | 行为 |
|----|------|
| 权限 | 仅本机你的钉钉 OAuth；回复 `--as user` |
| 门禁 | **群聊**仅 `@我`；提问者部门须含 `DINGTALK_REPLY_DEPT`（默认「云交付」），否则 **静默**；正文含 **http(s) 链接** 时须 **全部** 为三项目相关（内网 Git、`codeup` 上 di-ai-dip/三项目仓、钉钉文档等），否则 **静默**（`DINGTALK_GATE_LINKS=0` 可关）；云交付内仅 **`AUTO_AGENT` 入队** 才回复（`DINGTALK_GATE_CLOUD_DEPT=0` 可关部门门禁） |
| 新功能 | 缺 `YJ2RQ`/`RJ2RQ` 先索要；有编号 → Spec 落盘 → 澄清 → **自动编码** |
| 群聊 | **允许自动编码**（有编号即可入队） |
| 澄清 | 简单问题在原会话；**复杂**（≥3 问或 `complexClarify`）→ 单聊提问者 |
| DIP | 按项目 Skill 处理（如雨润 `yurun-dip-publish`） |

## macOS 一键安装（LaunchAgent）

```bash
cd /path/to/your-project-root
chmod +x .cursor/hooks/dingtalk-im-bridge/*.sh
export DINGTALK_SELF_OPEN_ID="你的openId"
.cursor/hooks/dingtalk-im-bridge/install.sh
```

```bash
.cursor/hooks/dingtalk-im-bridge/status.sh
.cursor/hooks/dingtalk-im-bridge/uninstall.sh
```

日志：`~/Library/Logs/cursor-dingtalk-bridge/`

## Windows

见仓库根目录 [docs/WINDOWS.md](../../../docs/WINDOWS.md)：`env.local.ps1` → `install-windows.ps1` → `status.ps1`。

日志：`%LOCALAPPDATA%\cursor-dingtalk-bridge\logs\`

## Cursor 衔接

| 文件 | 作用 |
|------|------|
| `inbox/<jobId>.json` | 工单状态（勿提交 Git） |
| `dingtalk-agent-wake.flag` | 新 Agent 会话注入（`sessionStart`） |
| `pending-reply.json` | Agent 写回执；`stop` 钩子发钉钉 |
| `dingtalk-auto-reply.flag` | 可选；无 pending 时也允许 stop 发钉钉 |

入队后 **FULL_AUTO（默认开）**：`run-auto-agent.js` → `cursor-agent --print` → `pending-reply.json` → 回钉钉。

Agent 指令见 [AGENT-PROMPTS.md](./AGENT-PROMPTS.md)。

## cursor-agent

- macOS：`install-cursor-agent.sh` → `~/bin/cursor-agent` → `cursor-agent login`
- Windows：`install-cursor-agent.ps1` → 用户 `bin\cursor-agent.exe` → `cursor-agent login`

可选：`CURSOR_API_KEY` 环境变量（计划任务 / LaunchAgent 需能读到）。

## 首次发送

`dws chat +messages-send` 可能需要本机确认一次；终端试发通过后 bridge 才能自动回。
