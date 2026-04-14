/**
 * Client-side relevance ranking for job text search (title-first + light intent).
 * Used when the list fetches a capped window of rows and re-sorts before pagination.
 */

const STOP = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'en',
  'un',
  'una',
  'unos',
  'unas',
  'con',
  'sin',
  'por',
  'para',
  'al',
  'a',
]);

export type JobSearchIntent = {
  /** Normalized full query (diacritics stripped, lower) */
  normalized: string;
  /** Content tokens after stopword removal */
  tokens: string[];
  /** Extra score when job.workplace_type matches */
  workplaceBoost?: 'presencial' | 'hibrido' | 'remoto';
  /** Extra score when job.job_type matches */
  jobTypeBoost?: 'tempo-integral' | 'meio-periodo' | 'temporario' | 'freelancer' | 'estagio';
  /** User query looks salary / money focused */
  salaryFocused: boolean;
};

type JobRankFields = {
  title: string;
  b_name: string;
  summary?: string | null;
  description?: string | null;
  requirements?: string | null;
  industry?: string | null;
  salary_amount?: string | null;
  job_type?: string | null;
  workplace_type?: string | null;
  location?: string | null;
  created_at?: string | null;
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const hasAny = (hay: string, needles: string[]) => needles.some((n) => n && hay.includes(n));

/** Heuristic intent: remote / schedule / salary focus (Spanish + common English). */
export function interpretJobSearchIntent(raw: string): JobSearchIntent {
  const normalized = norm(raw.replace(/,/g, ' ')).slice(0, 200);
  if (!normalized) {
    return { normalized: '', tokens: [], salaryFocused: false };
  }

  let workplaceBoost: JobSearchIntent['workplaceBoost'];
  if (
    hasAny(normalized, [
      'remoto',
      'remota',
      'teletrabajo',
      'teletrabajar',
      'home office',
      'desde casa',
      'trabajo en casa',
      'wfh',
      'work from home',
    ])
  ) {
    workplaceBoost = 'remoto';
  } else if (hasAny(normalized, ['hibrido', 'híbrido', 'hybrid', 'mixto', 'mixta'])) {
    workplaceBoost = 'hibrido';
  } else if (hasAny(normalized, ['presencial', 'en oficina', 'onsite', 'on site', 'en sitio'])) {
    workplaceBoost = 'presencial';
  }

  let jobTypeBoost: JobSearchIntent['jobTypeBoost'];
  if (hasAny(normalized, ['tiempo completo', 'jornada completa', 'full time', 'fulltime'])) {
    jobTypeBoost = 'tempo-integral';
  } else if (hasAny(normalized, ['medio tiempo', 'media jornada', 'part time', 'parttime', 'medio periodo'])) {
    jobTypeBoost = 'meio-periodo';
  } else if (hasAny(normalized, ['temporal', 'temporario', 'por temporada', 'por proyecto'])) {
    jobTypeBoost = 'temporario';
  } else if (hasAny(normalized, ['freelance', 'freelancer', 'independiente'])) {
    jobTypeBoost = 'freelancer';
  } else if (hasAny(normalized, ['practica', 'prácticas', 'practicas', 'pasantia', 'pasantía', 'becario', 'becaria', 'intern', 'internship'])) {
    jobTypeBoost = 'estagio';
  }

  const salaryFocused =
    /\d/.test(normalized) &&
    hasAny(normalized, [
      'mxn',
      'peso',
      'pesos',
      'sueldo',
      'salario',
      'pago',
      'quincen',
      'mensual',
      'semanal',
      'hora',
      '$',
      'k ',
      ' k',
    ]);

  const tokens = normalized
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));

  return { normalized, tokens, workplaceBoost, jobTypeBoost, salaryFocused };
}

function countTokenHits(hay: string, tokens: string[]): number {
  if (!hay || tokens.length === 0) return 0;
  let n = 0;
  for (const t of tokens) {
    if (hay.includes(t)) n += 1;
  }
  return n;
}

function scoreJob(job: JobRankFields, intent: JobSearchIntent): number {
  const title = norm(job.title || '');
  const company = norm(job.b_name || '');
  const summary = norm(job.summary || '');
  const description = norm(job.description || '');
  const requirements = norm(job.requirements || '');
  const industry = norm(job.industry || '');
  const salary = norm(job.salary_amount || '');
  const location = norm(job.location || '');

  const { normalized, tokens } = intent;
  let score = 0;

  if (normalized.length >= 3) {
    if (title.includes(normalized)) score += 220;
    else if (company.includes(normalized)) score += 110;
    else if (summary.includes(normalized) || description.includes(normalized)) score += 55;
    else if (requirements.includes(normalized)) score += 40;
  }

  if (tokens.length > 0) {
    const titleHits = countTokenHits(title, tokens);
    const companyHits = countTokenHits(company, tokens);
    const bodyHits = countTokenHits(`${summary} ${description}`, tokens);
    const reqHits = countTokenHits(requirements, tokens);

    if (titleHits === tokens.length) score += 160;
    else score += titleHits * 38;

    score += Math.min(companyHits * 22, 70);
    score += Math.min(bodyHits * 10, 45);
    score += Math.min(reqHits * 8, 30);

    const first = tokens[0];
    if (first && title.startsWith(first)) score += 45;
    if (first && title.includes(` ${first}`)) score += 12;
  }

  if (intent.workplaceBoost && job.workplace_type === intent.workplaceBoost) {
    score += 55;
  }
  if (intent.jobTypeBoost && job.job_type === intent.jobTypeBoost) {
    score += 50;
  }
  if (intent.salaryFocused) {
    const digitTokens = tokens.filter((t) => /\d/.test(t));
    for (const dt of digitTokens) {
      if (salary.includes(dt)) score += 35;
    }
    if (/\d/.test(normalized) && salary.includes(normalized.replace(/\s+/g, ''))) score += 25;
  }

  if (tokens.length > 0) {
    const locHits = countTokenHits(location, tokens);
    score += Math.min(locHits * 6, 24);
    const indHits = countTokenHits(industry, tokens);
    score += Math.min(indHits * 5, 20);
  }

  return score;
}

/** Newest first when scores tie. */
export function sortJobsBySearchRelevance<T extends JobRankFields>(jobs: T[], rawQuery: string): T[] {
  const intent = interpretJobSearchIntent(rawQuery);
  if (!intent.normalized && intent.tokens.length === 0) {
    return [...jobs];
  }

  const scored = jobs.map((job, idx) => ({
    job,
    idx,
    s: scoreJob(job, intent),
    ts: job.created_at ? new Date(job.created_at).getTime() : 0,
  }));

  scored.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    if (b.ts !== a.ts) return b.ts - a.ts;
    return a.idx - b.idx;
  });

  return scored.map((x) => x.job);
}
