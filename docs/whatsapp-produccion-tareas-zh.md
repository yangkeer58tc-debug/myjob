# WhatsApp Bot 上线：我已做的 + 你只需要点的

面向 **myjob.com 生产**：让 **只有一个职位**（`/empleo/nutriologa-82489719/`，id `82489719`）进新 bot；会话与简历进 **生产 Supabase**；RMC 与 `/buscar-candidatos` 与现有配置一致。

---

## 我已经替你做好的（无需你再操作）

1. **代码**：把 `staging` 上的 WhatsApp 全流程合并进 **`main`**（含：仅 `82489719` 走新号 `5218132689445`、RMC 同步、`RMC_AI_EXTRACT_URL` 解析、Admin 看板）。
2. **生产 Edge Function**：已在 **生产 Supabase 项目** `vnolnnpegxpmsvdhwqgb` 上部署 **`whatsapp-webhook`**（与 staging 同一代码）。
3. **仓库卫生**：`supabase/.temp` 已加入 `.gitignore`，避免把本机 link 信息提交上去。

---

## 你必须亲自完成的 4 步（按顺序）

### 第 1 步：在生产数据库里建 WhatsApp 表（必做，约 2 分钟）

CLI 无法对生产库自动 `db push`（生产库迁移历史与仓库不一致），所以用 **SQL Editor 一次性执行**：

1. 打开：  
   [Supabase SQL（生产项目）](https://supabase.com/dashboard/project/vnolnnpegxpmsvdhwqgb/sql/new)
2. 打开本仓库文件：  
   [`docs/snippets/whatsapp-produccion-schema.sql`](./snippets/whatsapp-produccion-schema.sql)
3. **全选复制** → 粘贴到 SQL Editor → **Run**。

> 若某张表已存在，脚本多为 `IF NOT EXISTS`，一般可重复执行；若报错把完整错误信息发我即可。

---

### 第 2 步：生产 Edge Function 的 Secrets（必做，约 5 分钟）

打开：**生产**项目 → **Edge Functions** → **Secrets**（或 `whatsapp-webhook` → Manage secrets）。

请把你在 **staging 项目**（`vtxknqmuavgtryadvqdr`）里已经配好的值，**原样抄到生产**（键名一致）：

| Secret 名 | 说明 |
|-----------|------|
| `INFOBIP_BASE_URL` | 与 staging 相同 |
| `INFOBIP_API_KEY` | 与 staging 相同 |
| `INFOBIP_SENDER` | WABA 号码，如 `5218132689445` |
| `MYJOB_ENV` | **必须设为 `production`**（线上写生产 RMC） |
| `RMC_SUPABASE_URL` | **生产 RMC** 的 Supabase URL |
| `RMC_SERVICE_ROLE_KEY` | **生产 RMC** 的 service_role（勿泄露） |
| `RMC_AI_EXTRACT_URL` | 生产 RMC 站点上的 **`/ai-extract` 完整 URL** |

> 若 staging 里用的是 `RMC_STAGING_*`，线上请改成 **真实生产 RMC** 的 URL 与 key，否则简历会写到错库。

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase **自动注入**当前项目，一般不用手填。

---

### 第 3 步：Infobip 改 Inbound Webhook（必做，约 1 分钟）

把 **发往 `5218132689445`（WABA）** 的 **Inbound URL** 改成 **生产**函数地址：

```text
https://vnolnnpegxpmsvdhwqgb.supabase.co/functions/v1/whatsapp-webhook
```

- 方法：**POST**  
- 与之前在 staging 上配的一样，只是域名换成 **生产** Supabase。

**说明**：改完后，该号码的消息会进 **生产库**；staging 项目里旧的 webhook **不会再收到**这条业务线的消息（正常）。

---

### 第 4 步：Cloudflare Pages 发一版 **生产** 前端（必做）

把 **`main`** 推到 GitHub 后，在 Cloudflare **Production** 对 **myjob.com** 触发一次构建部署（或等你平时的自动部署）。

这样线上用户打开 **nutriologa** 那个帖子才会出现 **仅该帖** 进新 bot 的逻辑；其它帖子仍走旧号。

**请你确认**（一般你早就配过，无需改）：

- 生产环境的 **`VITE_RESUMES_SUPABASE_URL`** / **`VITE_RESUMES_SUPABASE_ANON_KEY`** 仍指向 **存候选人那份 RMC**，且与 Edge 里 `RMC_SUPABASE_URL` 是 **同一套库**，这样用户回 `Si` 后才能在 **`https://myjob.com/buscar-candidatos`** 看到。

---

## 做完后你怎么验收（5 分钟）

1. 手机打开：`https://myjob.com/empleo/nutriologa-82489719/` → 点申请/WhatsApp → 号码应为 **`5218132689445`**。  
2. 再随便打开 **另一个职位** → 应为 **`5218132689146`**。  
3. 用 WhatsApp 走完：打招呼 → 名字 → 发简历 → 回 **`Si`**。  
4. **生产** Supabase → 表 `whatsapp_conversations` / `whatsapp_messages` 有新行。  
5. **RMC** `resumes` 里该用户有记录；若配了 `RMC_AI_EXTRACT_URL`，过几秒应有解析字段。  
6. 打开 **`/buscar-candidatos`** 能看到该候选人（需满足列表页的展示条件：姓名 + 求职方向等，当前同步逻辑已对齐）。

---

## 遇到问题找谁

把 **SQL 报错全文**、**Edge Function 日志**（最后 50 行）、**Infobip 入站是否 200** 发我即可继续排。
