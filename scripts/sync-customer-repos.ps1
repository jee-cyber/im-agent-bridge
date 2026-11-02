# 同步大众 / 明泰 / 雨润定制仓与 C# 产品分支（dev → jett / Sprint）
# 用法：pwsh -File sync-customer-repos.ps1
$ErrorActionPreference = 'Continue'
$LogRoot = Join-Path $env:LOCALAPPDATA 'im-agent-bridge\logs'
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$LogFile = Join-Path $LogRoot "repo-sync-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

function Write-Log([string]$Msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $Msg"
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line
}

function Sync-GitRepo {
  param(
    [string]$Path,
    [string]$DevBranch = 'dev',
    [string]$WorkBranch = '',
    [string]$WorkBranchFallback = '',
    [switch]$SkipDevPull
  )
  if (-not (Test-Path (Join-Path $Path '.git'))) {
    Write-Log "跳过（非 Git）：$Path"
    return
  }
  Push-Location $Path
  try {
    Write-Log ">>> $Path"
    git fetch origin --prune 2>&1 | Out-Null
    if (-not $SkipDevPull -and $DevBranch) {
      $hasDev = git rev-parse --verify "origin/$DevBranch" 2>$null
      if ($LASTEXITCODE -eq 0) {
        git checkout $DevBranch 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
          git pull origin $DevBranch 2>&1 | ForEach-Object { Write-Log "  dev: $_" }
          if ($LASTEXITCODE -ne 0) {
            Write-Log '  dev pull 失败，尝试 stash 后重试'
            git stash push -u -m 'sync-customer-repos-auto' 2>&1 | Out-Null
            git pull origin $DevBranch 2>&1 | ForEach-Object { Write-Log "  dev-retry: $_" }
          }
        }
      }
    }
    if ($WorkBranch) {
      $target = $WorkBranch
      $hasWork = git rev-parse --verify "origin/$target" 2>$null
      if ($LASTEXITCODE -ne 0 -and $WorkBranchFallback) {
        $target = $WorkBranchFallback
        $hasWork = git rev-parse --verify "origin/$target" 2>$null
      }
      if ($LASTEXITCODE -ne 0) {
        # 远端无 jett：先对齐 dev，再创建仅本地的 jett 分支（分支名仍用 WorkBranch）
        Write-Log "  远端无 jett，从 $DevBranch 创建本地 $WorkBranch"
        $hasDev = git rev-parse --verify "origin/$DevBranch" 2>$null
        if ($LASTEXITCODE -ne 0) {
          Write-Log "  失败：无 origin/$DevBranch，无法生成本地 jett"
        } else {
          git checkout $DevBranch 2>&1 | ForEach-Object { Write-Log "  dev-checkout: $_" }
          git pull origin $DevBranch 2>&1 | ForEach-Object { Write-Log "  dev-pull: $_" }
          if ($LASTEXITCODE -ne 0) {
            Write-Log '  dev pull 失败，stash 后重试'
            git stash push -u -m 'sync-customer-repos-auto' 2>&1 | Out-Null
            git pull origin $DevBranch 2>&1 | ForEach-Object { Write-Log "  dev-pull-retry: $_" }
          }
          git checkout -B $WorkBranch 2>&1 | ForEach-Object { Write-Log "  local-jett: $_" }
          Write-Log "  当前分支（本地 jett）：$(git branch --show-current) @ $(git rev-parse --short HEAD)"
        }
      } else {
        git checkout -B $target "origin/$target" 2>&1 | ForEach-Object { Write-Log "  checkout: $_" }
        git pull origin $target 2>&1 | ForEach-Object { Write-Log "  work: $_" }
        Write-Log "  当前分支：$(git branch --show-current) @ $(git rev-parse --short HEAD)"
      }
    }
  } catch {
    Write-Log "  失败：$($_.Exception.Message)"
  } finally {
    Pop-Location
  }
}

