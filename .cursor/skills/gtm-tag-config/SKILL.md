---
name: gtm-tag-config
description: 为网站配置 GTM + GA4 埋点（极详细、傻瓜式逐步操作），包含全站 contact_click 统一方案与验收流程。适用于让 OpenClaw 或新手照单执行。
---

# GTM/GA4 埋点配置 Skill（超详细）

> 目标：把网站“能加埋点的入口”统一接入 GA4，尤其是 Contact 类按钮，做到：
> 1) 事件统一命名  
> 2) 能按页面和按钮位置区分  
> 3) 可在 GTM Preview、GA4 DebugView、GA4 Realtime 三端验证通过

---

## 0. 执行原则（必须遵守）

1. **先统一命名，再配置标签**，不要先随便建一堆 Tag。
2. **先跑通一个事件闭环，再批量复制**，避免全量错误。
3. 每完成一个阶段，必须做验证，不验证不进入下一步。
4. 一律使用 `contact_click` 作为“联系类按钮”的统一事件名。
5. 一个事件的区分维度优先靠参数，不靠事件名爆炸。

---

## 1. 你要准备什么（执行前检查）

### 1.1 账户与工具
- 有 GTM 容器编辑权限（Edit）和发布权限（Publish）
- 有 GA4 属性查看权限（至少可看 DebugView/Realtime）
- 能打开网站线上地址（推荐正式域名）

### 1.2 已知信息
- GTM Container ID（例：`GTM-XXXXX`）
- GA4 Measurement ID（例：`G-P4HX3SXHS4`）
- 网站主域名（例：`https://myjob.com`）

### 1.3 浏览器要求
- 先关掉广告拦截插件（AdBlock/uBlock）
- 用无痕窗口做最终验收

---

## 2. 先定义事件规范（先做，不可跳过）

## 2.1 统一事件名
- 联系行为统一：`contact_click`

## 2.2 统一参数（最少字段）
- `contact_channel`：联系渠道（如 `whatsapp`、`phone`、`email`）
- `contact_location`：按钮位置（如 `job_detail_apply_button`）
- `page_path`：页面路径（如 `/empleo/abc`）
- `source`：来源模块（如 `job_detail`、`footer`）

## 2.3 推荐附加参数（可选）
- `job_id`
- `job_title`
- `company_name`
- `candidate_id`
- `candidate_role`

---

## 3. 前端埋点标准（代码侧）

> 如果前端已实现可跳过；否则按此标准补齐。

## 3.1 push 规范（必须）
前端必须向 `window.dataLayer` 推送：

```js
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: "contact_click",
  contact_channel: "whatsapp",
  contact_location: "job_detail_apply_button",
  source: "job_detail",
  page_path: window.location.pathname + window.location.search
});
```

## 3.2 不允许的写法
- 不要把 Measurement ID 写成变量（如 `{{DLV - contact_location}}`）
- 不要为每个按钮单独建事件名（如 `footer_contact_click`、`detail_contact_click`）
- 不要只在 GTM 用 Click Trigger“猜”按钮，优先前端显式 push

---

## 4. GTM 配置（逐点击说明）

> 以下操作在 GTM 网页后台完成。每一步完成后先保存再下一步。

## 4.1 创建/确认变量（Variables）

进入：`GTM -> 左侧 Variables`

### 4.1.1 创建 `DLV - contact_channel`
1. 点 `New`
2. Variable Type 选 `Data Layer Variable`
3. Variable Name 填：`DLV - contact_channel`
4. Data Layer Variable Name 填：`contact_channel`
5. Data Layer Version 选 `Version 2`
6. 点 `Save`

### 4.1.2 创建 `DLV - contact_location`
1. 点 `New`
2. Type: `Data Layer Variable`
3. Variable Name: `DLV - contact_location`
4. Data Layer Variable Name: `contact_location`
5. Version: `Version 2`
6. `Save`

### 4.1.3 创建 `DLV - source`
1. 点 `New`
2. Type: `Data Layer Variable`
3. Variable Name: `DLV - source`
4. Data Layer Variable Name: `source`
5. Version: `Version 2`
6. `Save`

### 4.1.4 创建可选变量（业务字段）
按同样方法建立：
- `DLV - job_id` -> `job_id`
- `DLV - job_title` -> `job_title`
- `DLV - company_name` -> `company_name`
- `DLV - candidate_id` -> `candidate_id`
- `DLV - candidate_role` -> `candidate_role`

### 4.1.5 启用内置变量 `Page Path`
1. 在 Variables 页面点 `Configure`（Built-In Variables）
2. 勾选 `Page Path`（若已勾选跳过）

---

## 4.2 创建统一触发器（Trigger）

进入：`GTM -> 左侧 Triggers -> New`

1. Trigger Name：`TR - contact_click - all`
2. Trigger Type：`Custom Event`
3. Event Name：`contact_click`
4. This trigger fires on：选 `All Custom Events`
5. 点 `Save`

> 注意：这里不要加 `contact_location equals xxx`，否则只能统计一个位置。

---

## 4.3 创建 Google tag（如果容器没有）

> 如果你的 GA4 Event Tag 页面出现 “No Google tag found in this container”，建议先做这一步。

进入：`GTM -> Tags -> New`

1. Tag Name：`GA4 - Google tag - all pages`
2. Tag Type：`Google tag`
3. Tag ID 填：你的 Measurement ID（例 `G-P4HX3SXHS4`）
4. Trigger 选：`All Pages`
5. `Save`

---

