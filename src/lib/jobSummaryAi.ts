export type JobAiEnrichment = {
  summary: string | null;
  highlights: string[];
};

const MAX_SUMMARY = 200;
const MAX_HIGHLIGHT = 80;
const MAX_HIGHLIGHTS = 3;

const stripNewlines = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

const clamp = (s: string, max: number) => {
  const t = stripNewlines(s);
  if (t.length <= max) return t;
  return t.slice(0, max).trim();
};

function parseAiJsonPayload(raw: string): { summary?: unknown; highlights?: unknown } | null {
  const t = stripNewlines(raw);
  if (!t) return null;
  try {
    const o = JSON.parse(t) as { summary?: unknown; highlights?: unknown };
    return o && typeof o === 'object' ? o : null;
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      const o = JSON.parse(t.slice(start, end + 1)) as { summary?: unknown; highlights?: unknown };
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }
}

function normalizeHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const line = clamp(item, MAX_HIGHLIGHT);
    if (line) out.push(line);
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

const openAiCompatibleKey = () =>
  String(import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.LLM_API_KEY || '').trim();

const openAiCompatibleBase = () =>
  String(
    import.meta.env.VITE_OPENAI_API_BASE_URL ||
      import.meta.env.LLM_BASE_URL ||
      'https://api.openai.com/v1',
  )
    .trim()
    .replace(/\/$/, '');

const openAiCompatibleModel = () =>
  String(import.meta.env.VITE_OPENAI_MODEL || import.meta.env.LLM_MODEL || 'gpt-4o-mini').trim();

/** True when any supported AI env is present (browser build: keys are visible in client bundle). */
export function hasJobAiConfig(): boolean {
  const custom = String(import.meta.env.VITE_JOB_AI_URL || '').trim();
  return Boolean(custom || openAiCompatibleKey());
}

/**
 * Custom HTTP endpoint: POST JSON body `{ "description": "<jd>" }` (also sends `jd` duplicate).
 * Response JSON: `{ "summary": string, "highlights": string[] }` (extra fields ignored).
 */
async function callCustomJobAi(description: string): Promise<JobAiEnrichment> {
  const url = String(import.meta.env.VITE_JOB_AI_URL || '').trim();
  const key = String(import.meta.env.VITE_JOB_AI_API_KEY || '').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description, jd: description }),
  });
  if (!res.ok) throw new Error(`Job AI HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const payload =
    body && typeof body.data === 'object' && body.data !== null
      ? (body.data as Record<string, unknown>)
      : body;

  const summaryRaw = typeof payload.summary === 'string' ? payload.summary : '';
  const summary = summaryRaw ? clamp(summaryRaw, MAX_SUMMARY) : null;
  let highlights = normalizeHighlights(payload.highlights);
  if (highlights.length === 0) {
    highlights = sentenceFallbackHighlights(description);
  }
  return { summary, highlights };
}

const buildUserPrompt = (description: string) => {
  const jd = description.slice(0, 14_000);
  return [
    'You will read a job description (JD) and output JSON only.',
    '',
    'Field "summary" (optional): one-sentence job summary.',
    '- Same language as the JD.',
    `- At most ${MAX_SUMMARY} characters, no line breaks.`,
    '- Qualitative role purpose only: do NOT mention salary, bonuses, compensation, city, address, country, or work location.',
    '- Use only facts explicitly stated in the JD; do not invent.',
    '',
    `Field "highlights": an array of ${MAX_HIGHLIGHTS} or fewer strings (minimum 1).`,
    '- Same language as the JD.',
    `- Each string at most ${MAX_HIGHLIGHT} characters, no line breaks.`,
    '- Focus on attractive reasons to apply (culture, growth, mission, team, learning, impact, benefits that are not pure cash/location).',
    '- Do NOT mention salary, pay, bonuses, city, address, country, workplace type (remote/hybrid/on-site), schedule type, or employment contract type.',
    '- Use only facts explicitly stated in the JD; do not invent.',
    '',
    'Return: {"summary":"...","highlights":["...","..."]}',
    '',
    'JD:',
    jd,
  ].join('\n');
};

async function callOpenAiCompatible(description: string): Promise<JobAiEnrichment> {
  const apiKey = openAiCompatibleKey();
  if (!apiKey) return { summary: null, highlights: [] };

  const base = openAiCompatibleBase();
  const model = openAiCompatibleModel();

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract recruiting metadata from job descriptions. Always return valid JSON with keys summary (string or null) and highlights (array of strings).',
        },
        { role: 'user', content: buildUserPrompt(description) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = parseAiJsonPayload(content);
  if (!parsed) return { summary: null, highlights: [] };

  const summaryRaw = typeof parsed.summary === 'string' ? parsed.summary : '';
  const summary = summaryRaw ? clamp(summaryRaw, MAX_SUMMARY) : null;
  let highlights = normalizeHighlights(parsed.highlights);
  if (highlights.length === 0) {
    highlights = sentenceFallbackHighlights(description);
  }
  return { summary, highlights };
}

/** Generate summary + highlights for one JD. Uses VITE_JOB_AI_URL when set, else OpenAI-compatible env. */
export async function generateJobSummaryAndHighlights(description: string): Promise<JobAiEnrichment> {
  const text = String(description ?? '').trim();
  if (!text) return { summary: null, highlights: [] };

  const customUrl = String(import.meta.env.VITE_JOB_AI_URL || '').trim();
  if (customUrl) return callCustomJobAi(text);
  return callOpenAiCompatible(text);
}

function sentenceFallbackHighlights(description: string): string[] {
  const text = stripNewlines(description);
  if (!text) return [];
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((p) => clamp(p.replace(/^[-•\d.\s]+/, ''), MAX_HIGHLIGHT))
    .filter((p) => p.length >= 12);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
    if (uniq.length >= MAX_HIGHLIGHTS) break;
  }
  if (uniq.length === 0) return [clamp(text, MAX_HIGHLIGHT)];
  return uniq;
}

/**
 * Ensures at least one highlight (product rule). Does not call the network.
 * Only used when AI is unavailable or returns an empty highlights array.
 */
export function fallbackHighlightsFromDescription(description: string): string[] {
  return sentenceFallbackHighlights(description);
}
