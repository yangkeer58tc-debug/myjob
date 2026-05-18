/**
 * Cloudflare Pages Function: AI job content rewrite (Gemini / OpenAI-compat via LLM_* env).
 * Self-contained — do not import from src/ (not bundled for Pages Functions).
 */

const JOB_REWRITE_SYSTEM_PROMPT = `You are a professional HR copywriter for the Mexican job market. You rewrite job descriptions for clarity and uniqueness without changing factual employment data.

INPUT: You receive a single JSON object with keys job_id, structured, raw_text, locale, and optional boolean short_source (default false). All factual claims MUST follow structured when it conflicts with raw_text.

OUTPUT: Return ONLY a valid JSON object with keys job_id, title_rewritten, body_markdown, notes (string or null). No markdown fences around the whole response. Spanish Mexico (es-MX).

body_markdown must use EXACTLY these five section headers in order: **Resumen del puesto**, **Qué harás**, **Requisitos**, **Ofrecemos**, **Detalles del trabajo**

Follow length, salary, and anti-stuffing rules from the product spec. title_rewritten: SHORT es-MX listing title, role + optional city, target 28-42 chars, HARD MAX 48 chars (no company/benefits/long address), same job meaning as structured.title.

If any fact is missing, omit it rather than guessing.`;

const SECTION_HEADERS = [
  '**Resumen del puesto**',
  '**Qué harás**',
  '**Requisitos**',
  '**Ofrecemos**',
  '**Detalles del trabajo**',
];

function json(data: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function pickJsonObject(s: string) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return s.slice(start, end + 1);
}

function isGeminiBaseUrl(baseUrl: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

const TITLE_MAX_CHARS = 48;

function clampRewriteTitle(title: string): string {
  let s = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= TITLE_MAX_CHARS) return s;
  const window = s.slice(0, TITLE_MAX_CHARS + 1);
  for (const sep of [' - ', ' – ', ' | ', ', ', ' en ', ' · ', ' / ']) {
    const idx = window.lastIndexOf(sep);
    if (idx >= Math.floor(TITLE_MAX_CHARS * 0.45)) return s.slice(0, idx).trim();
  }
  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace >= Math.floor(TITLE_MAX_CHARS * 0.55)) return s.slice(0, lastSpace).trim();
  return s.slice(0, TITLE_MAX_CHARS).trim();
}

function stripForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateOutput(
  input: { job_id: string; short_source?: boolean; structured?: { salary_amount?: string | null; city?: string | null; location?: string | null }; raw_text: string },
  output: { job_id: string; title_rewritten: string; body_markdown: string },
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = String(output.body_markdown || '');
  const bodyCharCount = body.replace(/\s+/g, '').length;
  const minChars = input.short_source ? 450 : 800;

  if (output.job_id !== input.job_id) errors.push('job_id mismatch');
  if (!String(output.title_rewritten || '').trim()) errors.push('missing title_rewritten');
  for (const h of SECTION_HEADERS) {
    if (!body.includes(h)) errors.push(`missing section: ${h}`);
  }
  if (bodyCharCount < minChars) errors.push(`body too short (${bodyCharCount} < ${minChars})`);

  const salaryDigits = String(input.structured?.salary_amount || '').replace(/[^\d]/g, '');
  if (salaryDigits.length >= 3 && !body.includes(salaryDigits)) {
    errors.push('salary digits missing in body');
  }

  return { ok: errors.length === 0, errors, warnings, bodyCharCount };
}

async function callGeminiTextJson(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  user: string;
  temperature: number;
}): Promise<string> {
  const root = opts.baseUrl
    .replace(/\/+$/, '')
    .replace(/\/v1beta\/openai$/i, '/v1beta')
    .replace(/\/v1$/i, '/v1beta');
  const url = `${root}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${JOB_REWRITE_SYSTEM_PROMPT}\n\n${opts.user}` }] }],
      generationConfig: {
        temperature: opts.temperature,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => '');
    throw new Error(`gemini_${upstream.status}: ${msg.slice(0, 400)}`);
  }
  const data = (await upstream.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
    if (joined) return joined;
  }
  throw new Error('gemini_empty');
}

