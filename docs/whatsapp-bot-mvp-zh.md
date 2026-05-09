# WhatsApp 招聘机器人（v3，Infobip 接入）

> 目标：用户从 myjob 网站点 WhatsApp 入口 → 进入生产号 `+52 1 81 3268 9445` → 自动对话收姓名 + 简历 → 邀请加入「destacados」候选人面板 → 用户回 `Si` 时把简历同步到 RMC → Admin 看板可监控。
>
> 本期所有改动**只在 staging 分支**，不动 `main`，也不会自动配到生产环境。

---

## 已交付的代码改动

| 类型            | 路径                                                                         |
| ------------- | -------------------------------------------------------------------------- |
| 数据库 migration | `supabase/migrations/20260507100000_add_whatsapp_bot_tables.sql`（v1 表）     |
| 数据库 migration | `supabase/migrations/20260507200000_whatsapp_bot_v3_state.sql`（v3 增列 + RLS） |
| Edge Function | `supabase/functions/whatsapp-webhook/index.ts`                             |
| Infobip 客户端   | `supabase/functions/whatsapp-webhook/infobip.ts`                           |
| RMC 同步        | `supabase/functions/whatsapp-webhook/rmc.ts`                               |
| 西语话术          | `supabase/functions/whatsapp-webhook/copy.ts`                              |
| Function 配置   | `supabase/functions/whatsapp-webhook/config.toml`                          |
| 环境变量示例        | `.env.staging.example` 末尾的 WhatsApp 段                                      |
| Admin 看板      | `src/components/admin/WhatsAppBotPanel.tsx`（嵌入 `/admin` 第三个 Tab）           |
| 前端联系号         | `src/lib/whatsappBotNumber.ts`（staging 用 Infobip 号，生产保留旧号）                  |

数据库对象：

- 表 `public.whatsapp_conversations`（每个 WhatsApp 用户一条「活跃」会话；旧会话靠 `archived_at` 归档）
- 表 `public.whatsapp_messages`（所有进出消息历史）
- Storage bucket `whatsapp-resumes`（私有，简历文件）

会话状态机（v3）：

```
new
  → 发欢迎语
  → state = awaiting_name

awaiting_name
  → 文本（姓名经清洗 + 长度校验）
      → 存 candidate_name → 发"请发CV"
      → state = awaiting_resume
  → 非姓名（URL/纯数字/纯标点等）
      → 重新发欢迎语
      → state 不变

awaiting_resume
  → document/image
      → 下载（限 10MB） → 清掉 bucket 里此用户旧文件 → 存最新一份
      → 若同时检测到 30 秒内还有别的图片入库，先发"建议合并成 PDF"
      → 然后顺发：✅已收到 → 邀请加入 destacados → 链接 + Si 提示
      → state = awaiting_opt_in
  → 文本/其他
      → 提示"请发文件"
      → state 不变
  → 文件 > 10MB
      → 发"文件太大"
      → state 不变

awaiting_opt_in
  → strict("si"/"sí"，去尾标点 + 不区分大小写)
      → 把最新简历从 myjob bucket 下载，service_role 直推 RMC
      → 发"已加入候选人面板"
      → state = completed_opt_in
  → 明确 no/paso/luego/...
      → 不再回话
      → state = completed_declined
  → 模糊回复（首次）
      → 发"如愿加入只需回 Si"
      → opt_in_clarify_count += 1，state 不变
  → 模糊回复（再次）
      → state = completed_declined（不再回话）

completed_*
  → 5 分钟内再发消息：静默记录、不回话、不重启
  → 超过 5 分钟再发消息：归档当前会话（archived_at = now），从 new 重新开始
```

文案集中在 `copy.ts`，全部西语，要改就改这里。

Admin 看板：登录 `/admin` → 第三个 Tab `WhatsApp Bot` → 6 卡数据 + RMC 同步分布 + 会话表 + 单条对话明细 + CSV 导出。

---

## 你需要做的事（按顺序点完即可上线 staging）

### 步骤 0：把代码 pull 到 staging 分支

```bash
git fetch
git checkout staging
git pull
```

### 步骤 1：在 Supabase 里跑两份 migration（使用 **staging** 项目）

> 项目 ref 区分：
>
> - 生产：`ggydlqfkieerrzmszsbl`（不要动）
> - **staging：`vtxknqmuavgtryadvqdr`（本次部署都在这里）**
>
> `supabase/config.toml` 里写的是生产 ref，所以 CLI 命令一定要带 `--project-ref` 显式指定 staging，否则会误推到生产。

#### 方式 A：Supabase CLI

```bash
npx supabase@latest link --project-ref vtxknqmuavgtryadvqdr
npx supabase@latest db push --project-ref vtxknqmuavgtryadvqdr
```

第一次会让你输 DB 密码，从 Supabase Dashboard `Project Settings → Database → Connection string` 处复制。

