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
  const lastPunct = Math.max(
    t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'),
    t.lastIndexOf('。'), t.lastIndexOf('！'), t.lastIndexOf('？'),
  )
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

const SYSTEM_PROMPT =
  'You are a resume parsing engine. Extract only information explicitly supported by the resume content. Do not guess. Output ONLY valid JSON, no markdown.'

function buildUserInstructions(filename: string, textOrHint: string, hasImage: boolean) {
  const head = hasImage
    ? `Resume filename: ${filename || ''}\nResume file is attached as an image/PDF. Read the document carefully (it may be a scanned page, photo, or image-only PDF). Use OCR if needed.\n\n`
    : `Resume filename: ${filename || ''}\nResume text:\n${textOrHint}\n\n`
  return (
    head +
    'Return JSON with keys: full_name, first_name, last_name, country, city, email, whatsapp, phone, work_years, education, intro_summary_original, intro_language, profile_summary, profile_summary_language, job_direction. Use null when unknown.\n' +
    '- full_name should be the display name exactly as written (keep diacritics).\n' +
    '- first_name/last_name should be split if possible (given name vs family name). Keep diacritics.\n' +
    '- If unsure about given/family order, set first_name/last_name to null but still return full_name.\n' +
    '- country should be a country name (e.g., United Arab Emirates) or ISO-2 if clearly present; do not guess.\n' +
    '- city should be the city part of location if present; do not guess.\n' +
    '- work_years MUST be derived from explicit date ranges in the WORK EXPERIENCE/EXPERIENCE section only (ignore EDUCATION years); use current year for Present; if ranges are missing, return null.\n' +
    '- For scanned/photo resumes, OCR the visible text and prioritize lines near headings like NAME/CONTACT/LOCATION/ABOUT/EXPERIENCE.\n' +
    '- intro_summary_original MUST be rewritten in neutral Spanish used in Mexico (es-MX), concise and professional.\n' +
    '- profile_summary MUST be a recruiter-facing summary in Spanish (Mexico), 100-200 words; do NOT directly copy long sentences; do not invent facts; include role, seniority, key skills, domain, and location if present. It must end with a complete sentence. Set profile_summary_language to "es-MX".\n' +
    '- job_direction MUST be a short Mexican-Spanish category inferred from roles (e.g., Chofer, Cocinero, Guardia de seguridad, Personal de limpieza, Almacén, Auxiliar administrativo). If unclear, return null.\n' +
    '- Do not return anything that is not supported by the actual resume content. If almost nothing is readable, return mostly nulls.'
  )
}

// Cloudflare Workers run with a tight CPU budget; cap multimodal payloads.
// 6.5M b64 chars ≈ ~5 MB raw file; safely under upstream limits.
const MAX_MM_B64_CHARS = 6_500_000

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
])

function isGeminiBaseUrl(baseUrl: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl)
}

/**
 * Gemini Native multimodal — needed for PDFs, since the OpenAI-compat shim
 * rejects `data:application/pdf;...` image_url payloads.
 */