## 4.4 创建统一 GA4 Event Tag

进入：`GTM -> Tags -> New`

1. Tag Name：`GA4 - Event - contact_click - all`
2. Tag Type：`Google Analytics: GA4 Event`
3. 配置方式二选一：
   - 方式 A：选择 `Configuration Tag = GA4 - Google tag - all pages`
   - 方式 B：直接填写 `Measurement ID = G-P4HX3SXHS4`
4. Event Name 填：`contact_click`
5. Event Parameters 添加：
   - `contact_channel` -> `{{DLV - contact_channel}}`
   - `contact_location` -> `{{DLV - contact_location}}`
   - `source` -> `{{DLV - source}}`
   - `page_path` -> `{{Page Path}}`
   - 可选：`job_id` -> `{{DLV - job_id}}` 等
6. Trigger 绑定：`TR - contact_click - all`
7. `Save`

---

## 4.5 去重（避免重复上报）

进入：`GTM -> Tags / Triggers`

1. 查找旧的“只针对某个页面”的 `contact_click` 标签
2. 处理方式二选一：
   - 删除旧触发器绑定，仅保留统一触发器
   - 或暂停旧标签（Pause）
3. 最终目标：**只保留一个主力 contact_click 事件标签在发送**

---

## 5. 预览验证（必须逐项）

进入：`GTM -> Preview`，输入网站 URL 开始调试。

## 5.1 必测入口清单（至少 4 个）
- 详情页申请按钮（示例 `job_detail_apply_button`）
- 职位卡申请按钮（示例 `job_card_apply_button`）
- Footer 联系按钮（示例 `footer_contact_link`）
- 候选人卡联系按钮（示例 `candidate_card_hire_button`）

## 5.2 每个入口必须检查 4 件事
1. 左侧事件流出现 `contact_click`
2. `Tags` 页签里 `GA4 - Event - contact_click - all` 显示 `Fired`
3. `Variables` 页签里：
   - `DLV - contact_location` 有值且正确
   - `Page Path` 有值
4. `G-P4...` 页签（GA4）里看到对应 hit

---

## 6. GA4 端验证（必须）

## 6.1 DebugView（优先看）
进入：`GA4 -> Admin -> DebugView`

1. 保持 Tag Assistant 连接状态
2. 在网页点一次 contact 按钮
3. 确认 DebugView 出现 `contact_click`

## 6.2 Realtime（二次确认）
进入：`GA4 -> Reports -> Realtime`
确认出现 `contact_click`

## 6.3 事件报表延迟说明
标准事件报表会延迟，不要用它做即时验证。

---

## 7. 发布上线（GTM）

1. GTM 右上角点 `Submit`
2. Version Name 填：`feat: unified contact_click tracking`
3. Description 填：
   - `统一 contact_click`
   - `参数：contact_channel/contact_location/source/page_path`
   - `完成 Preview + DebugView 验证`
4. 点 `Publish`

---

## 8. GA4 自定义维度注册（报表可分析）

进入：`GA4 -> Admin -> Custom definitions -> Create custom dimension`

至少创建以下 Event-scoped 维度：
- `contact_location`
- `contact_channel`
- `source`
- `page_path`

可选：
- `job_id`
- `job_title`
- `company_name`
- `candidate_id`
- `candidate_role`

> 注意：通常只对创建后的新数据生效，不回填历史。

---

## 9. 常见错误与修复（快速排障）

## 错误 1：GTM 里 Fired，但 GA4 没有 `contact_click`
排查：
1. GA4 Event Tag 的 Measurement ID 是否写成 `G-...`（不能写变量）
2. Event Name 是否准确为 `contact_click`
3. Consent 是否拒绝了 analytics_storage
4. 浏览器插件是否拦截请求

## 错误 2：看到 `No Google tag found in this container`
修复：
- 新建 `Google tag`（All Pages），再让 Event Tag 复用它

## 错误 3：参数没值
排查：
1. Data Layer key 名是否完全一致（大小写）
2. 变量是否选了正确 DLV
3. 前端 push 是否真的带了该字段

## 错误 4：重复上报
排查：
- 是否存在多个 contact_click Event Tag 同时 Fired
- 是否旧 Trigger 没清理

---

## 10. OpenClaw 执行模板（可直接照抄）

给 OpenClaw 的指令建议：

1. 先读取本 Skill 文档并逐条执行，不允许跳步。  
2. 优先检查变量完整性：`DLV - contact_channel/contact_location/source + Page Path`。  
3. 仅保留一个统一 Trigger：`TR - contact_click - all`。  
4. 仅保留一个主事件 Tag：`GA4 - Event - contact_click - all`。  
5. 完成 Preview 后，逐入口输出验证结果表格（入口、是否触发、contact_location 值、page_path 值）。  
6. DebugView 验证通过后再发布。  
7. 若遇到阻塞，必须明确卡点、当前页面、下一步最小人工动作。  

---

## 11. 完成标准（Definition of Done）

只有同时满足以下条件才算完成：

1. GTM Preview 中 4 个入口都触发 `contact_click`
2. 每个入口 `contact_location` 值正确
3. `page_path` 均有值
4. GA4 DebugView 看见 `contact_click`
5. GTM 已发布新版本
6. 已在 GA4 注册关键自定义维度

---

如果你要扩展到注册、登录、筛选、提交简历等事件，沿用这份 Skill：  
**统一事件名 + 参数区分 + 单标签汇总 + 三端验证（Preview/DebugView/Realtime）**。
