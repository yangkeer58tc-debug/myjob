# 职位内容改写方案（扒站 / 聚合来源）v2

> **给机器执行用**：下文包含**固定 JSON 输入/输出**、**可复制 Prompt**、**硬性禁区**；按此执行时，AI 应能稳定产出**格式统一、事实不漂移、对 SEO 偏正向**的 es-MX 正文。  
> **给 SEO 用**：正向影响来自「**有用、具体、与结构化数据一致、页面间有差异**」，而非关键词堆砌；并与站内 **JobPosting JSON-LD**、标题/城市等字段**对齐**，避免「页面说一套、结构化数据说一套」导致软 404 / 富结果降级。

---

## 〇、AI 执行总规则（违反任一条则整段输出作废）

1. **输出语言**：西班牙语 **墨西哥变体（es-MX）**；品牌名、产品名、证书缩写保持来源常用写法。  
2. **事实源优先级**：`structured`（JSON 里的结构化字段）**严格高于** `raw_text`（原文）。二者冲突时，**只采信 structured**，并在 `notes` 里用西班牙语写一句说明（见输出 JSON）。  
3. **禁止编造**：不得新增 structured 与 raw_text 均未出现的：薪资、地点、班次、证书、福利、编制类型、远程/现场承诺。  
4. **禁止空泛 SEO 模板**：不得输出可套在任何职位上的万能段（例如整段「Somos una empresa líder en el mercado…」而无具体业务）。  
5. **输出形态**：除非调用方约定只要正文，否则使用 **第七节「输出 JSON」** 完整对象，便于程序入库与质检。

---

## 一、适用范围与原则

| 维度 | 说明 |
|------|------|
| **适用** | 从外部抓取、导入的 JD 正文、任职要求、福利描述等**自由文本** |
| **原则上不改写（或仅规范化空格/标点）** | 公司法定/展示名称、官网、对外电话/WhatsApp、**structured 中的薪资数字与币种**、**城市/地点**、职位类型（全职/兼职等） |
| **禁止** | 编造未出现的薪资、地点、班次、证书；误导招聘主体；歧视性用语 |
| **对 SEO 的底线** | 单页正文总字符（去空白）建议 **≥ 400**（含列表），避免大量「改写后反而更短」的薄内容；单页与单页之间**禁止**共用同一长段 boilerplate（见 十·反模式） |

---

## 二、信息分层（改写前先归类）

| 层级 | 内容 | AI 如何处理 |
|------|------|-------------|
| **A 结构化事实** | 公司名、城市、薪资、工作模式、类别等 | **写入正文时仅复述或略写，数值与 structured 完全一致** |
| **B 半结构化** | 学历、经验年限、技能列表 | 可合并为列表，**不可增删硬性条件含义** |
| **C 叙述层** | 公司介绍、岗位概述、营销套话 | **主要改写对象**：换句式、换顺序、具体化 |

---

## 三、输出格式规范（Markdown，入库前形态）

### 3.1 固定区块标题（必须按顺序出现，且用下列**原文**作标题行）

AI **必须**使用下面五行作为小节引导（便于渲染与抽检；不要用 `#` 标题）：

```markdown
**Resumen del puesto**

**Qué harás**

**Requisitos**

**Ofrecemos**（若 structured/raw 均无任何福利信息，则写一行：`*Información de prestaciones no disponible.*` 勿编造）

**Detalles del trabajo**
```

### 3.2 各块内容规则

| 区块 | 格式 | 长度与 SEO 要求 |
|------|------|----------------|
| **Resumen del puesto** | 1～2 段纯文本 | 含 **职位核心词 1 次** + **城市或区域名 1 次**（须与 `structured.city` 或 `structured.location` 一致）；**80～220 个单词**量级（西班牙语词），信息密度高、少用形容词堆砌 |
| **Qué harás** | `- ` 无序列表，**4～8 条** | 每条以动词现在时/不定式开头（如 *Atender*, *Registrar*, *Coordinar*）；写**具体动作或对象**，禁止 5 条以上空洞套话 |
| **Requisitos** | `- ` 列表，**4～10 条** | 与原文要求**一一对应或合并**，不得新增「必备」条件 |
| **Ofrecemos** | `- ` 列表或短段 | 仅写**有依据**的福利；没有则按上节占位句 |
| **Detalles del trabajo** | 单行或多行短列表 | 必须显式写出：`Modalidad:`（与 structured 一致）、`Ubicación:`（与城市一致）；若有 `salary_text` 则复述**完全相同数字与币种** |

### 3.3 Markdown 技术约定