async function callGeminiNative(opts: {
  apiKey: string
  baseUrl: string
  model: string
  mime: string
  b64: string
  instructions: string
}): Promise<string> {
  const root = opts.baseUrl
    .replace(/\/+$/, '')
    .replace(/\/v1beta\/openai$/i, '/v1beta')
    .replace(/\/v1$/i, '/v1beta')
  const url = `${root}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: opts.mime, data: opts.b64 } },
          { text: `${SYSTEM_PROMPT}\n\n${opts.instructions}` },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => '')
    throw new Error(`gemini_native_${upstream.status}: ${msg.slice(0, 400)}`)
  }
  const data = await upstream.json().catch(() => null) as any
  const parts = data?.candidates?.[0]?.content?.parts
  if (Array.isArray(parts)) {
    const joined = parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
    if (joined) return joined
  }
  throw new Error('gemini_native_empty')
}

/** OpenAI Vision via chat/completions — for images on any OpenAI-compat backend. */
async function callOpenAIVision(opts: {
  apiKey: string
  baseUrl: string
  model: string
  mime: string
  b64: string
  instructions: string
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions'
  const dataUrl = `data:${opts.mime};base64,${opts.b64}`

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.instructions },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  })

  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => '')
    throw new Error(`openai_vision_${upstream.status}: ${msg.slice(0, 400)}`)
  }
  const data = await upstream.json().catch(() => null) as any
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content
  throw new Error('openai_vision_empty')
}

/** Plain text via OpenAI-compat chat/completions — original behavior. */
async function callOpenAIText(opts: {
  apiKey: string
  baseUrl: string
  model: string
  instructions: string
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions'

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: opts.instructions },
      ],
    }),
  })

  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => '')
    throw new Error(`openai_text_${upstream.status}: ${msg.slice(0, 400)}`)
  }
  const data = await upstream.json().catch(() => null) as any
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content
  throw new Error('openai_text_empty')
}

function parseLlmJson(raw: string): { ok: true; obj: unknown } | { ok: false; error: string } {
  const maybeJson = pickJsonObject(raw.trim())
  if (!maybeJson) return { ok: false, error: 'LLM output is not JSON' }
  try {
    return { ok: true, obj: JSON.parse(maybeJson) }
  } catch {
    return { ok: false, error: 'Failed to parse LLM JSON' }
  }
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
  return json({
    success: true,
    configured,
    multimodal: configured && Boolean(baseUrl),
    meta: { model, base_url: baseUrl },
  })
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
  const imageB64 = typeof anyBody?.image_base64 === 'string' ? anyBody.image_base64 : ''
  const imageMime = typeof anyBody?.image_mime === 'string' ? anyBody.image_mime.toLowerCase() : ''

  const hasImage = imageB64.length > 0
  const hasUsefulText = text.trim().length > 0

  if (!hasImage && !hasUsefulText) {
    return json({ success: false, error: 'Invalid request body' }, { status: 400 })
  }
  if (text.length > 30000) {
    return json({ success: false, error: 'text_too_long' }, { status: 400 })
  }
  if (hasImage && imageB64.length > MAX_MM_B64_CHARS) {
    return json({ success: false, error: 'image_too_large' }, { status: 413 })
  }

  let route: 'text' | 'openai_vision' | 'gemini_native' = 'text'
  let raw: string
  try {
    if (hasImage) {
      const isPdf = imageMime === 'application/pdf'
      const isImage = SUPPORTED_IMAGE_MIMES.has(imageMime) || imageMime.startsWith('image/')
      if (!isPdf && !isImage) {
        return json({ success: false, error: `unsupported_mime:${imageMime || 'unknown'}` }, { status: 400 })
      }

      const instructions = buildUserInstructions(filename, text, true)

      if (isPdf) {
        if (!isGeminiBaseUrl(baseUrl)) {
          return json({
            success: false,
            error: 'pdf_multimodal_requires_gemini_base_url',
            meta: { model, base_url: baseUrl },
          }, { status: 501 })
        }
        route = 'gemini_native'
        raw = await callGeminiNative({ apiKey, baseUrl, model, mime: imageMime, b64: imageB64, instructions })
      } else {
        route = 'openai_vision'
        try {
          raw = await callOpenAIVision({ apiKey, baseUrl, model, mime: imageMime, b64: imageB64, instructions })
        } catch (err) {
          // Fall back to Gemini Native for images if the OpenAI Vision shim rejects.
          if (isGeminiBaseUrl(baseUrl)) {
            route = 'gemini_native'
            raw = await callGeminiNative({ apiKey, baseUrl, model, mime: imageMime, b64: imageB64, instructions })
          } else {
            throw err
          }
        }
      }
    } else {
      const safeText = text.trim().length ? text : '(No text could be extracted from this file; infer only from filename.)'
      const instructions = buildUserInstructions(filename, safeText, false)
      raw = await callOpenAIText({ apiKey, baseUrl, model, instructions })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json({
      success: false,
      error: `LLM request failed: ${message}`,
      meta: { model, base_url: baseUrl, route },
    }, { status: 502 })
  }

  const parsed = parseLlmJson(raw)
  if (!parsed.ok) {
    return json({ success: false, error: parsed.error, meta: { model, base_url: baseUrl, route } }, { status: 502 })
  }

  return json({
    success: true,
    data: normalizeResult(parsed.obj as any),
    meta: {
      model,
      base_url: baseUrl,
      route,
      input_chars: text.length,
      input_image_b64_chars: imageB64.length,
      input_image_mime: imageMime || null,
    },
  })
}
