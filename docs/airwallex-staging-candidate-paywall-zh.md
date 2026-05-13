# Airwallex（测试环境）候选人联系付费接入

**正式站上线隔离**（合并代码不等于对用户开放支付）：见 `docs/payment-rollout-zh.md`。

本次实现：候选人卡片点击按钮时，先弹支付对话框；支付成功后回跳并解锁，再进入 WhatsApp 联系流程。

## 已接入的代码位置

- 前端支付门禁：`src/components/CandidateCard.tsx`（弹窗仅跳转）
- 独立支付页（墨西哥常见方式说明 + 跳转网关）：`/pago-candidato` → `src/pages/PagoCandidato.tsx`
- 支付成功回跳处理：`src/pages/CandidateSearch.tsx`
- 本地解锁状态存储：`src/lib/candidateContactUnlock.ts`
- Airwallex 创建支付链接函数：`supabase/functions/airwallex-create-checkout/index.ts`

## 你现在需要提供/配置的内容

### 1) Supabase Edge Function Secrets（staging 项目）

在 staging 对应的 Supabase 项目中设置：

- `AIRWALLEX_CLIENT_ID`
- `AIRWALLEX_API_KEY`
- `AIRWALLEX_BASE_URL`（测试环境建议：`https://api-demo.airwallex.com`）

设置命令示例：

```bash
supabase functions secrets set AIRWALLEX_CLIENT_ID=xxx AIRWALLEX_API_KEY=xxx AIRWALLEX_BASE_URL=https://api-demo.airwallex.com
```

### 2) 部署函数（staging Supabase）

```bash
supabase functions deploy airwallex-create-checkout
```

### 3) 前端测试环境变量（Cloudflare staging 或 `.env.staging`）

- `VITE_CANDIDATE_CONTACT_PRICE_MXN=49`（可改）

## 关键说明

- 当前是 **测试环境流程**：支付成功后通过回跳参数解锁候选人联系方式权限，并存储在浏览器 `localStorage`。
- 该“解锁”属于前端测试门禁，正式环境建议改为服务端持久化（订单表 + 权限校验 + webhook 入账确认）。
- 函数内使用了 Airwallex Payment Intent + Payment Link 方式。若你账号 API 权限模型不同，可能需要按你控制台权限调整字段。

## 你需要回给我的信息（我可继续帮你补到可上线）

1. 你的 Airwallex 是不是 `api-demo.airwallex.com` 测试环境  
2. 你希望单次联系收费金额（MXN）  
3. 你是否要“一个企业账号买一次可联系多个候选人”的套餐（而不是按候选人单次收费）  
4. 是否要我继续补 webhook + Supabase 订单表（推荐）
