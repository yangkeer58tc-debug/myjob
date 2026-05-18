// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

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

const TITLE_MAX = 48;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickJsonObject(s: string) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return s.slice(start, end + 1);
}

function isGeminiBaseUrl(baseUrl: string) {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

function clampTitle(title: string) {
  let s = String(title || '').replace(/\s+/g, ' ').trim();
  if (s.length <= TITLE_MAX) return s;
  const window = s.slice(0, TITLE_MAX + 1);
  for (const sep of [' - ', ' – ', ' | ', ', ', ' en ', ' · ', ' / ']) {
    const idx = window.lastIndexOf(sep);
    if (idx >= Math.floor(TITLE_MAX * 0.45)) return s.slice(0, idx).trim();
  }
  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace >= Math.floor(TITLE_MAX * 0.55)) return s.slice(0, lastSpace).trim();
  return s.slice(0, TITLE_MAX).trim();
}

function splitBody(body: string) {
  const text = String(body || '').trim();
  if (!text) return { summary: '', description: '', requirements: '' };
  const takeSection = (startHeader: string, endHeaders: string[]) => {
    const start = text.indexOf(startHeader);
    if (start < 0) return '';
    let from = start + startHeader.length;
    while (from < text.length && /[\s\n]/.test(text[from])) from += 1;
    let end = text.length;
    for (const h of endHeaders) {
      const i = text.indexOf(h, from);
      if (i >= 0 && i < end) end = i;
    }
    return text.slice(from, end).trim();
  };
  const resumen = takeSection('**Resumen del puesto**', [
    '**Qué harás**',
    '**Requisitos**',
    '**Ofrecemos**',
    '**Detalles del trabajo**',
  ]);
  const queHaras = takeSection('**Qué harás**', ['**Requisitos**', '**Ofrecemos**', '**Detalles del trabajo**']);
  const requisitos = takeSection('**Requisitos**', ['**Ofrecemos**', '**Detalles del trabajo**']);
  const ofrecemos = takeSection('**Ofrecemos**', ['**Detalles del trabajo**']);
  const detalles = takeSection('**Detalles del trabajo**', []);
  return {
    summary: resumen.replace(/^\*\*|\*\*$/g, '').trim(),
    description: [queHaras, ofrecemos, detalles].filter(Boolean).join('\n\n').trim(),
    requirements: requisitos.trim(),
  };
}

function validateOutput(
  input: { job_id: string; short_source?: boolean; structured?: { salary_amount?: string | null } },
  output: { job_id: string; title_rewritten: string; body_markdown: string },
) {
  const errors: string[] = [];
  const body = String(output.body_markdown || '');
  const bodyCharCount = body.replace(/\s+/g, '').length;
  const minChars = input.short_source ? 450 : 800;
  if (output.job_id !== input.job_id) errors.push('job_id mismatch');
  if (!output.title_rewritten) errors.push('missing title_rewritten');
  for (const h of SECTION_HEADERS) {
    if (!body.includes(h)) errors.push(`missing section: ${h}`);
  }
  if (bodyCharCount < minChars) errors.push(`body too short (${bodyCharCount} < ${minChars})`);
  const salaryDigits = String(input.structured?.salary_amount || '').replace(/[^\d]/g, '');
  if (salaryDigits.length >= 3 && !body.includes(salaryDigits)) {
    errors.push('salary digits missing in body');
  }
  return { ok: errors.length === 0, errors };
}

