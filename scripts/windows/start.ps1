# 前台或计划任务入口：加载 env.local.ps1 后启动 bridge
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

$localEnv = Join-Path $ScriptDir "env.local.ps1"
if (Test-Path $localEnv) {
  . $localEnv
}

if (-not $env:IM_BRIDGE_SELF_OPEN_ID -and -not $env:DINGTALK_SELF_OPEN_ID) {
  Write-Error "请复制 env.example.ps1 为 env.local.ps1，并设置 IM_BRIDGE_SELF_OPEN_ID 或 DINGTALK_SELF_OPEN_ID"
}

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
$agentCmd = Join-Path $env:LOCALAPPDATA "cursor-agent\cursor-agent.cmd"
if ((Test-Path $agentCmd) -and -not $env:CURSOR_AGENT_BIN) {
  $env:CURSOR_AGENT_BIN = $agentCmd
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\state") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\inbox") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\media") | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $Root "data\auto-reply.flag") | Out-Null

Set-Location $Root
$node = Get-Command node -ErrorAction Stop
& $node.Source (Join-Path $Root "src\bridge.js")
