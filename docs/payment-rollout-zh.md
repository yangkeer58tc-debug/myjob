# 候选人付费（支付）上线隔离与后续迭代

目标：

1. **先上线其他功能**，不会因为合并了支付相关代码就在正式站 `myjob.com` 上出现结账。
2. **之后在同一套实现上继续改支付**，文件位置集中、行为可预期。

---

## 正式站默认不会出现支付

构建时若 `VITE_SITE_URL` 的主机名为 **`myjob.com`** 或 **`www.myjob.com`**，候选人付费墙 **默认关闭**，与 `import.meta.env.MODE`、是否误配了其他变量无关。

只有在 Cloudflare **正式项目**里显式设置：

- `VITE_ALLOW_CONTACT_PAYWALL_IN_PRODUCTION=true`

之后，正式站才会允许按现有逻辑再判断是否展示付费墙（届时你可能还要配合 `VITE_ENABLE_CANDIDATE_PAYWALL` 等，以你上线时的约定为准）。

**结论**：合并 `main`、部署正式站时，**不要**在正式环境加上述变量，支付就不会对用户可见。

测试 / Staging（`*.pages.dev`、`staging` 域名、`build:staging` 等）**不受**该开关影响，行为与现在一致。

---

## 支付相关代码清单（改支付优先看这些）

| 区域 | 路径 |
|------|------|
| 是否启用付费墙 | `src/lib/candidatePaywallEnv.ts` |
| 卡片弹窗、跳转支付页 | `src/components/CandidateCard.tsx` |
| 独立结账页 UI | `src/pages/PagoCandidato.tsx` |
| 路由 | `src/App.tsx`（`/pago-candidato`） |
| 支付成功回跳解锁 | `src/pages/CandidateSearch.tsx`、`src/lib/candidateContactUnlock.ts` |
| 创建 Airwallex 链接 | `supabase/functions/airwallex-create-checkout/` |
| 环境变量类型 | `src/vite-env.d.ts` |
| Staging 接入说明 | `docs/airwallex-staging-candidate-paywall-zh.md` |

---

## 分支与工作流建议

- **日常功能**：继续在 `staging` 开发，合并到 `main` 发正式站即可；支付在正式站保持关闭（不配 `VITE_ALLOW_CONTACT_PAYWALL_IN_PRODUCTION`）。
- **继续迭代支付**：在同一分支改上表文件即可；测试用 **Staging Cloudflare + Staging Supabase**，不必动正式变量。
- 若希望支付与别的功能 **提交历史分离**，可长期使用分支名如 `feature/contact-paywall`，完成后再合并进 `staging`；与「正式站防护」独立——**即使整支合并进 `main`，正式域名仍不会开支付**，除非你加了正式站主开关。

---

## 正式上线支付前检查清单

1. Airwallex / 订单 / Webhook 等业务已验收完毕。
2. 正式环境变量中设置 `VITE_ALLOW_CONTACT_PAYWALL_IN_PRODUCTION=true`（及届时需要的金额、Supabase 生产密钥等）。
3. 配置后再部署一次 **production** `npm run build` 项目。
4. 用无痕窗口打开 `https://myjob.com/buscar-candidatos` 做一次完整支付与回跳验证。