async function callGemini(apiKey: string, baseUrl: string, model: string, user: string) {
  const root = baseUrl
    .replace(/\/+$/, '')
    .replace(/\/v1beta\/openai$/i, '/v1beta')
    .replace(/\/v1$/i, '/v1beta');
  const url = `${root}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${JOB_REWRITE_SYSTEM_PROMPT}\n\n${user}` }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`gemini_${res.status}: ${msg.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts;
  const joined = Array.isArray(parts)
    ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
    : '';
  if (!joined) throw new Error('gemini_empty');
  return joined;
}

function isSuspended(msg: string) {
  return /suspended|has been suspended|consumer 'api_key/i.test(msg);
}

function isTransient(msg: string) {
  return /429|503|502|500|rate.?limit|resource.?exhausted|high demand|temporarily|overloaded/i.test(msg);
}

function buildUpsert(row: Record<string, string>, llm: { job_id: string; title_rewritten: string; body_markdown: string }) {
  const split = splitBody(llm.body_markdown);
  const title = clampTitle(llm.title_rewritten);
  const id = String(row.id || llm.job_id).trim() || llm.job_id;
  return {
    id,
    b_name: String(row.b_name || row.company || 'MyJob').trim() || 'MyJob',
    b_logo_url: row.b_logo_url?.trim() || null,
    b_same_as: row.b_same_as?.trim() || null,
    street_address: row.street_address?.trim() || null,
    title,
    category: row.category?.trim() || null,
    location: String(row.location || 'Mexico').trim() || 'Mexico',
    salary_amount: String(row.salary_amount || '12000').trim() || '12000',
    payment_frequency: String(row.payment_frequency || 'mensal').trim() || 'mensal',
    job_type: String(row.job_type || 'tempo-integral').trim() || 'tempo-integral',
    workplace_type: String(row.workplace_type || 'presencial').trim() || 'presencial',
    summary: split.summary || null,
    description: split.description || llm.body_markdown,
    requirements: split.requirements || null,
    highlights: null,
    education_level: row.education_level?.trim() || null,
    industry: row.industry?.trim() || null,
    language_req: row.language_req?.trim() || null,
    experience: row.experience?.trim() || null,
    is_active: true,
    created_at: new Date().toISOString(),
  };
}

async function processOne(
  supabase: ReturnType<typeof createClient>,
  task: Record<string, any>,
  llmKey: string,
  llmBase: string,
  llmModel: string,
  minDelayMs: number,
) {
  const batchId = task.batch_id as string;
  const taskId = task.id as string;
  const input = task.input as Record<string, unknown>;
  const row = task.row_snapshot as Record<string, string>;
  const attempts = Number(task.attempts || 0);

  try {
    const userMsg = `Rewrite the following job JSON per your rules. Output JSON only.\n\n${JSON.stringify(input)}`;
    const raw = await callGemini(llmKey, llmBase, llmModel, userMsg);
    const maybeJson = pickJsonObject(raw.trim());
    if (!maybeJson) throw new Error('LLM output is not JSON');

    const parsed = JSON.parse(maybeJson) as Record<string, unknown>;
    const body_markdown = typeof parsed.body_markdown === 'string' ? parsed.body_markdown.trim() : '';
    const title_rewritten = clampTitle(
      typeof parsed.title_rewritten === 'string'
        ? parsed.title_rewritten.trim()
        : typeof parsed.title === 'string'
          ? parsed.title.trim()
          : '',
    );
    if (!body_markdown || !title_rewritten) throw new Error('Missing title_rewritten or body_markdown');

    const data = {
      job_id: typeof parsed.job_id === 'string' ? parsed.job_id : String(input.job_id),
      title_rewritten,
      body_markdown,
      notes: typeof parsed.notes === 'string' ? parsed.notes : null,
    };

    const qa = validateOutput(
      {
        job_id: String(input.job_id),
        short_source: Boolean(input.short_source),
        structured: input.structured as { salary_amount?: string | null },
      },
      data,
    );
    if (!qa.ok) throw new Error(`QA failed: ${qa.errors.join('; ')}`);

    const payload = buildUpsert(row, data);
    const { error: upsertErr } = await supabase.from('jobs').upsert([payload]);
    if (upsertErr) throw new Error(upsertErr.message);

    await supabase
      .from('job_rewrite_tasks')
      .update({
        status: 'done',
        result: { data, qa },
        error: null,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    await supabase.rpc('refresh_job_rewrite_batch_stats', { p_batch_id: batchId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = isTransient(message) && !isSuspended(message);
    const status = transient && attempts < 6 ? 'pending' : 'failed';
    await supabase
      .from('job_rewrite_tasks')
      .update({
        status,
        error: message.slice(0, 500),
        locked_at: status === 'pending' ? null : task.locked_at,
        locked_by: status === 'pending' ? null : task.locked_by,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);
    await supabase.rpc('refresh_job_rewrite_batch_stats', { p_batch_id: batchId });
  }

  if (minDelayMs > 0) await sleep(minDelayMs);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const llmKey = Deno.env.get('LLM_API_KEY')?.trim();
  const llmBase = Deno.env.get('LLM_BASE_URL')?.trim();
  const llmModel = Deno.env.get('LLM_MODEL')?.trim() || 'gemini-2.0-flash';

  if (!url || !serviceKey) {
    return json({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!llmKey || !llmBase) {
    return json({ ok: false, error: 'Missing LLM_API_KEY or LLM_BASE_URL in Edge secrets' }, 500);
  }
  if (!isGeminiBaseUrl(llmBase)) {
    return json({ ok: false, error: 'Worker currently supports Gemini LLM_BASE_URL only' }, 501);
  }

  const claimSize = Math.min(
    12,
    Math.max(1, Number.parseInt(Deno.env.get('JOB_REWRITE_WORKER_CLAIM_SIZE') || '4', 10) || 4),
  );
  const minDelayMs = Math.min(
    5000,
    Math.max(0, Number.parseInt(Deno.env.get('JOB_REWRITE_MIN_DELAY_MS') || '300', 10) || 300),
  );
  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await supabase.rpc('release_stale_job_rewrite_tasks', { p_timeout_minutes: 15 });

  const { data: claimed, error: claimErr } = await supabase.rpc('claim_job_rewrite_tasks', {
    p_limit: claimSize,
    p_worker: workerId,
  });

  if (claimErr) {
    return json({ ok: false, error: claimErr.message }, 500);
  }

  const tasks = (claimed || []) as Record<string, unknown>[];
  for (const task of tasks) {
    await processOne(supabase, task, llmKey, llmBase, llmModel, minDelayMs);
  }

  return json({
    ok: true,
    worker: workerId,
    processed: tasks.length,
    claim_size: claimSize,
  });
});
