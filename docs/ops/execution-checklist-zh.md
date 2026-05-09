# 执行清单（你做 / 我做）

本清单按“先收口配置，再收口项目”原则执行。

## 阶段 A：先把流程跑顺（不删任何项目）

### 你做（控制台）

- [ ] 在 Supabase 把生产项目重命名为 `myjob-prod`（仅改名，ID 不变）
- [ ] 确认 `myjob-staging` 与 `myjob-prod` 都可访问 `Edge Functions` 和 `Secrets`
- [ ] 在 Cloudflare `myjob` 项目中明确：
  - [ ] `staging` 分支作为测试入口
  - [ ] `main` 分支作为生产入口
- [ ] 核对 `myjob` 项目中的 production/staging 变量是否分别指向正确的 Supabase

### 我做（仓库）

- [x] 建立控制面总文档：`docs/ops/environment-control-plane-zh.md`
- [x] 建立资产矩阵模板：`docs/ops/platform-inventory-zh.md`
- [x] 建立环境模板校验脚本：`scripts/env/validate-env-template.mjs`
- [x] 增加环境校验命令：`npm run env:validate:staging` / `npm run env:validate:prod`
- [x] 增加发布前门禁脚本：`npm run predeploy:staging` / `npm run predeploy:prod`

## 阶段 B：收敛重复项目

### 你做（控制台）

- [ ] 当 `myjob` 项目稳定承担测试/生产双通道后，下线 `myjob-staging` Pages 项目
- [ ] 决定 `rmc` 是否继续独立站点：
  - 保留独立：继续保留 `rmc` 项目
  - 并入主站：后续由我在 `myjob` 内实现路由/页面合并后再下线

### 我做（仓库）

- [x] 输出 RMC 并入 `myjob` 的目录方案与迁移步骤（先不破坏现网）
- [x] 增加发布前检查脚本（分支、关键变量、目标 URL）
- [ ] 补全统一发布 Runbook（含回滚）
- [x] 补充 `myjob-staging` 下线 Runbook：`docs/ops/myjob-staging-decommission-runbook-zh.md`
- [x] 补充 RMC 并入方案：`docs/ops/rmc-merge-into-myjob-plan-zh.md`
- [x] 落地 RMC 并入 Phase 1 骨架：`/admin` 新增 `Resumes` 页签（feature flag 控制）
- [x] 落地 Phase 1.5：`Resumes` 页签支持搜索、分页、详情，并提供 `/admin/resumes` 独立入口
- [x] 增加 Resume Admin 就绪检查：`npm run env:check:resume-admin`

## 阶段 C：安全收口

### 你做（控制台）

- [ ] 对截图中出现过的高敏密钥做轮换（Supabase/Cloudflare）
- [ ] 清理不再使用的历史 secret 与变量

### 我做（仓库）

- [ ] 将关键 secrets 清单固化为“存在性检查”脚本（不读取具体值）
- [ ] 增加每周 10 分钟例行核对项

