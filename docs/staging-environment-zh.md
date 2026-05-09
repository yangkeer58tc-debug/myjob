# 测试 / 预发布环境说明

目标：在不影响正式域名的前提下，先验证功能与数据，再合并到 `main` 上线。

> 统一治理入口：`docs/ops/environment-control-plane-zh.md`  
> 资产与变量矩阵：`docs/ops/platform-inventory-zh.md`

**与 Cursor 的约定（所有会话默认遵守）：** 见仓库根目录 `.cursor/rules/staging-first-workflow.mdc` — 功能与修复默认在 **`staging`** 分支开发并 `git push`；**只有**你明确说 **上线 / 合并到 main / 推到正式** 时，再合并到 `main`。

## 1. 本地模拟 Staging 构建

1. 复制环境模板：`cp .env.staging.example .env.staging`
2. 编辑 `.env.staging`，至少填写 `VITE_SITE_URL`、Supabase 等与 Staging 一致的变量。
3. 构建并本地预览：

```bash
npm run build:staging
npm run preview:staging
```

使用 `vite build --mode staging` 时，页面顶部会显示 **「测试环境」** 横条，便于和正式构建区分。

## 2. Cloudflare Pages 上的常见两种做法

### 方案 A：专用分支 + 第二个 Pages 项目（推荐）

1. 在 Git 中保留长期分支，例如 `staging`。
2. 在 Cloudflare Dashboard 再建一个 **Pages 项目**（例如 `myjob-staging`），连接同一仓库。
3. 将该项目的 **Production branch** 设为 `staging`（不是 `main`）。
4. 在该项目中配置 **环境变量**（与 `.env.staging.example` 同名），指向 Staging 的 `VITE_SITE_URL`、Supabase 等。
5. 工作流：功能在 `staging` 分支开发与合并 → Cloudflare 自动构建 Staging URL → 验收通过后，再把同一变更合并进 `main` 触发正式站构建。

### 方案 B：仅用 Preview 部署（不改第二个项目）

连接 GitHub 后，每个 **Pull Request** 或 **非 production 分支** 通常会生成独立的 **Preview URL**。适合短期联调；URL 随 PR 变化，不适合固定给业务方验收。

若正式站的 Production branch 是 `main`，可把功能开在分支上推远端，用 Preview 链接自测，再合并 `main`。

## 3. Supabase 与数据（保证测试环境也有数据）

站点的主数据在 **Supabase**（表如 `jobs`、`candidates` 等）。测试环境要「像正式一样能点能看」，需要：**单独的 Staging 数据库项目 + 表结构一致 + 导入一批数据**。

### 3.1 新建 Staging 专用 Supabase 项目

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard) → **New project**（例如名称 `myjob-staging`），区域可与正式项目相同。
2. 等数据库就绪后，在 **Settings → API** 记下：
   - **Project URL** → 对应 `VITE_SUPABASE_URL`
   - **anon public** key → 对应 `VITE_SUPABASE_PUBLISHABLE_KEY`
3. **不要**把正式环境的这两枚变量原样填到 Staging —— 否则测试库和线上库混用，容易误改生产数据。

### 3.2 表结构：与仓库迁移保持一致

本仓库表结构在 **`supabase/migrations/`** 下。任选其一：

**做法 A — Supabase CLI（推荐）**

```bash
# 安装 CLI 后登录
supabase login
# 关联到「Staging」项目（Dashboard → Settings → General → Reference ID）
supabase link --project-ref <你的_staging_项目的_ref>
supabase db push
```

`db push` 会把本地 `migrations` 应用到当前链接的 Staging 库。

**做法 B — 手动执行 SQL**

在 Staging 项目的 **SQL Editor** 里，按文件名时间顺序执行 `supabase/migrations/` 下每个 `.sql` 文件（与新建项目相关顺序一致即可）。

### 3.3 把数据放进 Staging（与正式「差不多」的几条路）

