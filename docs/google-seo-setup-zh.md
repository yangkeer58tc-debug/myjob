# Google 招聘 SEO / Indexing 配置手册（超详细版）

本文档按**顺序**操作即可。你的站点主域以 **`https://myjob.com`** 为例（若不同，全文替换为你的主域）。

---

## 你需要提前准备的东西

| 物品 | 用途 |
|------|------|
| 浏览器（建议 Chrome） | 登录各控制台 |
| GitHub 账号 | 仓库权限、Secrets、Actions |
| Supabase 项目管理员权限 | 取 API 地址和 Key |
| Google 账号 | Search Console、Cloud Console |
| 已上线的网站 | 用户能访问 `https://myjob.com` |

---

## 第一步：从 Supabase 复制两个值（给 GitHub Secrets 用）

1. 打开浏览器，进入：**https://supabase.com/dashboard**
2. 登录后，**点击你的项目**（myjob 用的那个数据库项目）。
3. 左侧最下方点 **齿轮图标「Project Settings」**（项目设置）。
4. 左侧菜单点 **「API」**。
5. 在页面中找到：
   - **Project URL**  
     - 形如：`https://xxxxxxxx.supabase.co`  
     - **整段复制**，不要带 `/rest/v1` 等后缀。  
     - 这就是后面要填的 **`VITE_SUPABASE_URL`**。
   - **Project API keys** 区域里，找到 **`anon` `public`**（界面可能写作 **Publishable** / **default**）。  
     - **只复制这一串以 `eyJ` 开头的长 JWT**，不要复制 **service_role**。  
     - 这就是 **`VITE_SUPABASE_PUBLISHABLE_KEY`**。

6. 把这两个值先**临时保存在记事本**（不要发到公开群），下一步要用。

**若复制错误会怎样？**  
GitHub Actions 里 `npm run sitemap` 拉不到职位，`sitemap.xml` 里几乎没有 `/empleo/` 链接，Indexing 推空或失败。

---

## 第二步：在 GitHub 仓库里添加 Secrets

1. 打开你的 GitHub 仓库页面（例如：`https://github.com/你的用户名/myjob`）。
2. 顶部点 **「Settings」**（设置）。
3. 左侧栏找到 **「Secrets and variables」**，展开后点 **「Actions」**。
4. 确认当前在 **「Repository secrets」**（仓库密钥）区域。
5. 点绿色按钮 **「New repository secret」**，一共新建 **2～3 个**：

### Secret 1

- **Name（名称）**：必须完全一致（区分大小写）：  
  `VITE_SUPABASE_URL`  
- **Secret（值）**：粘贴第一步的 **Project URL**（`https://xxx.supabase.co`）。  
- 点 **Add secret**。

### Secret 2

- **Name**：`VITE_SUPABASE_PUBLISHABLE_KEY`  
- **Secret**：粘贴第一步的 **anon public** 那一长串。  
- **Add secret**。

### Secret 3（可选但建议）

- **Name**：`SITE_URL`  
- **Secret**：`https://myjob.com`  
  （若你对外正式域名是带 `www` 的，就填 `https://www.myjob.com`，且全站与 GSC 要统一。）  
- **Add secret**。

6. 保存后，列表里应能看到名字（**值永远不会再显示**，这是正常的）。

---

## 第三步：Google Search Console（GSC）— 添加网站并验证

1. 打开：**https://search.google.com/search-console**
2. 若第一次用，会提示「添加资源」。选一种方式：

### 方式 A：网址前缀（推荐新手）

- 选 **「网址前缀」**。
- 输入：`https://myjob.com`  
  （注意：不要写成 `http`，除非你全站就是 http；一般全站 HTTPS。）
- 点 **继续**。

### 方式 B：网域

- 需要改 DNS，步骤更长；若你不熟悉 DNS，先用方式 A。