#### 方式 B：在控制台手动跑（最稳）

把以下两份 SQL 依次粘到 Dashboard → SQL Editor → New query → Run：

1. `supabase/migrations/20260507100000_add_whatsapp_bot_tables.sql`（如果上次 MVP 已经跑过，可以跳过；migration 是幂等的，重复跑也没事）
2. `supabase/migrations/20260507200000_whatsapp_bot_v3_state.sql`（**本次必跑**）

跑完后，在 `Table Editor` 上点 `whatsapp_conversations` → `Definition`，应该看到这些新列：

- `opt_in_clarify_count`
- `rmc_resume_id`
- `rmc_sync_status`
- `rmc_sync_error`
- `last_resume_storage_path`
- `last_resume_received_at`
- `completed_at`
- `archived_at`

### 步骤 2：配置 Edge Function 环境变量（在 **staging** 项目里）

Supabase Dashboard → staging 项目 → `Edge Functions` → `Manage secrets`，配置以下 Key：

#### Infobip（必填）

| Key                | Value                                |
| ------------------ | ------------------------------------ |
| `INFOBIP_BASE_URL` | `https://1ex1wk.api.infobip.com`     |
| `INFOBIP_API_KEY`  | （Infobip API key）                    |
| `INFOBIP_SENDER`   | `5218132689445`                      |

> ⚠️ 之前在聊天里贴出来的那条 API key 已经暴露过，建议在 Infobip Disable / Delete 后重新生成一条放这里。
> 注意：`INFOBIP_SENDER` 只填数字 MSISDN，必须保留前面的 `521`，**不要自作聪明改成 `528…`**（会被 Infobip 判 `REJECTED_SOURCE`）。

#### 环境标识（必填，决定走 staging-RMC 还是 prod-RMC）

| Key         | Value                          |
| ----------- | ------------------------------ |
| `MYJOB_ENV` | `staging` 或 `production`，不填默认按 `production` 处理 |

#### RMC 同步（可选；不填则用户回 `Si` 后机器人会回成功，但不会真同步到 RMC，看板里 RMC 状态显示 `Saltado (sin RMC)`）

`MYJOB_ENV=staging` 时优先读这两条：

| Key                              | Value                                                |
| -------------------------------- | ---------------------------------------------------- |
| `RMC_STAGING_SUPABASE_URL`       | RMC staging 项目 URL，如 `https://xxxxx.supabase.co`    |
| `RMC_STAGING_SERVICE_ROLE_KEY`   | RMC staging service_role key（**只在服务端用，绝不能泄露**）       |

`MYJOB_ENV=production` 时读这两条：

| Key                       | Value                                                |
| ------------------------- | ---------------------------------------------------- |
| `RMC_SUPABASE_URL`        | RMC 生产 URL                                           |
| `RMC_SERVICE_ROLE_KEY`    | RMC 生产 service_role key                              |

> RMC service_role key 在 RMC 项目的 `Project Settings → API → service_role secret` 处复制。
>
> 没配 RMC secrets 不影响主流程：用户照常收到「已加入候选人面板」回复，但记录在 `whatsapp_conversations.rmc_sync_status = skipped_no_config`，配好后再批量补同步即可。

#### RMC AI 解析（可选，与正式站 `/ai-extract` 对齐）

| Key                    | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `RMC_AI_EXTRACT_URL`   | RMC（Cloudflare Pages）上 **`/ai-extract` 的完整 URL**（如 `https://tu-dominio.pages.dev/ai-extract`） |

未配置时：WhatsApp 仍会把简历同步进 RMC 并写入默认 `job_direction` 等，但**不会**调用 Gemini 生成 `profile_summary` 等解析字段。配置后，用户回 `Si` 且 RMC 同步成功时，函数会在后台调用该 URL 并把结果写回同一条 `public.resumes`。

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` Supabase 会自动注入，不需要手动加。

### 步骤 3：部署 Edge Function 到 **staging**

```bash
# 必须显式带 --project-ref + --no-verify-jwt
# （Infobip webhook 不带 JWT，开了校验会全 401）
npx supabase@latest functions deploy whatsapp-webhook \
  --project-ref vtxknqmuavgtryadvqdr \
  --no-verify-jwt
```

部署成功后，函数 URL 是：

```
https://vtxknqmuavgtryadvqdr.supabase.co/functions/v1/whatsapp-webhook
```

健康检查：

```bash
curl https://vtxknqmuavgtryadvqdr.supabase.co/functions/v1/whatsapp-webhook
# 应返回 {"ok":true,"service":"whatsapp-webhook","build":"v6"}
```

### 步骤 4：在 Infobip 把生产号 inbound 指向 staging webhook

1. 进 Infobip Portal
2. `Channels and Numbers` → `Numbers` → 点 `5218132689445`
3. 切到 `WhatsApp` Tab
4. `Inbound configuration`：
   - URL：`https://vtxknqmuavgtryadvqdr.supabase.co/functions/v1/whatsapp-webhook`
   - Method：`POST`
   - 不需要任何 keyword（让所有进入的消息都触发）
