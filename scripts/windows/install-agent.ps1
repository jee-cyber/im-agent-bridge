# Windows x64：安装 cursor-agent 到 %USERPROFILE%\.cursor\cursor-agent
$ErrorActionPreference = "Stop"

$Version = "2026.10.22-27dcf5f"
$Url = "https://downloads.cursor.com/lab/$Version/windows/x64/agent-cli-package.tar.gz"
$Root = Join-Path $env:USERPROFILE ".cursor\cursor-agent"
$VersionDir = Join-Path $Root "versions\$Version"
$BinDir = Join-Path $env:USERPROFILE "bin"
$BinLink = Join-Path $BinDir "cursor-agent.exe"

New-Item -ItemType Directory -Force -Path (Join-Path $Root "versions") | Out-Null
$Tmp = Join-Path $Root "versions\.tmp-install"
if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

$TarGz = Join-Path $Tmp "pkg.tar.gz"
Write-Host "下载 $Url ..."
Invoke-WebRequest -Uri $Url -OutFile $TarGz -UseBasicParsing

# Windows 10+ 自带 tar
tar --strip-components=1 -xzf $TarGz -C $Tmp
Remove-Item $TarGz -Force

if (Test-Path $VersionDir) { Remove-Item -Recurse -Force $VersionDir }
Move-Item $Tmp $VersionDir

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$AgentExe = Join-Path $VersionDir "cursor-agent.exe"
Copy-Item -Force $AgentExe $BinLink

Write-Host "OK: $BinLink"
& $BinLink --version 2>$null
Write-Host ""
Write-Host "请将 $BinDir 加入用户 PATH，然后执行: cursor-agent login"
Write-Host "或设置 env.local.ps1 中的 CURSOR_API_KEY"
