# myjob 统一环境控制面（Control Plane）

本文档用于统一管理 `GitHub`、`Cloudflare`、`Supabase` 的项目、变量、发布与回滚流程，目标是减少项目数量、减少重复配置、避免环境串线。

## 1. 目标状态（Target State）

### 1.1 平台最小项目集

- GitHub：1 个主仓库（`myjob`）
- Supabase：2 个项目（`myjob-staging`、`myjob-prod`）
- Cloudflare Pages：2 个项目（`myjob`、`rmc`）

说明：
- `myjob`：主站，承担 staging/main 双分支发布。
- `rmc`：简历库独立站（若未来并入主站子路径，可再收敛为 1 个 Pages 项目）。
- Supabase 维持 2 套项目是为了测试与线上隔离，避免误写生产。

### 1.2 分支与发布标准

- `staging` 分支：测试环境发布入口
- `main` 分支：生产环境发布入口
- 功能与修复默认在 `staging`，验收通过后合并至 `main`

### 1.3 迁移与数据标准

- 数据库结构唯一来源：`supabase/migrations/`
- 应用顺序：`staging` 先执行 -> `prod` 后执行
- 禁止在生产库手改结构且不回写 migration

## 2. 当前状态盘点（来自 2026-05-09）

## 2.1 GitHub

- 发现仓库：`myjob`、`RMC`
- 建议：以 `myjob` 为唯一主仓库；`RMC` 代码逐步并入 `myjob`（保留历史可通过镜像备份）

## 2.2 Supabase

- `myjob-staging`：测试库（已存在）
- `yangkeer58tc-debug's Project`：当前生产库（建议重命名为 `myjob-prod`，避免误操作）
- Edge Functions 现状：`whatsapp-webhook`、`airwallex-create-checkout`（staging 已见），生产含 `whatsapp-webhook`

## 2.3 Cloudflare Pages

- `myjob-staging`
- `myjob`
- `rmc`

建议收敛：
- 删除 `myjob-staging`（在 `myjob` 项目里用分支和环境完成测试/生产双通道）
- `rmc` 暂保留（后续按业务决定是否并入）

## 3. 变量治理（单一控制面）

## 3.1 命名规范

- 前端公开变量统一以 `VITE_` 开头
- 服务端秘密变量（Supabase Edge Functions / Cloudflare Secrets）不使用 `VITE_`
- 环境后缀采用 `_STAGING` / `_PROD`（仅在聚合清单层，不强行改平台变量名）

## 3.2 变量分层

- Layer A（前端公开）：
  - `VITE_SITE_URL`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - 可选：`VITE_RESUMES_*`
- Layer B（服务端秘密）：
  - Supabase: `RMC_SERVICE_ROLE_KEY` 等
  - Cloudflare: `LLM_API_KEY`、`AIRWALLEX_API_KEY`、`INFOBIP_API_KEY` 等

## 3.3 真相来源（Source of Truth）

- 仓库中的模板文件：`.env.staging.example`、`env.production.example`
- 运维矩阵文档：`docs/ops/platform-inventory-zh.md`
- 检查脚本：`npm run env:validate:staging`

## 4. 标准运行手册（Runbook）

## 4.1 发布流程

1. 在 `staging` 开发并合并
2. 自动/手动触发 Cloudflare 测试部署
3. 执行 smoke test（首页、职位页、admin、关键 webhook）
4. 合并到 `main`
5. 触发生产部署并复核

## 4.2 Supabase 结构发布

1. 在本地新增 migration（`supabase/migrations/`）
2. 先应用到 `myjob-staging`
3. 验证通过后再应用到 `myjob-prod`

## 4.3 回滚

- 前端：回滚至前一个 Cloudflare 构建版本
- 数据：优先用可逆 migration；若不可逆，按备份恢复预案

## 5. 收敛路线图（建议执行顺序）

1. 完成资产盘点并确认“保留/废弃”
2. 固化环境变量矩阵（逐项核对）
3. 将 `myjob-staging` 的职责并入 `myjob` 项目
4. 统一 `staging/main` 发布流程
5. 将 RMC 开发入口收敛到 `myjob` 仓库

## 6. 分工（谁做什么）

你负责（控制台权限动作）：
- Cloudflare Pages 项目保留/删除
- Supabase 项目重命名与密钥轮换
- GitHub 仓库可见性、归档/迁移策略确认

我负责（仓库内工程治理）：
- 文档与运行手册固化
- 环境变量检查脚本与流程标准化
- 后续 RMC 代码并入 `myjob` 的技术落地