5. Save

### 步骤 5：手机实测

用一个**没在 myjob 后台留过痕迹**的 WhatsApp 号：

1. 对 `+52 1 81 3268 9445` 发任意消息（`Hola`）
   - 应收到欢迎语 + 问名字
2. 回名字（`Juan Pérez`）
   - 应收到"请发CV"
3. 发一份 PDF（< 10 MB）
   - 应收到 ✅已收到 + 邀请 + 链接 + `Si` 提示（共 3 条）
4. 回 `Si`
   - 应收到「已加入候选人面板」
5. 5 分钟后再发任意消息
   - 应当作全新会话从头开始

到 Supabase Dashboard 验证：

- `whatsapp_conversations` 里这条记录 `state = completed_opt_in`，`rmc_sync_status` 为 `success` 或 `skipped_no_config`
- `whatsapp_messages` 里能看到完整 inbound + outbound 历史
- `whatsapp-resumes` bucket 里只有**最新**那份 CV（路径形如 `<wa_user_id>/<日期>/<时间戳>-<文件名>.pdf`）
- 如果配了 RMC secrets，到 RMC `public.resumes` 表里能查到对应 `whatsapp` 的候选人，`storage_path` 指向 RMC 的 `resumes/whatsapp/...`
- 若还配了 `RMC_AI_EXTRACT_URL`，等几秒刷新该行：应出现 `profile_summary`、`job_direction`（若模型有输出）等解析字段，与正式站上传解析一致

### 步骤 6：登录 Admin 看板

`/admin` 登录后，点 `WhatsApp Bot` Tab，能看到：

- 6 张统计卡片（会话数 / 每个状态 / CV 收到 / 接受 destacados / 拒绝）
- 3 张 RMC 同步分布卡（成功 / 失败 / 跳过）
- 会话表（点击行展开消息明细）
- CSV 导出

---

## 前端 WhatsApp 号码切换

`vite build`（生产构建）目前用占位 `5218132689146`；`npm run build:staging` 自动用 Infobip WABA `5218132689445`。

要改时二选一：

- 改 `src/lib/whatsappBotNumber.ts` 里的 `PRODUCTION_WHATSAPP_BOT_NUMBER`；或
- 设置 `VITE_WHATSAPP_BOT_NUMBER`（纯数字 MSISDN，无前缀）

---

## 下一阶段会加的东西（暂不做）

- Gemini 兜底 AI 回答（用户说不规则话时由 AI 回）
- 转人工开关（`is_human_takeover` 字段已就绪，但前端控制台还没暴露）
- 失败重试：`rmc_sync_status = failed` 的会话，从 Admin 上一键重推
- 模板消息（窗口外通知：初筛通过、面试邀请、结果通知）

---

## 监控与排错

- **Edge Function 日志**：Supabase Dashboard → Edge Functions → `whatsapp-webhook` → Logs。每个 build 文件头部有 `[wa-bot ...]` 前缀，可定位是不是缓存的旧版本。
- **401 Unauthorized**（全部 invocations 是 401）：JWT 校验被开了。重新部署务必带 `--no-verify-jwt`。
- **Infobip `REJECTED_DESTINATION_NOT_REGISTERED`**：
  - 入站 `from = 528132689146`，出站要 normalize 成 `5218132689146`，本仓库的 `infobip.ts` 已处理。
  - 如果 Infobip 日志提示 demo/SMS whitelist（trial 账号），需要充值或把收件人加白名单。
- **Infobip `REJECTED_SOURCE` / `Invalid Source address`**：
  - `INFOBIP_SENDER` 不是 Infobip 登记的出站号码，常见踩坑是误改成 `528...`。本项目正确值：**`5218132689445`**。
  - `INFOBIP_API_KEY` 跟 sender 不在同一 Infobip 账号。
  - `INFOBIP_BASE_URL` 不是这个 API Key 所在账号的 Base URL。
- **RMC 同步失败**：在 Admin 看板里某条会话 RMC 列显示「Error」，点开查看 `rmc_sync_error`。常见原因：
  - secrets 没配齐 / key 过期：状态会是 `skipped_no_config`（不会真的报 failed）。
  - `RMC_*_SUPABASE_URL` 写错（多了个斜杠 / 用了 `db.xxx` 而不是 `xxx.supabase.co`）。
  - RMC `resumes` 表有 NOT NULL 列且本项目没传值。

---

## 安全清单

- 在 Infobip 把暴露过的旧 API key Disable / Delete
- 重新生成新 API key 只放 Supabase secrets，不要写进代码或聊天里
- RMC service_role key 同上，**仅在 Supabase secrets 里**
- 在 Meta WhatsApp Manager 完成 Business Verification（提升每天对话上限）
