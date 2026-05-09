# `myjob-staging` 下线前无损切换 Runbook

目标：在不影响现网的前提下，把 Cloudflare `myjob-staging` 的职责并入 `myjob`，然后安全下线重复项目。

适用范围：
- 主站前端（Cloudflare Pages）
- Supabase 双项目（staging/prod）
- 当前仓库分支流（`staging` -> `main`）

## 0. 成功标准

- `staging` 分支部署仅在 `myjob` 项目发生，且指向 staging Supabase
- `main` 分支部署仅在 `myjob` 项目发生，且指向 prod Supabase
- `myjob-staging` 下线后，测试与生产链接都可正常访问

## 1. 变更前准备（10 分钟）

1. 确认当前 `staging` 分支可正常构建（仓库内）
2. 在 Cloudflare `myjob` 项目中确认：
   - `Production branch = main`
   - `staging` 触发 Preview 部署（或你指定的测试机制）
3. 确认 `myjob` 项目的 `staging` 与 `production` 环境变量已分离
4. 暂不删除 `myjob-staging` 项目，先进入双跑阶段

## 2. 双跑阶段（建议至少 1 天）

双跑定义：`myjob` 和 `myjob-staging` 同时可用，但只把 `myjob` 视为“准正式流程入口”。

执行：
1. 推一次 `staging` 到远端，确认 `myjob` 测试链路正常
2. 推一次 `main` 到远端，确认 `myjob` 生产链路正常
3. 用验收清单跑一遍（见第 4 节）

如果双跑期内无问题，再进入下线步骤。

## 3. 正式下线 `myjob-staging`

1. 在 Cloudflare 将 `myjob-staging` 设置为只读观察（不再触发新部署）
2. 观察 24 小时无告警后删除 `myjob-staging` 项目
3. 在 `docs/ops/platform-inventory-zh.md` 将该条目标记为“已下线”

## 4. 30 分钟验收清单（必须逐项过）

## 4.1 测试链路（`staging`）

- [ ] `staging` 最新提交已在 `myjob` 项目成功部署
- [ ] 首页可打开
- [ ] 职位列表/详情可打开
- [ ] `/admin` 可访问并登录
- [ ] 关键 Supabase 读取无报错

## 4.2 生产链路（`main`）

- [ ] `main` 最新提交已在 `myjob` 项目成功部署
- [ ] 生产域名可打开
- [ ] 核心页面可访问
- [ ] 关键数据读取正常

## 4.3 后端能力

- [ ] staging Supabase Edge Functions 调用正常
- [ ] prod Supabase Edge Functions 调用正常
- [ ] staging/prod secrets 均存在且不混用

## 5. 回滚预案

如果出现异常，按以下顺序回滚：
1. 前端先回滚到 Cloudflare 上一个稳定部署
2. 必要时临时恢复 `myjob-staging` 的部署触发
3. 数据问题按 migration 回滚策略执行（先 staging，后 prod）

## 6. 常见故障与处理

- 现象：测试站读到生产数据  
  处理：检查 `VITE_SUPABASE_URL` 是否误填 prod URL

- 现象：webhook 在 staging/prod 行为不一致  
  处理：对比两个 Supabase 项目的 Edge Function secrets

- 现象：构建成功但页面空白  
  处理：检查 `VITE_SITE_URL`、路由与构建输出目录配置

