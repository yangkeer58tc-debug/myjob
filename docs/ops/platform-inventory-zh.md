# 平台资产与变量清单（手工维护）

用途：把多平台信息收敛到一张表，避免“到处找配置”。

维护规则：
- 任何新增变量，先写本文件，再去平台设置。
- 任何改值，必须同时更新本文件。
- 敏感值不写明文，仅记录“保管位置”和“最后更新时间”。

## 1. 资产清单

| 平台 | 类型 | 名称 | 环境 | 状态 | 备注 |
|---|---|---|---|---|---|
| GitHub | Repository | myjob | all | 保留 | 主仓库 |
| GitHub | Repository | RMC | all | 待收敛 | 后续并入 myjob |
| Supabase | Project | myjob-staging | staging | 保留 | 测试数据库 |
| Supabase | Project | myjob-prod（待重命名） | prod | 保留 | 当前显示为默认项目名 |
| Cloudflare | Pages | myjob | staging/prod | 保留 | 推荐承接双环境发布 |
| Cloudflare | Pages | myjob-staging | staging | 待下线 | 与 myjob 职责重复 |
| Cloudflare | Pages | rmc | prod | 暂保留 | 后续可评估并入 |

## 2. 环境变量矩阵（模板）

| 变量名 | 层级 | staging 来源 | prod 来源 | 敏感级别 | 最后核对时间 | 备注 |
|---|---|---|---|---|---|---|
| VITE_SITE_URL | 前端公开 | Cloudflare/myjob(staging) | Cloudflare/myjob(prod) | 低 |  |  |
| VITE_SUPABASE_URL | 前端公开 | Supabase/myjob-staging | Supabase/myjob-prod | 中 |  |  |
| VITE_SUPABASE_PUBLISHABLE_KEY | 前端公开 | Supabase/myjob-staging | Supabase/myjob-prod | 中 |  |  |
| VITE_RESUMES_SUPABASE_URL | 前端公开 | Cloudflare | Cloudflare | 中 |  | 若并库可移除 |
| VITE_RESUMES_SUPABASE_ANON_KEY | 前端公开 | Cloudflare | Cloudflare | 中 |  | 若并库可移除 |
| LLM_API_KEY | 服务端秘密 | Cloudflare Secret | Cloudflare Secret | 高 |  | 不可下发前端 |
| LLM_BASE_URL | 服务端秘密 | Cloudflare Secret | Cloudflare Secret | 中 |  |  |
| LLM_MODEL | 服务端秘密 | Cloudflare Secret | Cloudflare Secret | 低 |  |  |
| AIRWALLEX_API_KEY | 服务端秘密 | Supabase Function Secret | Supabase Function Secret | 高 |  |  |
| INFOBIP_API_KEY | 服务端秘密 | Supabase Function Secret | Supabase Function Secret | 高 |  |  |
| RMC_SERVICE_ROLE_KEY | 服务端秘密 | Supabase Function Secret | Supabase Function Secret | 高 |  |  |

## 3. 每周核对清单（10 分钟）

- `staging` 站点是否连到了 staging Supabase
- `main` 站点是否连到了 prod Supabase
- Cloudflare `myjob` 和 `myjob-staging` 是否存在重复变量
- Supabase Edge Functions Secrets 是否 staging/prod 对齐
- 是否有新变量未登记到本文件

