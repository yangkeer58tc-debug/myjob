# 测试 / 预发布环境说明

目标：在不影响正式域名的前提下，先验证功能与数据，再合并到 `main` 上线。

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

## 3. 与正式环境的变量差异

- **`VITE_SITE_URL`**：必须改成 Staging 的域名或 Pages 提供的 `*.pages.dev` 地址，否则 canonical / 分享链接会指错。
- **Supabase**：建议 Staging 使用 **单独 Project** 或 **单独 schema**，避免误改线上数据。
- **Analytics**：若 GTM/GA 与域名绑定，可为 Staging 使用单独容器或过滤 hostname，避免污染线上报表。

## 4. 脚本一览

| 命令 | 说明 |
|------|------|
| `npm run build:staging` | `vite build --mode staging`，读取 `.env.staging` |
| `npm run preview:staging` | 先执行 `build:staging`，再 `vite preview` |

---

部署命令仍以你在 Cloudflare（或 CI）里配置的 `npm run build` / `npm run build:staging` 为准；若正式环境使用默认 `npm run build`，Staging 项目请将构建命令设为 `npm run build:staging`。
