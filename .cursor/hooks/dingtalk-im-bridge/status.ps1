$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $BridgeDir "..\..\..")).Path
$Inbox = Join-Path $BridgeDir "inbox"
$LogRoot = Join-Path $env:LOCALAPPDATA "cursor-dingtalk-bridge\logs"
$TaskName = "CursorDingtalkImBridge"

Write-Host "=== 计划任务 $TaskName ==="
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Format-List TaskName, State, LastRunTime, LastTaskResult

Write-Host "`n=== inbox 工单 ==="
if (Test-Path $Inbox) {
  Get-ChildItem $Inbox -ErrorAction SilentlyContinue
} else {
  Write-Host "无 inbox"
}

Write-Host "`n=== Agent 日志目录 ==="
Write-Host $LogRoot
if (Test-Path $LogRoot) {
  Get-ChildItem $LogRoot -Filter "agent-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name, LastWriteTime
} else {
  Write-Host "（目录尚未创建，跑过 FULL_AUTO 后会出现 agent-<jobId>.log）"
}
Write-Host "`n实时跟踪最新 Agent 日志:"
Write-Host "  & `"$(Join-Path $BridgeDir 'tail-agent-log.ps1')`""
