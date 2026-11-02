$ErrorActionPreference = "SilentlyContinue"
foreach ($TaskName in @("ImAgentBridge", "CursorDingtalkImBridge")) {
  Stop-ScheduledTask -TaskName $TaskName
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "已卸载计划任务 $TaskName（data/ 未删除）"
}
