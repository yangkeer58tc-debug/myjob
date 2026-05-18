import {
  JOB_REWRITE_SYSTEM_PROMPT,
  buildJobRewriteUserMessage,
} from '@/lib/jobContentRewritePrompt';
import { validateJobRewriteOutput } from '@/lib/jobContentRewriteQa';
import { clampJobRewriteTitle } from '@/lib/jobRewriteTitle';
import type {
  JobRewriteApiResponse,
  JobRewriteInput,
  JobRewriteLlmOutput,
} from '@/lib/jobContentRewriteTypes';

const llmKey = () =>
  String(import.meta.env.LLM_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || '').trim();

const llmBase = () =>
  String(
    import.meta.env.LLM_BASE_URL ||
      import.meta.env.VITE_OPENAI_API_BASE_URL ||
      'https://api.openai.com/v1',
  )
    .trim()
    .replace(/\/$/, '');

const llmModel = () =>
  String(import.meta.env.LLM_MODEL || import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini').trim();

export function hasClientJobRewriteLlm(): boolean {
  return Boolean(llmKey() && llmBase());
}

export function clientJobRewriteModelName(): string {
  return llmModel();
}

function pickJsonObject(s: string) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return s.slice(start, end + 1);
}

function normalizeLlmOutput(obj: unknown, jobId: string): JobRewriteLlmOutput | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const body_markdown = typeof o.body_markdown === 'string' ? o.body_markdown.trim() : '';
  const title_rewritten =
    typeof o.title_rewritten === 'string'
      ? o.title_rewritten.trim()
      : typeof o.title === 'string'
        ? o.title.trim()
        : '';
  if (!body_markdown || !title_rewritten) return null;
  return {
    job_id: typeof o.job_id === 'string' ? o.job_id : jobId,
    title_rewritten: clampJobRewriteTitle(title_rewritten),
    body_markdown,
    notes: typeof o.notes === 'string' ? o.notes : o.notes == null ? null : String(o.notes),
  };
}

function isGeminiBaseUrl(baseUrl: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

async function callGeminiJson(user: string): Promise<string> {
  const apiKey = llmKey();
  const baseUrl = llmBase();
  const model = llmModel();
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
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json', maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${msg.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts;
  const joined = Array.isArray(parts)
    ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
    : '';
  if (!joined) throw new Error('Gemini empty response');
  return joined;
}

async function callOpenAiCompatJson(user: string): Promise<string> {
  const base = llmBase();
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmKey()}`,
    },
    body: JSON.stringify({
      model: llmModel(),
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: JOB_REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`LLM ${res.status}: ${msg.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM empty response');
  return content;
}

/** Browser-side rewrite when Pages Function env is missing but build injected LLM_* */
export async function rewriteJobContentViaClient(input: JobRewriteInput): Promise<JobRewriteApiResponse> {
  if (!hasClientJobRewriteLlm()) {
    return { success: false, error: 'Missing LLM_API_KEY or LLM_BASE_URL in build env' };
  }

  const user = buildJobRewriteUserMessage(JSON.stringify(input));
  const route = isGeminiBaseUrl(llmBase()) ? 'browser_gemini' : 'browser_openai_compat';

  try {
    const raw = isGeminiBaseUrl(llmBase()) ? await callGeminiJson(user) : await callOpenAiCompatJson(user);
    const maybeJson = pickJsonObject(raw.trim());
    if (!maybeJson) {
      return { success: false, error: 'LLM output is not JSON', meta: { model: llmModel(), base_url: llmBase(), route } };
    }
    const parsed = JSON.parse(maybeJson) as unknown;
    const data = normalizeLlmOutput(parsed, input.job_id);
    if (!data) {
      return { success: false, error: 'Missing title_rewritten or body_markdown', meta: { model: llmModel(), base_url: llmBase(), route } };
    }
    const qa = validateJobRewriteOutput(input, data);
    if (!qa.ok) {
      return {
        success: false,
        error: `QA failed: ${qa.errors.join('; ')}`,
        data,
        qa,
        meta: { model: llmModel(), base_url: llmBase(), route },
      };
    }
    return {
      success: true,
      data,
      qa,
      meta: { model: llmModel(), base_url: llmBase(), route },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      meta: { model: llmModel(), base_url: llmBase(), route },
    };
  }
}
