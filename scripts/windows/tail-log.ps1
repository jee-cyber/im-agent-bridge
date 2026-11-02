# 实时跟踪最新 cursor-agent FULL_AUTO 日志（无 agent-*.log 时给出友好提示）
param(
  [int]$Tail = 80
)

$LogRoot = Join-Path $env:LOCALAPPDATA "im-agent-bridge\logs"
if (-not (Test-Path -LiteralPath $LogRoot)) {
  $Legacy = Join-Path $env:LOCALAPPDATA "cursor-dingtalk-bridge\logs"
  if (Test-Path -LiteralPath $Legacy) { $LogRoot = $Legacy }
}

if (-not (Test-Path -LiteralPath $LogRoot)) {
  Write-Host "日志目录尚不存在: $LogRoot" -ForegroundColor Yellow
  Write-Host "说明：尚未产生 FULL_AUTO 日志；可先 @ 机器人触发一单，或查看桥接 stderr："
  Write-Host "  Get-Content `"$LogRoot\stderr.log`" -Wait -Tail $Tail"
  exit 1
}

$latest = Get-ChildItem -LiteralPath $LogRoot -Filter "agent-*.log" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $latest) {
  Write-Host "目录内暂无 agent-*.log: $LogRoot" -ForegroundColor Yellow
  Write-Host "可先触发 AUTO_AGENT 工单，或跟踪桥接日志："
  $stderr = Join-Path $LogRoot "stderr.log"
  if (Test-Path -LiteralPath $stderr) {
    Write-Host "  Get-Content `"$stderr`" -Wait -Tail $Tail" -ForegroundColor Cyan
    Get-Content -LiteralPath $stderr -Tail $Tail
  } else {
    Write-Host "  （stderr.log 也不存在，请确认计划任务 ImAgentBridge 已启动）"
  }
  exit 1
}

Write-Host "跟踪 Agent 日志: $($latest.FullName)" -ForegroundColor Cyan
Get-Content -LiteralPath $latest.FullName -Wait -Tail $Tail