- 列表统一 `- `，**最多一级**子列表（子项前加两个空格）。  
- **不要使用** HTML `<h1>`～`<h3>`；小节仅用上述 `**粗体**` 标题行。  
- 段落之间**空一行**。  
- **不要**在正文里塞 `#Empleo #CDMX` 这类标签云。  
- **链接**：仅当 `structured.company_url` 存在且为 http(s) 时，在 **Detalles** 末尾可加一行 `Sitio de la empresa: <url>`；否则不加链接。

### 3.4 与站内 SEO / JobPosting 的一致性（必读）

站内详情页会向 Google 输出 **JobPosting** 等结构化数据，字段来自 DB。改写后的**可见正文**应满足：

- **职位名、城市、薪资（若展示）、工作模式**与数据库及页面标题**不矛盾**；否则易出现「富结果无效」或算法不信任。  
- 不要在正文写「Sin experiencia」若 structured 要求经验；不要写「100% remoto」若 structured 为现场。  
- **薪资**：若 structured 有明确金额，正文 **Detalles** 中应出现同一金额（允许格式差异如 `MXN $12,000` vs `12,000 MXN`，数字须一致）。

---

## 四、操作步骤（人 + AI 流水线）

### 步骤 A：预处理（程序或人）

1. 去掉导航、页脚、分享按钮、重复法律全文（可压缩为一句）。  
2. UTF-8 修复（如 `Ã³` → `ó`）。  
3. 组装 **第七节输入 JSON**，`structured` 填全；`raw_text` 放清洗后的原文。

### 步骤 B：AI 改写

使用 **第八节 Prompt**（System + User），温度建议 **0.3～0.5**；批量时对同一模型固定版本以便回归。

### 步骤 C：自动质检（程序）

- `body_markdown` 去空白后长度 ≥ **400** 字符（可按业务调到 350）。  
- 必须包含小节标题：`**Resumen del puesto**` …（完整五段标题）。  
- `structured.salary_amount` 若有值，正文中须出现**相同阿拉伯数字**子串。  
- `structured.city` 或 `location` 若有值，正文 **Resumen** 或 **Detalles** 须出现该市/该区核心词（允许无重音匹配规则由程序实现）。

### 步骤 D：人工抽检（比例如 2%）

使用 **第十一节 QA**；抽检不通过则调整 Prompt 或加黑名单短语。

---

## 五、对 SEO「偏正向」的机制说明（给产品/运营）

| 机制 | 说明 |
|------|------|
| **降低重复与镜像感** | 与来源站长文本脱钩，减少「聚合镜像」类信号（需配合站内 canonical、稳定 URL）。 |
| **提高信息增益** | 列表化职责与要求，便于用户与爬虫理解「这份工作具体做什么」——对齐 Google「有用内容」导向。 |
| **与结构化数据一致** | 减少软 404 / 结构化警告（薪资、地址类字段与可见内容不一致时 Google 常降级）。 |
| **页面间差异** | 每帖独立动词与场景，避免全站同一段「公司简介」——降低「门页/薄页」风险。 |

**不保证**：排名上升幅度、收录量；**仍依赖**整站技术 SEO、索引、外链与竞争环境。

---

## 六、LLM 输入 JSON（契约 · 调用方必须提供）

```json
{
  "job_id": "string",
  "structured": {
    "title": "string",
    "company_name": "string",
    "city": "string | null",
    "location": "string | null",
    "workplace_type": "presencial | remoto | hibrido | null",
    "job_type": "string | null",
    "salary_amount": "string | null",
    "salary_currency": "MXN | null",
    "category": "string | null",
    "company_url": "string | null",
    "requirements_bullets": ["string"],
    "benefits_bullets": ["string"]
  },
  "raw_text": "string",
  "locale": "es-MX"
}
```

说明：

- `requirements_bullets` / `benefits_bullets` 若已有结构化提取，AI **优先**据此写 **Requisitos** / **Ofrecemos**，`raw_text` 作补充；若为空则从 `raw_text` 抽取，**不得发明**。  
- `salary_amount` 为 `null` 时，正文**不要写具体数字**，可写「Rango no publicado」或「Salario a convenir según entrevista」等中性句（与站内展示策略一致即可）。

---

## 七、LLM 输出 JSON（契约 · AI 必须遵守）

```json
{
  "job_id": "string",
  "body_markdown": "string",
  "notes": "string | null"
}
```

- `body_markdown`：**仅** Markdown 正文，符合 **第三节** 结构；**不要**外层 JSON 或代码围栏包在 `body_markdown` 里。  
- `notes`：无冲突写 `null`；有 structured/raw 冲突时用 **一句西班牙语** 说明已以 structured 为准。

---

