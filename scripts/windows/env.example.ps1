# 复制为 env.local.ps1（已 gitignore），安装 Windows 计划任务前填写。
# 旧变量名 DINGTALK_* 仍然有效；同名 IM_BRIDGE_* 优先。

# 必填：你的 openDingTalkId（dws 身份）
$env:DINGTALK_SELF_OPEN_ID = ""
# $env:IM_BRIDGE_SELF_OPEN_ID = ""

# 业务配置。不设置时用 profiles/yurun-tms.json；空白示例：$env:IM_BRIDGE_PROFILE = "default"
# 客户仓不在本仓库根目录时，指到总工作区，例如 E:\code
# $env:IM_BRIDGE_WORKSPACE = "E:\code"

# 多 profile 时填写 dws --profile
# $env:DWS_PROFILE = "default"

# cursor-agent 登录失败时可改用 API Key（勿提交 Git）
# $env:CURSOR_API_KEY = ""

# 门禁：仅云交付相关部门可进入路由；未转开发助手（非 AUTO_AGENT）的消息不回复（单聊与群@我一致）
# 部门关键词，多个用逗号分隔（匹配通讯录 deptName / deptPathName）
$env:DINGTALK_REPLY_DEPT = "云交付"
# 关闭部门门禁：$env:DINGTALK_GATE_CLOUD_DEPT = "0"
# 关闭业务类门禁：$env:DINGTALK_GATE_WORK = "0"

# 消息含 http(s) 链接时：全部须为三项目相关域名/路径，否则静默（阿里云登录邀请等会拦）
# 关闭链接门禁：$env:DINGTALK_GATE_LINKS = "0"
# 追加白名单正则（竖线分隔）：$env:DINGTALK_ALLOWED_LINK_EXTRA = "my-git\.example\.com.*yurun"

# 可选：关闭 FULL_AUTO
# $env:DINGTALK_FULL_AUTO = "0"

# 自动化 Agent 模型（默认 Composer 2.5，与主窗口一致）
$env:DINGTALK_AGENT_MODEL = "composer-2.5"

# cursor-agent（FULL_AUTO）；安装：.\install-cursor-agent.ps1
# $env:CURSOR_AGENT_BIN = "$env:USERPROFILE\bin\cursor-agent.exe"

# dws MCP/HTTP 超时（秒），钉钉发消息偶发超时可调到 180～300
$env:DWS_HTTP_TIMEOUT_SEC = "180"
