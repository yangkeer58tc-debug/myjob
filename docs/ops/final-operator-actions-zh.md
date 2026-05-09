# 最终一次性操作清单（你最后统一做）

你说要“最后一次性统一配置”，这里是最终执行顺序。按顺序做，风险最低。

## A. Cloudflare（先测试，再生产）

## A1 `myjob` 项目（staging）

必配：
- `VITE_SUPABASE_URL` -> staging Supabase URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` -> staging anon key
- `VITE_SITE_URL` -> staging 域名

可选（启用 RMC 管理）：
- `VITE_ENABLE_RESUME_ADMIN=true`
- `VITE_RESUMES_SUPABASE_URL`
- `VITE_RESUMES_SUPABASE_ANON_KEY`
- `VITE_RESUMES_PUBLIC_VIEW`（默认 `public_candidates`）

## A2 `myjob` 项目（production）

必配：
- `VITE_SUPABASE_URL` -> prod Supabase URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` -> prod anon key
- `VITE_SITE_URL` -> 正式域名

可选（启用 RMC 管理）：
- `VITE_ENABLE_RESUME_ADMIN=true`
- `VITE_RESUMES_SUPABASE_URL`
- `VITE_RESUMES_SUPABASE_ANON_KEY`
- `VITE_RESUMES_PUBLIC_VIEW`

## A3 发布前本地/CI检查（推荐）

- `npm run env:validate:staging`
- `npm run env:validate:prod`
- `npm run env:check:resume-admin`（仅在开启 `VITE_ENABLE_RESUME_ADMIN` 时强制检查）
- `GIT_BRANCH=staging npm run predeploy:staging`
- `GIT_BRANCH=main npm run predeploy:prod`

## B. Supabase（双项目对齐）

- 把当前生产项目重命名为 `myjob-prod`
- 确认 `myjob-staging`、`myjob-prod` 的 Edge Functions/Secrets 对齐
- 迁移执行顺序固定：staging -> prod

## C. GitHub（仓库收敛）

- 继续以 `myjob` 作为唯一主开发仓库
- `RMC` 进入只读维护，待并入完成后归档

## D. Cloudflare 项目收敛（最后再做）

前提：`myjob` 项目已稳定承接 staging/prod 双流程。

执行：
1. 停止 `myjob-staging` 新部署
2. 观察 24h
3. 删除 `myjob-staging`

`rmc` 项目先保留，直到你确认完全并入主站后再下线。