3. **验证所有权**：页面会列出多种方法，任选一种你能完成的，例如：
   - **HTML 文件**：下载 Google 给的小文件，上传到你网站根目录（和 `index.html` 同级），再点验证。
   - **HTML 标签**：把一段 `meta` 放进你项目 `index.html` 的 `<head>`，部署上线后再点验证。
   - **DNS 记录**：在域名注册商处添加 TXT 记录（网域资源常用）。

4. 验证成功后，左侧资源列表里会出现 **`https://myjob.com`**，以后操作都在这个资源下进行。

**重要：**  
Indexing API 与 Search Console **必须是同一个「站点」**。若 GSC 只验证了 `www`，而你对外的 canonical 是 `https://myjob.com`，容易乱。请保证 **GSC 里添加的属性** = **你希望在搜索结果里出现的主域**。

---

## 第四步：在 GSC 里提交站点地图（Sitemap）

1. 在 Search Console 左侧，选中你的资源 **`https://myjob.com`**。
2. 左侧菜单点 **「站点地图」**（或英文 **Sitemaps**）。
3. 在 **「添加新的站点地图」** 输入框里填写：

```text
sitemap.xml
```

（很多情况下只填相对路径即可；若系统要求完整 URL，则填：）

```text
https://myjob.com/sitemap.xml
```

4. 点 **「提交」**。
5. 等几分钟刷新，状态应变为 **「成功」**。若 **「无法读取」**：
   - 浏览器新标签直接打开 `https://myjob.com/sitemap.xml`，看是否能打开、是否为 XML；
   - 若 404，说明**线上还没部署**带 `sitemap.xml` 的构建产物（见本文 **第八步**）。

---

## 第五步：把「Indexing 机器人」加为 GSC 用户（否则 GitHub Actions 会 403）

你们仓库里的工作流使用这个**固定**的服务账号邮箱（请原样复制，不要多空格）：

```text
myjob-indexing-bot@project-98545d92-1615-4087-bc2.iam.gserviceaccount.com
```

操作步骤：

1. 打开 Search Console，**确认左上角当前资源**是 `https://myjob.com`（或你实际使用的主域）。
2. 点左下角 **「设置」**（齿轮）→ **「用户和权限」**。
3. 点 **「添加用户」**。
4. **电子邮件地址**粘贴上面整行邮箱。
5. 权限级别选 **「所有者」**（Full 权限；Indexing API 对 Search Console 资源有要求，用所有者最省事）。
6. 保存。  
   Google 会给该邮箱发邀请，服务账号类型可能不点邮件也会生效，以 GSC 列表里出现该用户为准。

**若跳过这一步：**  
GitHub Actions 里 **「Publish job URLs」** 可能报 `403`，日志里会出现 `Indexing publish failed`。

---

## 第六步：Google Cloud 里启用「Indexing API」

1. 打开：**https://console.cloud.google.com/**
2. 页面顶部 **选择项目**。选择与 Search Console / 该服务账号 **同一个** Google Cloud 项目（若不确定，可看 IAM 里是否存在 `myjob-indexing-bot@...` 这个服务账号所在项目）。
3. 左侧菜单 **「API 和服务」** → **「已启用的 API 和服务」**。
4. 点顶部 **「+ 启用 API 和服务」**。
5. 搜索框输入：**Indexing API**。
6. 点开 **「Indexing API」**，点 **「启用」**。

**说明：**  
你们 GitHub 使用 **Workload Identity Federation** 换 Token，一般**不需要**把 JSON 密钥放进 GitHub；但必须 **启用 API** + **GSC 里加服务账号**。

---

## 第七步：手动跑一次 GitHub Actions，确认成功

1. 打开 GitHub 仓库 → 顶部 **「Actions」**。
2. 左侧列表点 **「Google Indexing (Jobs)」**。
3. 右侧点 **「Run workflow」** → 分支选 **`main`** → **「Run workflow」**。
4. 等运行结束（约 1～3 分钟），**点进最新一条运行记录**。
5. 点开左侧 **「indexing」** job，从上到下看每一步：
   - **Regenerate sitemap (Supabase)**：日志里应有类似 `Sitemap written: ... (N URLs)`，**N 应明显大于 2**（不止首页）。
   - **Publish job URLs (Indexing API)**：应看到 `Finished: X OK` 或部分 OK；若 **「All … failed」**，回到 **第五、六步**。

