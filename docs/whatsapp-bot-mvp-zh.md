# WhatsApp 招聘机器人（MVP，Infobip 接入）

> 目标：用户从 myjob 网站点 WhatsApp 入口 → 进入生产号 `+52 1 81 3268 9445` → 自动对话收姓名和简历附件 → 数据落到 Supabase。
>
> 本期所有改动**只在 staging 分支**，不动 `main`，也不会自动配到生产环境。

---

## 已交付的代码改动


| 类型            | 路径                                                               |
| ------------- | ---------------------------------------------------------------- |
| 数据库 migration | `supabase/migrations/20260507100000_add_whatsapp_bot_tables.sql` |
| Edge Function | `supabase/functions/whatsapp-webhook/index.ts`                   |
| Infobip 客户端   | `supabase/functions/whatsapp-webhook/infobip.ts`                 |
| 西语话术          | `supabase/functions/whatsapp-webhook/copy.ts`                    |
| Function 配置   | `supabase/functions/whatsapp-webhook/config.toml`                |
| 环境变量示例        | `.env.staging.example` 末尾新增 WhatsApp 段                           |


新增数据库对象：

- 表 `public.whatsapp_conversations`（每个 WhatsApp 用户一条，记录当前对话状态）
- 表 `public.whatsapp_messages`（所有进出消息历史）
- Storage bucket `whatsapp-resumes`（私有，简历文件）

机器人逻辑（MVP 状态机）：

```
new            -> 发欢迎语，问全名
awaiting_name  -> 收到文字 -> 存为姓名 -> 发"请发CV"
awaiting_resume:
  - 文档/图片  -> 下载到 storage -> 发"已收到"
  - 其他文字  -> 提示请发文件
completed      -> "我们已经有你的资料了"
```

Spanish-only 文案，全部集中在 `copy.ts`，后续要改就改这里。

---

## 你需要做的事（按顺序点完即可上线 staging）

### 步骤 0：把代码 pull 到 staging 分支

我已经把改动放在 staging 分支。你确认下：

```bash
git fetch
git checkout staging
git pull
```

### 步骤 1：在 Supabase 里跑 migration（使用 **staging** 项目）

> 项目 ref 区分：
>
> - 生产：`ggydlqfkieerrzmszsbl`（不要动）
> - **staging：`vtxknqmuavgtryadvqdr`（本次部署都在这里）**
>
> `supabase/config.toml` 里写的是生产 ref，所以 CLI 命令一定要带 `--project-ref` 显式指定 staging，否则会误推到生产。

二选一：

**方式 A：用 Supabase CLI（推荐）**

```bash
supabase link --project-ref vtxknqmuavgtryadvqdr
supabase db push --project-ref vtxknqmuavgtryadvqdr
```

**方式 B：在 Supabase 控制台手动跑 SQL**

- 打开 `supabase/migrations/20260507100000_add_whatsapp_bot_tables.sql`
- 复制全部 SQL
- Supabase Dashboard（确认左上角项目是 `myjob-staging`）-> SQL Editor -> New query -> 粘贴 -> Run

跑完后到 `Table Editor` 看：

- 新增 `whatsapp_conversations` 表 ✅
- 新增 `whatsapp_messages` 表 ✅

到 `Storage`：

- 新增 bucket `whatsapp-resumes`（**Public** 应为 OFF）

如果 Storage bucket 没自动建出来（受权限限制），到 Storage 页手动 `**New bucket`**：

- Name：`whatsapp-resumes`
- Public：**OFF**
- 点 Create

### 步骤 2：配置 Edge Function 环境变量（在 **staging** 项目里）

Supabase Dashboard -> staging 项目 -> `Edge Functions` -> `Manage secrets`，添加 3 条：


| Key                | Value                                |
| ------------------ | ------------------------------------ |
| `INFOBIP_BASE_URL` | `https://1ex1wk.api.infobip.com`     |
| `INFOBIP_API_KEY`  | （新生成的 Infobip API key，不要用之前贴在聊天里的那条） |
| `INFOBIP_SENDER`   | `5218132689445`                      |


`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` Supabase 会自动注入到 Edge Function 环境，不需要手动加。