function Sync-ProductBranch {
  param([string]$Path, [string]$SprintBranch)
  if (-not (Test-Path (Join-Path $Path '.git'))) {
    Write-Log "跳过产品仓：$Path"
    return
  }
  Push-Location $Path
  try {
    Write-Log ">>> [产品] $Path -> $SprintBranch"
    git fetch origin --prune 2>&1 | Out-Null
    $has = git rev-parse --verify "origin/$SprintBranch" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Log "  警告：无 origin/$SprintBranch"
      return
    }
    git checkout -B $SprintBranch "origin/$SprintBranch" 2>&1 | Out-Null
    git pull origin $SprintBranch 2>&1 | ForEach-Object { Write-Log "  pull: $_" }
    Write-Log "  HEAD $(git rev-parse --short HEAD)"
  } finally {
    Pop-Location
  }
}

$DipPath = 'E:\code\C#\quantum-scm\power-scm\scm-dip'
if (-not (Test-Path (Join-Path $DipPath '.git'))) {
  Write-Log "克隆 scm-dip ..."
  New-Item -ItemType Directory -Force -Path (Split-Path $DipPath -Parent) | Out-Null
  git clone 'http://192.168.100.155/quantum-scm/power-scm/scm-dip.git' $DipPath 2>&1 | ForEach-Object { Write-Log $_ }
}

# 雨润
Sync-GitRepo -Path 'E:\code\yurun\ai-workflow' -WorkBranch 'jett/feature-dev'
Sync-GitRepo -Path 'E:\code\yurun\yurun-tms'
Sync-GitRepo -Path $DipPath -WorkBranch 'jett/cusomer/feature-yurun'

# 明泰
$hnJett = 'jett/sprint229/feature-dev'
Sync-GitRepo -Path 'E:\code\hnmtly\ai-workflow' -WorkBranch $hnJett
Sync-GitRepo -Path 'E:\code\hnmtly\hnmtly-configration' -WorkBranch $hnJett -WorkBranchFallback 'jett/feature-dev'
Sync-GitRepo -Path 'E:\code\hnmtly\hnmtly-wms' -WorkBranch $hnJett
Sync-GitRepo -Path 'E:\code\hnmtly\hnmtly-tms' -WorkBranch $hnJett
Sync-GitRepo -Path 'E:\code\hnmtly\hnmtly-ams' -WorkBranch $hnJett -WorkBranchFallback 'jett/sprint228/feature-dev'
Sync-GitRepo -Path 'E:\code\hnmtly\hnmtly-wx-app' -WorkBranch 'jett/feature-dev'
Sync-GitRepo -Path 'E:\code\hnmtly\hnmtly-oms' -WorkBranch 'jett/feature-dev'
Sync-GitRepo -Path 'E:\code\hnmtly\hnmtly-thirdparty' -WorkBranch 'jett/sprint228/feature-dev'

# 大众 sqdz
Sync-GitRepo -Path 'E:\code\sqdz\scm-cloud' -WorkBranch 'jett/sprint228/feature-dev'
# 远端分支名拼写为 spring225（非 sprint）
Sync-GitRepo -Path 'E:\code\sqdz\sqdzout-tms-java' -WorkBranch 'jett/spring225/feature-dev'
Sync-GitRepo -Path 'E:\code\sqdz\sqdzout-configration-java' -WorkBranch 'jett/sprint225/feature-dev'
Sync-GitRepo -Path 'E:\code\sqdz\sqdzin-configration-web' -WorkBranch 'jett/sprint228/feature-dev'
Sync-GitRepo -Path 'E:\code\sqdz\sqdzout-tms-web'
Sync-GitRepo -Path 'E:\code\sqdz\sqdzout-configration-web'
Sync-GitRepo -Path 'E:\code\sqdz\sqdzin-configration-java' -SkipDevPull

# C# 产品（Sprint/release-*）
$Tms7 = 'E:\code\C#\quantum-scm\power-scm\scm.tms7'
$Contract = 'E:\code\C#\quantum-scm\power-scm\scm.contract'
Sync-ProductBranch -Path $Tms7 -SprintBranch 'Sprint/release-227-yurun'
Sync-ProductBranch -Path $Contract -SprintBranch 'Sprint/release-227-yurun'
Sync-ProductBranch -Path 'E:\code\hnmtly\scm.wms7' -SprintBranch 'Sprint/release-226-hnmtly'

# 大众产品分支（scm.tms7 / contract 需切到 sqdz 后再切回 yurun 会冲突 — 使用独立 fetch 记录）
Write-Log '大众产品分支请在本机第二工作树或手动切换 scm.tms7 -> Sprint/release-221-sqdz'
Write-Log "完成。日志：$LogFile"
