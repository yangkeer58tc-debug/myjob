import type { AiExtractResult, AiExtractMeta, AiExtractResponse } from '@/modules/resumes/aiExtract.types'

export type { AiExtractMeta, AiExtractResponse, AiExtractResult } from '@/modules/resumes/aiExtract.types'

const pickJsonObject = (s: string) => {
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return s.slice(start, end + 1)
}

const openAiKey = () =>
  String(import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.LLM_API_KEY || '').trim()

const openAiBase = () =>
  String(
    import.meta.env.VITE_OPENAI_API_BASE_URL || import.meta.env.LLM_BASE_URL || 'https://api.openai.com/v1',
  )
    .trim()
    .replace(/\/$/, '')

const openAiModel = () =>
  String(import.meta.env.VITE_OPENAI_MODEL || import.meta.env.LLM_MODEL || 'gpt-4o-mini').trim()

function normalizeResult(obj: Record<string, unknown>): AiExtractResult {
  const asString = (v: unknown, max: number) => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    if (!t) return null
    return t.slice(0, max)
  }
  const asInt = (v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    const n = Math.trunc(v)
    if (n < min || n > max) return null
    return n
  }
  return {
    full_name: asString(obj.full_name, 120),
    first_name: asString(obj.first_name, 80),
    last_name: asString(obj.last_name, 80),
    country: asString(obj.country, 80),
    city: asString(obj.city, 80),
    email: asString(obj.email, 200),
    whatsapp: asString(obj.whatsapp, 80),
    phone: asString(obj.phone, 80),
    work_years: asInt(obj.work_years, 0, 60),
    education: Array.isArray(obj.education) ? obj.education.slice(0, 12) : null,
    intro_summary_original: asString(obj.intro_summary_original, 900),
    intro_language: asString(obj.intro_language, 12),
    profile_summary: asString(obj.profile_summary, 1200),
    profile_summary_language: asString(obj.profile_summary_language, 12),
    job_direction: asString(obj.job_direction, 60),
  }
}

/** 与 Cloudflare Pages `functions/ai-extract` 中 prompt 保持一致（便于行为对齐）。 */
function buildResumeExtractMessages(text: string, filename: string) {
  const system =
    'You are a resume parsing engine. Extract only information explicitly supported by the resume text. Do not guess. Output ONLY valid JSON, no markdown.'
  const user =
    `Resume filename: ${filename || ''}\n` +
    `Resume text:\n${text}\n\n` +
    'Return JSON with keys: full_name, first_name, last_name, country, city, email, whatsapp, phone, work_years, education, intro_summary_original, intro_language, profile_summary, profile_summary_language, job_direction. Use null when unknown.\n' +
    '- full_name should be the display name exactly as written (keep diacritics).\n' +
    '- first_name/last_name should be split if possible (given name vs family name). Keep diacritics.\n' +
    '- If unsure about given/family order, set first_name/last_name to null but still return full_name.\n' +
    '- country should be a country name (e.g., United Arab Emirates) or ISO-2 if clearly present; do not guess.\n' +
    '- city should be the city part of location if present; do not guess.\n' +
    '- work_years MUST be derived from explicit date ranges in the WORK EXPERIENCE/EXPERIENCE section only (ignore EDUCATION years); use current year for Present; if ranges are missing, return null.\n' +
    '- For OCR text, prioritize lines near headings like NAME/CONTACT/LOCATION/ABOUT/EXPERIENCE.\n' +
    '- intro_summary_original MUST be rewritten in neutral Spanish used in Mexico (es-MX), concise and professional.\n' +
    '- profile_summary MUST be a recruiter-facing summary in Spanish (Mexico), 100-200 words; do NOT directly copy long sentences; do not invent facts; include role, seniority, key skills, domain, and location if present. It must end with a complete sentence. Set profile_summary_language to "es-MX".' +
    '\n- job_direction MUST be a short Mexican-Spanish category inferred from roles (e.g., Chofer, Cocinero, Guardia de seguridad, Personal de limpieza, Almacén, Auxiliar administrativo). If unclear, return null.'

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

async function extractViaEdgeFunction(text: string, filename: string): Promise<AiExtractResponse | null> {
  try {
    const res = await fetch('/ai-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, filename }),
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      data?: AiExtractResult
      error?: string
      meta?: AiExtractMeta
    }
    if (res.ok && data?.success) {
      return { ok: true, data: data.data || {}, meta: data.meta }
    }
    return null
  } catch {
    return null
  }
}

async function extractViaBrowserLlm(text: string, filename: string): Promise<AiExtractResponse> {
  const apiKey = openAiKey()
  const baseUrl = openAiBase()
  const model = openAiModel()
  if (!apiKey || !baseUrl) {
    return { ok: false, error: 'Missing LLM_API_KEY or LLM_BASE_URL', meta: { model, base_url: baseUrl } }
  }
  if (!text.trim() || text.length > 30000) {
    return { ok: false, error: 'Invalid request body', meta: undefined }
  }

  const base = baseUrl.replace(/\/$/, '')
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  const messages = buildResumeExtractMessages(text, filename)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    }),
  })

  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    return { ok: false, error: `LLM request failed: ${res.status} ${msg.slice(0, 200)}`, meta: { model, base_url: baseUrl, input_chars: text.length } }
  }

  const raw = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> }
  const content = raw?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'LLM returned empty content', meta: { model, base_url: baseUrl, input_chars: text.length } }
  }

  const maybeJson = pickJsonObject(content.trim())
  if (!maybeJson) {
    return { ok: false, error: 'LLM output is not JSON', meta: { model, base_url: baseUrl, input_chars: text.length } }
  }

  let obj: unknown
  try {
    obj = JSON.parse(maybeJson)
  } catch {
    return { ok: false, error: 'Failed to parse LLM JSON', meta: { model, base_url: baseUrl, input_chars: text.length } }
  }

  return {
    ok: true,
    data: normalizeResult(obj as Record<string, unknown>),
    meta: { model, base_url: baseUrl, input_chars: text.length },
  }
}

/**
 * 生产环境优先走同源的 `/ai-extract`（Cloudflare Pages Function，密钥在服务端）；
 * 本地 `vite` 无该路由时会回退；若配置了 LLM_* / VITE_OPENAI_*，则浏览器直连（与职位 AI 导入一致，密钥会进前端包）。
 */
export async function aiExtract(text: string, filename?: string): Promise<AiExtractResponse> {
  const edge = await extractViaEdgeFunction(text, filename || '')
  if (edge?.ok) return edge
  return extractViaBrowserLlm(text, filename || '')
}
