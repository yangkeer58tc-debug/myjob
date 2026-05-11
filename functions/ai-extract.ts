type ExtractResult = {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  country?: string | null
  city?: string | null
  email?: string | null
  whatsapp?: string | null
  phone?: string | null
  work_years?: number | null
  education?: unknown[] | null
  intro_summary_original?: string | null
  intro_language?: string | null
  profile_summary?: string | null
  profile_summary_language?: string | null
  job_direction?: string | null
}

function json(data: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function pickJsonObject(s: string) {
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return s.slice(start, end + 1)
}

function asString(v: unknown, max = 500) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function cleanSummary(s: string) {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return t
  const endsWithPunct = /[.!?。！？]$/.test(t)
  const lastPunct = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'), t.lastIndexOf('。'), t.lastIndexOf('！'), t.lastIndexOf('？'))
  if (!endsWithPunct && lastPunct >= 0 && t.length - lastPunct <= 20) {
    const cut = t.slice(0, lastPunct + 1).trim()
    if (cut) return cut
  }
  return endsWithPunct ? t : `${t}.`
}

function asNumberInt(v: unknown, min: number, max: number) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.trunc(v)
  if (n < min || n > max) return null
  return n
}

function normalizeResult(obj: any): ExtractResult {
  const out: ExtractResult = {}
  out.full_name = asString(obj?.full_name, 120)
  out.first_name = asString(obj?.first_name, 80)
  out.last_name = asString(obj?.last_name, 80)
  out.country = asString(obj?.country, 80)
  out.city = asString(obj?.city, 80)
  out.email = asString(obj?.email, 200)
  out.whatsapp = asString(obj?.whatsapp, 80)
  out.phone = asString(obj?.phone, 80)
  out.work_years = asNumberInt(obj?.work_years, 0, 60)
  out.intro_summary_original = asString(obj?.intro_summary_original, 900)
  out.intro_language = asString(obj?.intro_language, 12)
  out.education = Array.isArray(obj?.education) ? obj.education.slice(0, 12) : null
  const rawProfile = asString(obj?.profile_summary, 1200)
  out.profile_summary = rawProfile ? cleanSummary(rawProfile) : null
  out.profile_summary_language = asString(obj?.profile_summary_language, 12)
  out.job_direction = asString(obj?.job_direction, 60)
  return out
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function onRequestGet(context: { env: Record<string, string | undefined> }) {
  const { env } = context
  const baseUrl = env.LLM_BASE_URL || null
  const model = env.LLM_MODEL || 'gpt-4o-mini'
  const configured = Boolean(env.LLM_API_KEY && env.LLM_BASE_URL)
  return json({ success: true, configured, meta: { model, base_url: baseUrl } })
}

export async function onRequestPost(context: { request: Request; env: Record<string, string | undefined> }) {
  const { request, env } = context

  const apiKey = env.LLM_API_KEY
  const baseUrl = env.LLM_BASE_URL
  const model = env.LLM_MODEL || 'gpt-4o-mini'

  if (!apiKey || !baseUrl) {
    return json(
      {
        success: false,
        error: 'Missing LLM_API_KEY or LLM_BASE_URL',
        meta: { model, base_url: baseUrl || null },
      },
      { status: 501 },
    )
  }

  let bodyRaw: unknown
  try {
    bodyRaw = await request.json()
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const anyBody = bodyRaw as any
  const text = typeof anyBody?.text === 'string' ? anyBody.text : ''
  const filename = typeof anyBody?.filename === 'string' ? anyBody.filename : ''
  if (!text.trim() || text.length > 30000) {
    return json({ success: false, error: 'Invalid request body' }, { status: 400 })
  }

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
    '- profile_summary MUST be a recruiter-facing summary in Spanish (Mexico), 100-200 words; do NOT directly copy long sentences; do not invent facts; include role, seniority, key skills, domain, and location if present. It must end with a complete sentence. Set profile_summary_language to "es-MX".'
    +
    '\n- job_direction MUST be a short Mexican-Spanish category inferred from roles (e.g., Chofer, Cocinero, Guardia de seguridad, Personal de limpieza, Almacén, Auxiliar administrativo). If unclear, return null.'

  const base = baseUrl.replace(/\/$/, '')
  const url = base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions'

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => '')
    return json({ success: false, error: `LLM request failed: ${upstream.status} ${msg}` }, { status: 502 })
  }

  const data = (await upstream.json().catch(() => null)) as any
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    return json({ success: false, error: 'LLM returned empty content' }, { status: 502 })
  }

  const maybeJson = pickJsonObject(content.trim())
  if (!maybeJson) {
    return json({ success: false, error: 'LLM output is not JSON' }, { status: 502 })
  }

  let obj: unknown
  try {
    obj = JSON.parse(maybeJson)
  } catch {
    return json({ success: false, error: 'Failed to parse LLM JSON' }, { status: 502 })
  }

  return json({
    success: true,
    data: normalizeResult(obj as any),
    meta: {
      model,
      base_url: baseUrl,
      input_chars: text.length,
    },
  })
}
