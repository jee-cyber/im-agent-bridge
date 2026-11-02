# 云交付项目本地仓库索引

> 工作区根默认是本仓库根。客户仓在别的总目录时，设置 `IM_BRIDGE_WORKSPACE`（例如 `E:\code`）。下面的相对路径都相对这个根。  
> 更新方式见文末「同步命令」；分支策略：**定制仓先 `dev`，再切远端 `jett/*`；若远端无 jett，则在最新 `dev` 上创建同名本地 jett 分支**；C# 产品仓用 `Sprint/release-*`。

## 雨润（yurun）

| 路径 | 远端用途 | 集成 `dev` | Jett 工作分支 | C# 产品分支 |
|------|----------|------------|---------------|-------------|
| `yurun/ai-workflow` | Spec / AI / 钉钉上下文 | ✅ | `jett/feature-dev` | — |
| `yurun/yurun-tms` | NetCore 定制 | ✅ | （无 jett，跟 dev） | — |
| `C#/quantum-scm/power-scm/scm-dip` | DIP 网关 / 发布 | ✅ | `jett/cusomer/feature-yurun` | — |
| `C#/quantum-scm/power-scm/scm.tms7` | TMS7 产品 | 仅 fetch | — | `Sprint/release-227-yurun` |
| `C#/quantum-scm/power-scm/scm.contract` | Contract 产品 | 仅 fetch | — | `Sprint/release-227-yurun` |

## 明泰（hnmtly）

| 路径 | 集成 `dev` | Jett 工作分支 | C# 产品分支 |
|------|------------|---------------|-------------|
| `hnmtly/ai-workflow` | ✅ | `jett/sprint229/feature-dev` | — |
| `hnmtly/hnmtly-configration` | ✅ | `jett/feature-dev`（无 sprint229 时用） | — |
| `hnmtly/hnmtly-wms` | ✅ | `jett/sprint229/feature-dev` | — |
| `hnmtly/hnmtly-tms` | ✅ | `jett/sprint229/feature-dev` | — |
| `hnmtly/hnmtly-wx-app` | ✅ | `jett/feature-dev` | — |
| `hnmtly/hnmtly-oms` | ✅ | `jett/feature-dev`（远端无则本地从 dev 创建） | — |
| `hnmtly/hnmtly-ams` | ✅ | `jett/sprint229/feature-dev`（远端无则本地从 dev 创建） | — |
| `hnmtly/hnmtly-thirdparty` | ✅ | `jett/sprint228/feature-dev` | — |
| `hnmtly/scm.wms7` | fetch | — | `Sprint/release-226-hnmtly` |

## 大众 / 上汽 SQDZ（sqdz）

| 路径 | 集成 `dev` | Jett 工作分支 | C# 产品分支 |
|------|------------|---------------|-------------|
| `sqdz/scm-cloud` | ✅ | `jett/sprint228/feature-dev` | — |
| `sqdz/sqdzout-tms-java` | ✅ | `jett/spring225/feature-dev`（远端拼写） | — |
| `sqdz/sqdzout-tms-web` | ✅ | （跟 dev） | — |
| `sqdz/sqdzout-configration-java` | ✅ | `jett/sprint225/feature-dev` | — |
| `sqdz/sqdzout-configration-web` | ✅ | （跟 dev） | — |
| `sqdz/sqdzin-configration-java` | 按需 | 需求分支 `jett/sprint223/*` | — |
| `sqdz/sqdzin-configration-web` | ✅ | `jett/sprint228/feature-dev` | — |
| `sqdz/doc` | 文档仓 | 按需求 RQ 分支 | — |
| `C#/quantum-scm/power-scm/scm.tms7` | — | — | `Sprint/release-221-sqdz` |
| `C#/quantum-scm/power-scm/scm.contract` | — | — | `Sprint/release-221-sqdz` |

## 同步脚本

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File E:\code\.cursor\scripts\sync-customer-repos.ps1
```

## 答疑 / DIP 常用检索

- 雨润 DIP：`scm-dip`、`yurun/ai-workflow/docs`、`yurun/ai-workflow/.spec-workflow/specs`
- 雨润 TMS 定制：`yurun/yurun-tms` + 产品 `scm.tms7` @ `Sprint/release-227-yurun`
- 明泰：`hnmtly/ai-workflow/.spec-workflow/specs` + `hnmtly-wms` / `hnmtly-tms`
- 大众 Outbound：`sqdz/doc` + `sqdzout-tms-java` + 产品 `Sprint/release-221-sqdz`