## 八、可复制 Prompt（推荐整块作为 System；User 仅发 JSON）

下列英文指令用于约束模型行为（对多数模型比纯中文更稳）；**用户消息只粘贴第六节完整 JSON**。

```text
You are a professional HR copywriter for the Mexican job market. You rewrite job descriptions for clarity and uniqueness without changing factual employment data.

INPUT: You receive a single JSON object with keys job_id, structured, raw_text, locale. All factual claims MUST follow `structured` when it conflicts with `raw_text`.

OUTPUT: Return ONLY a valid JSON object with keys job_id (same as input), body_markdown (string), notes (string or null). No markdown fences around the whole response. The body_markdown must be in Spanish (Mexico).

body_markdown rules:
1) Use EXACTLY these five section headers in order, each on its own line: **Resumen del puesto**, **Qué harás**, **Requisitos**, **Ofrecemos**, **Detalles del trabajo**
2) Resumen: 1-2 short paragraphs, include the job title meaning and city/location once if provided in structured.
3) Qué harás: 4-8 bullet lines starting with action verbs; concrete tasks only.
4) Requisitos: cover every requirement implied by structured.requirements_bullets and/or raw_text; do not add new hard requirements.
5) Ofrecemos: use structured.benefits_bullets and/or raw_text only. If none, output exactly one bullet: *Información de prestaciones no disponible.*
6) Detalles del trabajo: state modalidad aligned with structured.workplace_type and ubicación aligned with structured.city/location. If structured.salary_amount is non-null, repeat the same numeric amount and currency in plain text. If salary is null, do not invent numbers.
7) No HTML headings. No keyword stuffing. No generic leadership/marketing fluff paragraphs. No hashtags.
8) Minimum length: body_markdown should be substantial (aim >= 450 Spanish words total across all sections unless raw_text is extremely short; if raw_text is under 120 words, still expand using only given facts by clarifying wording, not inventing facts).

If any fact is missing, omit it rather than guessing.
```

**User 消息示例**：

```text
Rewrite the following job JSON per your rules. Output JSON only.

{ ...paste 第六节 JSON here... }
```

---

## 九、模型与参数建议（便于工程落地）

| 项 | 建议 |
|----|------|
| 温度 | **0.3～0.5**（改写忠实度优先） |
| 输出格式 | 若平台支持 `response_format` JSON schema，对 **第七节** 三键做 schema 约束 |
| 失败重试 | 解析 JSON 失败或缺标题时重试 1 次，仍失败则标记 `rewrite_failed` 人工处理 |

---

## 十、SEO 反模式（AI 常见错误 · 一律禁止）

| 反模式 | 后果 |
|--------|------|
| 全站/大批职位共用同一段「公司简介」 | 重复内容、门页特征 |
| 在正文重复写城市名/职位名 10+ 次 | 关键词堆砌，可能被降质 |
| 正文薪资与 DB / JobPosting 不一致 | 富结果警告或无效 |
| 改写后比原文短 50% 以上且无列表 | 薄内容风险上升 |
| 编造「certificación oficial」「contrato indefinido desde el primer día」 | 合规与信任风险，间接伤 SEO |

---

## 十一、QA 验收清单（人工 + 程序）

**程序自动**

- [ ] 输出为合法 JSON，且含 `body_markdown`  
- [ ] 五个 `**...**` 小节标题齐全且顺序正确  
- [ ] 长度 ≥ 调用方阈值（建议 400+ 字符）  
- [ ] 若有 `salary_amount`，正文含相同数字串  
- [ ] 无 `http` 链接或仅允许 `company_url`  

**人工抽检**

- [ ] 读 **Resumen**：是否一眼看懂「谁招、什么岗、在哪」  
- [ ] 每条 **Requisitos** 能在原文或 structured 找到依据  
- [ ] **Ofrecemos** 无「空头支票」  
- [ ] 与页面 **title / meta description** 计划不冲突（若 title 由 title 字段生成，正文勿用矛盾职称）

---

## 十二、与站内产品策略的衔接

- 详情页 **`created_at` 起 90 天** 内仍参与索引与 JobPosting 等逻辑；改写**不**改变 `created_at`。  
- 若未来引入 `content_refreshed_at`，可用于展示「信息更新于」及内部质检，**本契约无需改字段名**，仅在输入 JSON 中扩展即可。

---

## 十三、文档维护

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2026-05 | 首版 |
| 2.0 | 2026-05 | AI 可执行契约、完整 Prompt、SEO 对齐 JobPosting、反模式与自动质检 |

法务（墨西哥招聘广告、反歧视）若有单独红线，在 **步骤 D** 后增加法务签字环节即可。
