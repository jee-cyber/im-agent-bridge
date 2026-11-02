# 前台或计划任务入口：加载 env.local.ps1 后启动 bridge.js
$ErrorActionPreference = "Stop"
$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $BridgeDir "..\..\..")).Path
$HooksDir = Join-Path $Root ".cursor\hooks"

$localEnv = Join-Path $BridgeDir "env.local.ps1"
if (Test-Path $localEnv) {
  . $localEnv
}

if (-not $env:DINGTALK_SELF_OPEN_ID) {
  Write-Error "请复制 env.local.example.ps1 为 env.local.ps1 并设置 DINGTALK_SELF_OPEN_ID"
}

# 计划任务/新登录会话的 PATH 常缺少 npm 全局 bin、用户 bin，bridge 内 spawn('dws') 会因此失败
function Add-PathPrefixIfExists([string]$Dir) {
  if ($Dir -and (Test-Path -LiteralPath $Dir) -and ($env:Path -notlike "*$Dir*")) {
    $env:Path = "$Dir;$env:Path"
  }
}
try {
  $npmGlobal = & npm prefix -g 2>$null
  Add-PathPrefixIfExists $npmGlobal
} catch {
  # npm 不可用时仍尝试用当前 PATH 启动
}
Add-PathPrefixIfExists (Join-Path $env:USERPROFILE "bin")
Add-PathPrefixIfExists (Join-Path $env:LOCALAPPDATA "Programs\cursor\resources\app\bin")

Add-PathPrefixIfExists (Join-Path $env:LOCALAPPDATA "cursor-agent")
# 官方安装：%LOCALAPPDATA%\cursor-agent\cursor-agent.cmd
$agentCmd = Join-Path $env:LOCALAPPDATA "cursor-agent\cursor-agent.cmd"
if (Test-Path $agentCmd) {
  $env:CURSOR_AGENT_BIN = $agentCmd
}

New-Item -ItemType Directory -Force -Path (Join-Path $BridgeDir "state") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $BridgeDir "inbox") | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $HooksDir "dingtalk-auto-reply.flag") | Out-Null

Set-Location $Root
$node = Get-Command node -ErrorAction Stop
& $node.Source (Join-Path $BridgeDir "bridge.js")
