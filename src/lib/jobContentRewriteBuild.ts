import {
  mergeImcColumnsIntoClassicRow,
  normalizeCsvRecordKeys,
  sourceJobUrlFromImc,
} from '@/lib/imcCsvImport';
import type { JobRewriteInput, JobRewriteStructured } from '@/lib/jobContentRewriteTypes';
import { stripCsvCellDecorations } from '@/lib/jobLogoUrl';

const pick = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = stripCsvCellDecorations(String(row[k] ?? ''));
    if (v) return v;
  }
  return '';
};

function mapWorkplaceType(raw: string): JobRewriteStructured['workplace_type'] {
  const s = raw.toLowerCase();
  if (/remot|home|desde casa/i.test(s)) return 'remoto';
  if (/h[ií]brid|hibrid/i.test(s)) return 'hibrido';
  if (/presencial|on-?site|oficina/i.test(s)) return 'presencial';
  return null;
}

function splitBulletLines(text: string): string[] {
  return text
    .split(/\n|•|;/)
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l.length > 8)
    .slice(0, 12);
}

function buildRawText(row: Record<string, string>): string {
  const parts = [
    pick(row, 'description'),
    pick(row, 'requirements'),
    pick(row, 'summary'),
    pick(row, 'highlights'),
  ].filter(Boolean);
  return parts.join('\n\n').trim();
}

/** Build §6 input JSON from a normalized classic/IMC-merge row. */
export function buildJobRewriteInputFromRow(row: Record<string, string>): JobRewriteInput {
  const id = pick(row, 'id', 'origin_id') || `job-${Date.now()}`;
  const raw_text = buildRawText(row);
  const short_source = raw_text.length > 0 && raw_text.length < 400;

  const location = pick(row, 'location') || null;
  const city = location;

  const requirements_bullets = splitBulletLines(pick(row, 'requirements'));
  const benefitsFromHighlights = splitBulletLines(pick(row, 'highlights'));
  const benefits_bullets = benefitsFromHighlights;

  const company_url =
    sourceJobUrlFromImc(row) ||
    pick(row, 'b_same_as', 'company_url', 'website') ||
    null;

  const salaryRaw = pick(row, 'salary_amount');
  const structured: JobRewriteStructured = {
    title: pick(row, 'title', 'job_title') || 'Empleo',
    company_name: pick(row, 'b_name', 'company', 'author_name') || 'Empresa',
    city,
    location,
    workplace_type: mapWorkplaceType(pick(row, 'workplace_type')),
    job_type: pick(row, 'job_type') || null,
    salary_amount: salaryRaw || null,
    salary_currency: salaryRaw ? 'MXN' : null,
    category: pick(row, 'category') || null,
    company_url: company_url && /^https?:\/\//i.test(company_url) ? company_url : null,
    requirements_bullets,
    benefits_bullets,
  };

  return {
    job_id: id,
    short_source,
    structured,
    raw_text: raw_text || pick(row, 'title') || id,
    locale: 'es-MX',
  };
}

export function prepareRowForRewriteImport(
  row: Record<string, string>,
  imcShape: boolean,
): Record<string, string> {
  const normalized = normalizeCsvRecordKeys(row);
  return imcShape ? mergeImcColumnsIntoClassicRow(normalized) : normalized;
}
