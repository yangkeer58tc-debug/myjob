import type { JobRewriteInput, JobRewriteLlmOutput, JobRewriteQaResult } from '@/lib/jobContentRewriteTypes';

const SECTION_HEADERS = [
  '**Resumen del puesto**',
  '**Qué harás**',
  '**Requisitos**',
  '**Ofrecemos**',
  '**Detalles del trabajo**',
] as const;

function stripForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough 5-gram overlap ratio vs raw_text (0–1). */
export function estimateDuplicateRatio(body: string, rawText: string): number | null {
  const a = stripForCompare(body);
  const b = stripForCompare(rawText);
  if (a.length < 80 || b.length < 80) return null;

  const n = 5;
  const grams = (text: string) => {
    const words = text.split(' ').filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      set.add(words.slice(i, i + n).join(' '));
    }
    return set;
  };

  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0) return null;
  let hit = 0;
  for (const g of ga) {
    if (gb.has(g)) hit += 1;
  }
  return hit / ga.size;
}

function extractSalaryDigits(s: string | null | undefined): string {
  if (!s) return '';
  const m = String(s).replace(/[^\d]/g, '');
  return m.length >= 3 ? m : '';
}

export function validateJobRewriteOutput(
  input: JobRewriteInput,
  output: JobRewriteLlmOutput,
): JobRewriteQaResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = String(output.body_markdown || '');
  const bodyCharCount = body.replace(/\s+/g, '').length;
  const minChars = input.short_source ? 450 : 800;

  if (output.job_id !== input.job_id) {
    errors.push('job_id mismatch');
  }
  if (!String(output.title_rewritten || '').trim()) {
    errors.push('missing title_rewritten');
  }

  for (const h of SECTION_HEADERS) {
    if (!body.includes(h)) errors.push(`missing section: ${h}`);
  }

  const idx = SECTION_HEADERS.map((h) => body.indexOf(h));
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] >= 0 && idx[i - 1] >= 0 && idx[i] <= idx[i - 1]) {
      errors.push('section order invalid');
      break;
    }
  }

  if (bodyCharCount < minChars) {
    errors.push(`body too short (${bodyCharCount} < ${minChars})`);
  }

  const salaryDigits = extractSalaryDigits(input.structured.salary_amount);
  if (salaryDigits && !body.includes(salaryDigits)) {
    errors.push('salary digits missing in body');
  }

  const loc = (input.structured.city || input.structured.location || '').trim();
  if (loc.length > 2) {
    const locNorm = stripForCompare(loc).split(' ')[0];
    if (locNorm.length > 3 && !stripForCompare(body).includes(locNorm)) {
      warnings.push('city/location token not found in body');
    }
  }

  const duplicateRatio = estimateDuplicateRatio(body, input.raw_text);
  if (duplicateRatio != null && duplicateRatio > 0.2) {
    warnings.push(`high duplicate ratio vs source (~${Math.round(duplicateRatio * 100)}%)`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    bodyCharCount,
    duplicateRatio,
  };
}
