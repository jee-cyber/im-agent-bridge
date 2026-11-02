# 钉钉工单 → Cursor Agent 指令

bridge 写入 `inbox/<jobId>.json` 与 `dingtalk-agent-wake.flag` 后，由 `sessionStart` 注入或你手动开 Agent。按 `phase` 执行。

## 入站路由（bridge 本地规则）

云交付 @/单聊：**仅 `AUTO_AGENT` 会钉钉回复并唤醒开发助手**；`LIGHT_REPLY` / `CLARIFY` 与部门门禁拦截一样 **静默不回复**。  
**支持三项目**：雨润（YJ2RQ/DIP）、明泰 hnmtly、上汽大众 SQDZ（RQ 编号/Outbound 等）；job 含 `project` / `workflowRel` 指向对应 ai-workflow 或代码仓。

## 通用

- 挂载 Skills 见 job 的 `skills` 字段。
- 回复提问者：结果写入 `.cursor/hooks/dingtalk-im-bridge/pending-reply.json`（stop 钩子或 bridge 发送）。
- 新功能：**群聊允许自动编码**；**仅复杂澄清**改单聊（见 `planClarifyDelivery` / `complexClarify`）。
- 密钥、SSID、口令不进 Git、不进钉钉明文。

## SPEC_BOOTSTRAP（新功能）

1. 读 `job.messages` 作为 `00_1.原始需求.md` 来源；若条目含 `images`（相对 ai-workflow 路径），用 Read 工具查看截图/OCR 后再写需求。
2. 目录 `job.specDir`：`requirements.md`、`design.md`、`tasks.md`、`00_2.需求疑点与答疑.md`。
3. 流程：`yurun-fullflow` S1–S3 + `yurun-req-practice`（过滤待确认后再问提问者）。
4. 澄清写入 `pending-reply.json`：

```json
{
  "jobId": "<同 job>",
  "questions": ["...", "..."],
  "complexClarify": false,
  "body": "可选整段 Markdown"
}
```

- 问题 ≥3 条或口径/权限/范围争议 → `complexClarify: true`（bridge 会在群里一句说明后改私信）。
5. 若无阻塞澄清且信息够：`pending-reply.json` 设 `"nextPhase":"READY_CODE"`（stop 钩子自动续跑编码）。

## CLARIFY

1. 合并提问者新消息到 `00_2` 与 `design.md`。
2. 仍缺阻塞项 → 更新 `pending-reply.json` 再问（复杂仍单聊）。
3. 澄清完成或提问者说「按假设先做」→ `pending-reply.json` 里 `"nextPhase":"READY_CODE"`（无需手建 flag）。

## READY_CODE

1. `scm-flow-implement` + NetCore Skills，代码写 `yurun-tms`。
2. 更新 `tasks.md` 状态；**不自动 push**（除非用户另行要求）。
3. `pending-reply.json` 示例：

```json
{
  "jobId": "<同 job>",
  "body": "【YJ2RQ…】已编码：Spec … 分支 … 改动 …",
  "completeJob": true
}
```

## CODE_LOOKUP

1. 在 **雨润** 工作区查代码：`yurun-tms` + 产品 `scm.tms7`（`Sprint/release-227-yurun`），必要时 `scm-dip`。
2. 回答顾问：菜单/接口/Service 职责、关键分支，**不要**改明泰/sqdz 仓库除非 job 明确要求。
3. 结论写入 `pending-reply.json` 的 `body`（口语、可发钉钉）。

## DIP_RUN

1. `yurun-dip-publish`：区分 S4 / ECC。
2. 模拟成功后再与用户确认是否 `enable`（默认不自动 enable）。
3. 回执写 `pending-reply.json`。