> ⚠️ 之前在聊天里贴出来的那条 API key 已经暴露，请在 Infobip 把它 **Disable / Delete**，重新生成一条放这里。

### 步骤 3：部署 Edge Function 到 **staging**

```bash
# 必须显式带 --project-ref，否则会用 config.toml 里的生产 ref
supabase functions deploy whatsapp-webhook --project-ref vtxknqmuavgtryadvqdr
```

部署成功后，函数 URL 是：

```
https://vtxknqmuavgtryadvqdr.supabase.co/functions/v1/whatsapp-webhook
```

测试函数活着：

```bash
curl https://vtxknqmuavgtryadvqdr.supabase.co/functions/v1/whatsapp-webhook
# 应返回 {"ok":true,"service":"whatsapp-webhook"}
```

### 步骤 4：在 Infobip 把生产号 inbound 指向 staging webhook

1. 进 Infobip Portal
2. `Channels and Numbers` -> `Numbers` -> 点 `5218132689445`
3. 切到 `WhatsApp` Tab
4. 找到 `Inbound configuration` 区块
5. 把入站消息的转发动作改为 **Forward to webhook / HTTP**：
  - URL：`https://vtxknqmuavgtryadvqdr.supabase.co/functions/v1/whatsapp-webhook`
  - Method：`POST`
  - 不需要任何 keyword（让所有进入的消息都触发）
6. Save

> 如果 Infobip 控制台里这一项叫 `Applications` / `Forwarding URL` / `Inbound URL`，意思是一样的，把 webhook URL 填进去即可。

### 步骤 5：手机实测

用一个**没在 myjob 后台留过痕迹**的 WhatsApp 号（不是你 Infobip 账号绑定的那个手机号）：

1. 直接对 `+52 1 81 3268 9445` 发任意消息（例如 `Hola`）
2. 应立刻收到欢迎语 + 问名字
3. 回复一个名字（例如 `Juan Pérez`）
4. 收到 "请发简历" 提示
5. 发一个 PDF 附件
6. 收到 "已收到，谢谢" 回执

发完后到 Supabase Dashboard 检查：

- `whatsapp_conversations` 表里有这一条用户，`state = completed`
- `whatsapp_messages` 表里有完整对话记录
- `whatsapp-resumes` bucket 里有简历文件，路径形如 `<wa_user_id>/<日期>/<文件名>.pdf`

---

## 上线网站时再做的事（**MVP 测试通过后**）

当前网站 `useWhatsAppRedirect.tsx` 的 `BOT_NUMBER = '5218132689146'` 是旧号码。  
等机器人测试通过后，把它改成 `5218132689445`：

```ts
// src/hooks/useWhatsAppRedirect.tsx
const BOT_NUMBER = '5218132689445';
```

只改这一行就行，其他逻辑（默认招呼语、QR 码弹窗等）都保留。

---

## 下一阶段会加的东西（暂不做）

- 6 字段问答（除姓名+简历外，加岗位、年限、城市、薪资）
- Gemini 兜底 AI 回答（用户说不规则话时由 AI 回）
- 模板消息（窗口外通知：初筛通过、面试邀请、结果通知）
- 后台候选人列表 + 历史消息查看页
- 转人工开关

---

## 监控与排错

- **Edge Function 日志**：Supabase Dashboard -> Edge Functions -> `whatsapp-webhook` -> Logs
- **Infobip 调用日志**：Infobip Portal -> `Logs` -> `Conversation` 或 `Logs` 菜单
- **常见 4xx/5xx**：
  - `500 Missing Infobip config`：secrets 没配齐
  - `400 Invalid JSON body`：webhook URL 接到了非预期 payload，看 Infobip 是否发了状态回执到同一 URL（可在 Infobip 把 status callback 指向单独的 `…/status` 路径或留空）
  - 没有任何回复：检查 Infobip Inbound configuration 的 forwarding URL 有没有真的保存

---

## 安全清单（请尽快做）

- 在 Infobip 把暴露过的旧 API key Disable / Delete
- 重新生成新 API key 并只放进 Supabase secrets
- 在 Meta WhatsApp Manager 完成 Business Verification（提升每天对话上限）

