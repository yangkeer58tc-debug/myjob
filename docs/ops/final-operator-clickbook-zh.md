# 最终人工操作手册（超详细逐步版）

适用对象：你本人（单人运维）  
执行原则：只做“这里写到的动作”，每完成一步立刻打勾，不跳步。

---

## 0. 执行前准备（5 分钟）

- [ ] 打开并保持这 4 个文档可见：
  - `docs/ops/final-operator-actions-zh.md`
  - `docs/ops/final-operator-clickbook-zh.md`（本文）
  - `docs/ops/platform-inventory-zh.md`
  - `docs/ops/myjob-staging-decommission-runbook-zh.md`
- [ ] 确认当前代码已经在 `staging` 远端最新（本步骤你无需再改代码）
- [ ] 准备好 3 个后台页面并登录：
  - Cloudflare Dashboard
  - Supabase Dashboard
  - GitHub 仓库页面

---

## 1. Supabase 操作（先做）

目标：明确 staging/prod 两套数据环境，避免误连库。

## 1.1 把生产项目重命名为 `myjob-prod`

1. 进入 Supabase Dashboard。
2. 打开当前生产项目（现在名字是默认名）。
3. 进入 `Settings -> General`。
4. 找到项目名称，改为 `myjob-prod`。
5. 点击保存。
6. 回到项目列表，确认现在有且只有：
   - `myjob-staging`
   - `myjob-prod`

验收：
- [ ] 项目名已更新且可见
- [ ] `project ref` 未变化（改名不应改 ref）

## 1.2 核对 API 基础信息（记录但不泄露）

对 `myjob-staging` 与 `myjob-prod` 分别执行：

1. 进入 `Settings -> API`。
2. 记录（不要发到聊天里明文）：
   - Project URL
   - anon key
3. 将来源关系写进 `docs/ops/platform-inventory-zh.md` 的“备注”与“最后核对时间”列（可先写日期）。

验收：
- [ ] staging URL/anon 已确认
- [ ] prod URL/anon 已确认

## 1.3 核对 Edge Functions 与 Secrets（两项目都做）

对两个项目分别进入：

1. `Edge Functions -> Functions`  
   - 确认关键函数存在（如 `whatsapp-webhook`、`airwallex-create-checkout`，以你项目现状为准）。
2. `Edge Functions -> Secrets`  
   - 检查关键 secret 名称是否齐全（不需要看具体值）。

建议检查的关键 secret 名：
- `INFOBIP_BASE_URL`
- `INFOBIP_API_KEY`
- `INFOBIP_SENDER`
- `RMC_SUPABASE_URL`（或你当前命名）
- `RMC_SERVICE_ROLE_KEY`
- `RMC_AI_EXTRACT_URL`
- `AIRWALLEX_*`（如果该项目有支付流）

验收：
- [ ] staging secrets 名称完整
- [ ] prod secrets 名称完整
- [ ] 名称差异已记录并解释

---

## 2. Cloudflare 操作（核心）

目标：让 `myjob` 单项目承接测试与生产，减少重复项目。

## 2.1 在 `myjob` 项目配置 Staging 变量

1. 进入 `Workers & Pages -> myjob -> Settings -> Variables and Secrets`。
2. 选择/切换到 **Preview / staging 对应环境**（按你控制台显示）。
3. 设置以下变量：
   - `VITE_SITE_URL` = staging 域名
   - `VITE_SUPABASE_URL` = `myjob-staging` 的 URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `myjob-staging` 的 anon key
4. 启用 RMC 管理时再加（你现在建议直接加上）：
   - `VITE_ENABLE_RESUME_ADMIN=true`
   - `VITE_RESUMES_SUPABASE_URL` = 简历数据源 URL（按你目标）
   - `VITE_RESUMES_SUPABASE_ANON_KEY`
   - `VITE_RESUMES_PUBLIC_VIEW=public_candidates`（如你自定义视图名则填自定义）
5. 点击保存。

验收：
- [ ] `VITE_SITE_URL` 指向测试域
- [ ] staging Supabase 变量指向 `myjob-staging`
- [ ] `VITE_ENABLE_RESUME_ADMIN=true` 已生效

## 2.2 在 `myjob` 项目配置 Production 变量

同路径，切到 **Production 环境**：