6. 若整段变红（Failure），点红色那一步，**把最后 20 行日志复制**下来排查（常见：Secrets 名错、Supabase key 错、GSC 未加服务账号）。

---

## 第八步：保证「线上网站」真的是构建后的结果（含 sitemap 与预渲染）

本地开发 `npm run dev` **不会**生成生产用的 `dist` 里每个职位静态页；**线上**应执行：

```bash
npm ci
npm run build
```

`build` 会自动：

- `prebuild`：生成 `public/sitemap.xml`（需环境变量里有 Supabase，见下）；
- `vite build`：打包前端；
- `postbuild`：运行 `prerender-jobs.mjs`，为职位生成带 **JobPosting + 可见正文** 的 `index.html`。

**部署到服务器 / CDN 时：**

1. 把 **`dist` 目录整个** 作为网站根目录发布（或平台要求的输出目录）。
2. 部署环境（或 CI）里配置与生产一致的：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`  
   否则构建时 sitemap 可能是「空职位列表」。

部署完成后用浏览器测试：

- `https://myjob.com/sitemap.xml` → 应有很多 `<loc>https://myjob.com/empleo/...`
- 任选一个职位 URL → **右键「查看网页源代码」** → 应能看到 `application/ld+json` 和 `#root` 里有文字（不是空 div）。

---

## 第九步：用 Google 官方工具抽查

1. **富媒体测试**：https://search.google.com/test/rich-results  
   - 输入一条线上职位 URL。  
   - 应能识别 **JobPosting**（可能带「非严重」警告，属正常）。

2. **网址检查**（在 GSC 顶部搜索框）：  
   - 粘贴同一 URL，看 **「已编入索引」** 否（新站可能要几天）。

---

## 定时任务说明（你已配置在仓库里）

- 工作流文件：`.github/workflows/google-indexing.yml`
- **每天 UTC 02:15** 会自动跑一次（约北京时间 10:15，夏令时可能差 1 小时）。
- **每次 push 到 `main`** 也会跑。
- 每次运行会：**重新用 Supabase 生成 sitemap** → **从 sitemap 里取最多 50 条 `/empleo/` URL** → **调用 Indexing API**。

若只想改时间，编辑该文件里的 `cron:` 行（需懂一点 cron 语法）。

---

## 常见问题（FAQ）

**Q1：Secrets 加了，但 sitemap 里还是没有职位？**  
- 检查 Secret 名称是否**完全一致**（`VITE_` 前缀不能少）。  
- 在 Supabase 里确认 `jobs` 表有 `is_active = true` 且 `created_at` 在脚本要求的窗口内（见 `scripts/generate-sitemap.mjs` 的 60 天逻辑）。

**Q2：Indexing 全部 403？**  
- 第五步行了吗？邮箱是否**完全一致**？  
- GSC 当前资源是否和 URL 的域名一致？

**Q3：`www` 和 `myjob.com` 两个都能打开？**  
- 选一个做主域，另一个 **301** 到主域；GSC 只添加**主域**属性；`SITE_URL`、canonical、站点地图里的 URL 全部用同一套。

**Q4：我不使用 Netlify，`public/_redirects` 有用吗？**  
- 仅部分静态托管会读该文件；若无效，在 **Cloudflare / Vercel / Nginx** 里单独做 `www`→主域 301（见各平台文档）。

---

## 文档版本

- 与仓库代码一致的服务账号：`myjob-indexing-bot@project-98545d92-1615-4087-bc2.iam.gserviceaccount.com`
- Workflow 名称：`Google Indexing (Jobs)`

若某一步界面与本文不一致（Google 常改版），以当前界面为准，关键信息只有：**Supabase 两个值、GSC 验证、站点地图 URL、服务账号加所有者、启用 Indexing API、GitHub Secrets、手动跑一次 Actions**。