| 方式 | 适用场景 | 说明 |
|------|-----------|------|
| **表导出 / 导入（CSV）** | 最常见、免费套餐可做 | 在**正式**项目 **Table Editor** 里对 `jobs`、`candidates` 等表 **Export CSV**；到 **Staging** 项目同名表 **Import**。导入前列结构须已通过迁移建好。若 `id` 为主键，注意 CSV 不要与现有行冲突（可先清空 Staging 表再导入）。 |
| **逻辑备份（pg_dump）** | 数据量大、熟悉 Postgres | 使用正式库的连接串只导出 `public` 下相关表数据，再导入 Staging（注意目标库已有 schema，通常用 `COPY`/`INSERT` 或 psql）。勿把正式 **service_role** 密钥提交到仓库。 |
| **少量种子数据** | 只测流程、不需全量职位 | 在 Staging 的 `/admin` 里手工建几条，或在 SQL Editor 插入几条 `INSERT`。 |
| **以后定期同步** | 希望 Staging 偶尔与线上一致 | 需要时再导出一遍 CSV 覆盖/追加；或用内部脚本 + CI（密钥放 GitHub Secrets），不要硬编码密钥。 |

这样配置后，只要 Cloudflare Staging 里的 **`VITE_SUPABASE_*` 指向这个 Staging 项目**，构建出来的测试站就能读到和正式结构一致、且有真实感的数据。

### 3.4 管理员登录（`/admin`）

Staging 是 **另一套 Supabase Auth**。你需要在 Staging 项目的 **Authentication → Users** 里 **新建** 一个测试账号（邮箱 + 密码），与正式站管理员 **不是**同一套用户；用该账号登录 **Staging 站点** 的 `/admin` 做导入、开关职位等操作。

### 3.5 简历 / 候选人搜索（可选 `VITE_RESUMES_*`）

若正式站配置了 **`VITE_RESUMES_SUPABASE_URL`**、**`VITE_RESUMES_SUPABASE_ANON_KEY`** 等：

- **推荐**：再建一个 **Resumes 用的小号 Staging 项目**（或单独 schema），把需要的 view/表迁过去并导入测试数据，测试环境填 **Staging 专用** 变量。
- **临时省事（不推荐长期）**：让 Staging 只读同一正式 Resumes 库 —— 一般不会误写，但仍是生产数据，合规与心里负担要自己评估。

### 3.6 Cloudflare 里要填的变量（数据相关）

在 **Staging 的 Pages 项目** → **Settings → Environment variables** 中，至少与本地 `.env.staging` 一致：

- `VITE_SITE_URL`：Staging 的 `https://xxx.pages.dev` 或测试域名（无尾斜杠）
- `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`：**Staging 数据库项目**的 API 信息
- 若用简历库：按需填 `VITE_RESUMES_*`、`VITE_RESUMES_PUBLIC_VIEW`

保存后重新触发一次部署，前台列表、详情、Admin 才会连到这套库。

---

## 4. 与正式环境的变量差异（小结）

- **`VITE_SITE_URL`**：必须改成 Staging 的域名或 Pages 提供的 `*.pages.dev` 地址，否则 canonical / 分享链接会指错。
- **Supabase**：Staging 使用 **单独 Project**（上文），并在该项目内完成 **迁移 + 导数据**，才能保证测试环境有数据且不伤线上。
- **Analytics**：若 GTM/GA 与域名绑定，可为 Staging 使用单独容器或过滤 hostname，避免污染线上报表。

## 5. 脚本一览

| 命令 | 说明 |
|------|------|
| `npm run build:staging` | `vite build --mode staging`，读取 `.env.staging` |
| `npm run preview:staging` | 先执行 `build:staging`，再 `vite preview` |

---

部署命令仍以你在 Cloudflare（或 CI）里配置的 `npm run build` / `npm run build:staging` 为准；若正式环境使用默认 `npm run build`，Staging 项目请将构建命令设为 `npm run build:staging`。

---

**验收清单（数据）**：Staging Supabase 已 `db push`（或迁移 SQL 已执行）→ 已从正式导出 CSV 导入关键表（或已有种子数据）→ Staging Auth 已创建测试管理员 → Cloudflare Staging 环境变量指向该 Staging 项目 → 打开测试站 `/empleos` 与 `/admin` 能看到列表并可登录。