必配：
- `VITE_SITE_URL` = 正式域名
- `VITE_SUPABASE_URL` = `myjob-prod` URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` = `myjob-prod` anon key

RMC 管理开关（建议与 staging 保持一致）：
- `VITE_ENABLE_RESUME_ADMIN=true`
- `VITE_RESUMES_SUPABASE_URL`
- `VITE_RESUMES_SUPABASE_ANON_KEY`
- `VITE_RESUMES_PUBLIC_VIEW`

验收：
- [ ] production Supabase 变量指向 `myjob-prod`
- [ ] 与 staging 没有混填

## 2.3 触发部署并看构建

1. 在 `Deployments` 页面触发一次 `staging` 分支部署（Preview 或你设定的测试入口）。
2. 等部署完成，访问测试 URL：
   - `/`
   - `/admin`
   - `/admin/resumes`
3. 再触发一次 `main` 分支部署（生产）。
4. 访问生产 URL 做同样检查。

验收：
- [ ] staging 页面打开正常
- [ ] staging `/admin/resumes` 可见并可用
- [ ] production 页面打开正常
- [ ] production `/admin/resumes` 可见并可用

---

## 3. 本地/CI 一键检查（你点击前最后跑一次）

在仓库根目录执行（如果你用终端）：

1. `npm run env:validate:staging`
2. `npm run env:validate:prod`
3. `npm run env:check:resume-admin`
4. `npm run precutover:resumes`
5. `GIT_BRANCH=staging npm run predeploy:staging`
6. `GIT_BRANCH=main npm run predeploy:prod`

判定规则：
- 任意命令失败：停止上线动作，先修复失败项再继续。

验收：
- [ ] 6 条命令全部成功

---

## 4. GitHub 操作（仓库收敛）

目标：`myjob` 成为唯一主开发仓库，`RMC` 进入只读/归档策略。

## 4.1 保持 `myjob` 为主仓库

1. 打开 `myjob` 仓库。
2. 检查默认分支（可保留 main）。
3. 确认日常开发走 `staging -> main`。

验收：
- [ ] 团队（你自己）后续只在 `myjob` 提交功能开发

## 4.2 处理 `RMC` 仓库

阶段性建议：
1. 先改为“只读维护”（不再新增功能）。
2. 观察 1-2 周无新增依赖后，再归档仓库。

验收：
- [ ] `RMC` 状态已在 `platform-inventory` 标记更新

---

## 5. 下线 `myjob-staging` Pages 项目（最后做）

前提：
- `myjob` 单项目已经稳定承接测试/生产至少 24 小时
- 没有关键告警

步骤：
1. 进入 `myjob-staging` 项目。
2. 关闭自动部署（或停止使用该项目作为入口）。
3. 观察 24 小时。
4. 确认无回滚需求后删除项目。

验收：
- [ ] `myjob-staging` 已停止使用
- [ ] 删除动作完成
- [ ] `platform-inventory` 已更新状态为“已下线”

---

## 6. 结束后你要回报给我的 8 条结果（我用于最终封板）

请按下面格式发我（不用发密钥值）：

1. `Supabase`: 已改名为 `myjob-prod`（是/否）
2. `Cloudflare-staging`: `VITE_SUPABASE_URL` 指向 `myjob-staging`（是/否）
3. `Cloudflare-prod`: `VITE_SUPABASE_URL` 指向 `myjob-prod`（是/否）
4. `ResumeAdmin`: `VITE_ENABLE_RESUME_ADMIN=true`（是/否）
5. `/admin/resumes` staging 可访问（是/否）
6. `/admin/resumes` production 可访问（是/否）
7. `myjob-staging` 项目状态（在用/停用/已删）
8. `RMC` 仓库状态（正常/只读/已归档）

---

## 7. 常见错误与马上修复

- 现象：测试站读到生产数据  
  修复：Cloudflare staging 的 `VITE_SUPABASE_URL` 配错，改回 `myjob-staging`。

- 现象：`/admin/resumes` 显示未配置  
  修复：缺少 `VITE_RESUMES_SUPABASE_URL` 或 `VITE_RESUMES_SUPABASE_ANON_KEY`。

- 现象：构建通过但页面异常  
  修复：先跑 `npm run precutover:resumes` 看是否有测试/环境检查失败。

