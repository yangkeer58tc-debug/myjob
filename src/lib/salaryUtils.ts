import { extractSalaryFromJd } from './jdExtract';
import { estimatedMonthlyMxnForJob } from './mxSalaryFallback';

const parseSalaryNumber = (input: string) => {
  const raw = input.trim().replace(/\u00A0/g, ' ');
  if (!raw) return null;
  if (/[A-Za-z]/.test(raw)) return null;

  const cleaned = raw
    .replace(/(brl|mxn|r\$|mx\$|\$)/gi, '')
    .replace(/[^\d.,-]/g, '')
    .trim();
  if (!/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    normalized = cleaned.replace(/,/g, '.');
  } else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1;
    if (decimals === 3 && cleaned.length > 4) normalized = cleaned.replace(/\./g, '');
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;

  const hasDecimals = normalized.includes('.') && !Number.isInteger(num);
  return { num, hasDecimals };
};

export const salaryNumberForSchema = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = parseSalaryNumber(String(value));
  return parsed ? parsed.num : null;
};

export const isPlaceholderSalaryText = (raw: string | null | undefined) => {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return true;
  return /a combinar|a negociar|negociable|combinar|sobre el monto|consultar/i.test(s);
};

export type JobSalaryContext = {
  salary_amount: string | null | undefined;
  payment_frequency: string | null | undefined;
  summary?: string | null;
  description?: string | null;
  requirements?: string | null;
  category?: string | null;
  title?: string | null;
  location?: string | null;
};

/** Resolve numeric salary + unit for JobPosting when DB value is missing or placeholder. */
export function effectiveSalaryForJobPosting(job: JobSalaryContext): {
  value: number;
  payment_frequency: string;
} | null {
  const freq = String(job.payment_frequency ?? 'mensal').trim() || 'mensal';
  if (!isPlaceholderSalaryText(job.salary_amount)) {
    const n = salaryNumberForSchema(job.salary_amount);
    if (n !== null) return { value: n, payment_frequency: freq };
  }

  const jd = [job.summary, job.description, job.requirements].filter(Boolean).join('\n\n');
  const extracted = extractSalaryFromJd(jd);
  if (extracted) {
    const n = salaryNumberForSchema(extracted.amount);
    if (n !== null) return { value: n, payment_frequency: extracted.payment_frequency };
  }

  const est = estimatedMonthlyMxnForJob(job.category, String(job.title ?? ''), String(job.location ?? ''));
  const n = salaryNumberForSchema(est.salary_amount);
  if (n !== null) return { value: n, payment_frequency: est.payment_frequency };
  return null;
}

export const formatSalaryBRL = (value: string | null | undefined) => {
  if (!value) return '';
  const parsed = parseSalaryNumber(String(value));
  if (!parsed) return String(value);

  const formatted = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: parsed.hasDecimals ? 2 : 0,
    maximumFractionDigits: parsed.hasDecimals ? 2 : 0,
  }).format(parsed.num);

  return `R$ ${formatted}`;
};

export const formatSalaryMXN = (value: string | null | undefined) => {
  if (!value) return '';
  const parsed = parseSalaryNumber(String(value));
  if (!parsed) return String(value);

  const formatted = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: parsed.hasDecimals ? 2 : 0,
    maximumFractionDigits: parsed.hasDecimals ? 2 : 0,
  }).format(parsed.num);

  return `MXN $${formatted}`;
};

/** UI: formatted pay using JD extract / fallback when DB is placeholder or empty. */
export function displaySalaryMXN(job: JobSalaryContext): string {
  const eff = effectiveSalaryForJobPosting(job);
  if (!eff) return '';
  const base = formatSalaryMXN(String(eff.value));
  if (eff.payment_frequency === 'semanal') return `${base} / semana`;
  if (eff.payment_frequency === 'quinzenal') return `${base} / quincena`;
  if (eff.payment_frequency === 'hora') return `${base} / hora`;
  if (eff.payment_frequency === 'diario') return `${base} / día`;
  return `${base} / mes`;
}