async function callOpenAiCompatJson(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  user: string;
  temperature: number;
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: JOB_REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: opts.user },
      ],
    }),
  });

  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => '');
    throw new Error(`openai_${upstream.status}: ${msg.slice(0, 400)}`);
  }
  const data = (await upstream.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  throw new Error('openai_empty');
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestGet(context: { env: Record<string, string | undefined> }) {
  const { env } = context;
  return json({
    success: true,
    configured: Boolean(env.LLM_API_KEY && env.LLM_BASE_URL),
    meta: { model: env.LLM_MODEL || 'gpt-4o-mini', base_url: env.LLM_BASE_URL || null },
  });
}

export async function onRequestPost(context: { request: Request; env: Record<string, string | undefined> }) {
  const { request, env } = context;
  const model = env.LLM_MODEL || 'gpt-4o-mini';
  const baseUrl = env.LLM_BASE_URL || null;

  if (!env.LLM_API_KEY || !env.LLM_BASE_URL) {
    return json(
      { success: false, error: 'Missing LLM_API_KEY or LLM_BASE_URL', meta: { model, base_url: baseUrl } },
      { status: 501 },
    );
  }

  let bodyRaw: unknown;
  try {
    bodyRaw = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const input = bodyRaw as {
    job_id?: string;
    structured?: { salary_amount?: string | null; city?: string | null; location?: string | null };
    raw_text?: string;
    short_source?: boolean;
  };

  if (!input?.job_id || !input.structured || typeof input.raw_text !== 'string') {
    return json({ success: false, error: 'Invalid job rewrite input' }, { status: 400 });
  }
  if (input.raw_text.length > 50_000) {
    return json({ success: false, error: 'raw_text too long' }, { status: 400 });
  }

  const userMsg = `Rewrite the following job JSON per your rules. Output JSON only.\n\n${JSON.stringify(bodyRaw)}`;
  let route = 'unknown';

  try {
    const temperature = 0.4;
    const raw = isGeminiBaseUrl(env.LLM_BASE_URL)
      ? await callGeminiTextJson({
          apiKey: env.LLM_API_KEY,
          baseUrl: env.LLM_BASE_URL,
          model,
          user: userMsg,
          temperature,
        })
      : await callOpenAiCompatJson({
          apiKey: env.LLM_API_KEY,
          baseUrl: env.LLM_BASE_URL,
          model,
          user: userMsg,
          temperature,
        });
    route = isGeminiBaseUrl(env.LLM_BASE_URL) ? 'gemini_native' : 'openai_compat';

    const maybeJson = pickJsonObject(raw.trim());
    if (!maybeJson) {
      return json({ success: false, error: 'LLM output is not JSON', meta: { model, base_url: baseUrl, route } }, { status: 502 });
    }

    const parsed = JSON.parse(maybeJson) as Record<string, unknown>;
    const body_markdown = typeof parsed.body_markdown === 'string' ? parsed.body_markdown.trim() : '';
    const title_rewritten = clampRewriteTitle(
      typeof parsed.title_rewritten === 'string'
        ? parsed.title_rewritten.trim()
        : typeof parsed.title === 'string'
          ? parsed.title.trim()
          : '',
    );
    if (!body_markdown || !title_rewritten) {
      return json({ success: false, error: 'Missing title_rewritten or body_markdown', meta: { model, base_url: baseUrl, route } }, { status: 502 });
    }

    const data = {
      job_id: typeof parsed.job_id === 'string' ? parsed.job_id : input.job_id,
      title_rewritten,
      body_markdown,
      notes: typeof parsed.notes === 'string' ? parsed.notes : parsed.notes == null ? null : String(parsed.notes),
    };

    const qa = validateOutput(
      { job_id: input.job_id, short_source: input.short_source, structured: input.structured, raw_text: input.raw_text },
      data,
    );

    if (!qa.ok) {
      return json({
        success: false,
        error: `QA failed: ${qa.errors.join('; ')}`,
        data,
        qa,
        meta: { model, base_url: baseUrl, route },
      }, { status: 422 });
    }

    return json({ success: true, data, qa, meta: { model, base_url: baseUrl, route } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: `LLM request failed: ${message}`, meta: { model, base_url: baseUrl, route } }, { status: 502 });
  }
}
