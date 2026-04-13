/**
 * Heuristics to pull employer name and compensation hints from free-text JD (ES/PT/MX).
 * Used by Admin CSV import when columns are omitted or list portals slip through as employer.
 */

/** Job boards — not real employers (omit "myjob" so the site default name stays valid). */
const PORTAL_NAMES =
  /\b(indeed|linkedin|glassdoor|computrabajo|occ\s*mundial|bumeran|zonajobs|trovit|jobatus|jooble)\b/i;

const normalizeMoneyToken = (raw: string) => {
  const s = raw.replace(/\u00A0/g, ' ').trim();
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized = s.replace(/[^\d.,]/g, '');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
    else normalized = normalized.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const parts = normalized.split(',');
    if (parts.length === 2 && parts[1].length <= 2) normalized = `${parts[0]}.${parts[1]}`;
    else normalized = normalized.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const decimals = normalized.length - lastDot - 1;
    if (decimals === 3 && normalized.length > 4) normalized = normalized.replace(/\./g, '');
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
};

export type ExtractedSalary = { amount: string; payment_frequency: string };

/** Midpoint of a salary range for a single JobPosting baseSalary value. */
const midpoint = (a: number, b: number) => String(Math.round(((a + b) / 2) / 50) * 50);

/**
 * Parse salary + pay cadence from JD. Returns payment_frequency as job option ids (mensal, semanal, etc.).
 */
export function extractSalaryFromJd(text: string): ExtractedSalary | null {
  const t = String(text || '').replace(/\r/g, '\n');
  if (!t.trim()) return null;

  const lower = t.toLowerCase();

  // Hourly
  const hourMatch = t.match(/\$\s*([\d.,]+)\s*(?:mxn|pesos)?\s*(?:\/|\bpor\s+)?\s*hora\b/i);
  if (hourMatch) {
    const n = normalizeMoneyToken(hourMatch[1]);
    if (n !== null) return { amount: String(n), payment_frequency: 'hora' };
  }

  // Weekly
  const weekPatterns = [
    /pago\s+semanal[^$\d]{0,24}\$\s*([\d.,]+)/i,
    /(?:salario|sueldo|pag(?:o|amento))\s+semanal[^$\d]{0,24}\$\s*([\d.,]+)/i,
    /\$\s*([\d.,]+)[^\d]{0,40}(?:por\s+)?semana\b/i,
  ];
  for (const re of weekPatterns) {
    const m = t.match(re);
    if (m) {
      const n = normalizeMoneyToken(m[1]);
      if (n !== null) return { amount: String(n), payment_frequency: 'semanal' };
    }
  }

  // Biweekly / quincenal
  if (/\b(quinzenal|quincenal|bisemanal)\b/i.test(lower)) {
    const m = t.match(/\$\s*([\d.,]+)/);
    if (m) {
      const n = normalizeMoneyToken(m[1]);
      if (n !== null) return { amount: String(n), payment_frequency: 'quinzenal' };
    }
  }

  // Monthly range (common in MX: "Sueldo: $10,000 - $12,700" or "de X a Y pesos al mes")
  const range1 = t.match(
    /(?:sueldo|salario|salário|remuneracion|remuneração|ofrecemos|oferecemos)[^$\d]{0,40}\$\s*([\d.,]+)\s*[-–—]\s*\$?\s*([\d.,]+)/i,
  );
  if (range1) {
    const a = normalizeMoneyToken(range1[1]);
    const b = normalizeMoneyToken(range1[2]);
    if (a !== null && b !== null) return { amount: midpoint(a, b), payment_frequency: 'mensal' };
  }

  const range2 = t.match(/\$\s*([\d.,]+)\s*[-–—]\s*\$?\s*([\d.,]+)[^\d]{0,30}(?:al\s+mes|mensual|mês|mês)/i);
  if (range2) {
    const a = normalizeMoneyToken(range2[1]);
    const b = normalizeMoneyToken(range2[2]);
    if (a !== null && b !== null) return { amount: midpoint(a, b), payment_frequency: 'mensal' };
  }

  // Single monthly
  const singleMonth = t.match(
    /\$\s*([\d.,]+)(?:[^\d\n]{0,24}(?:al\s+mes|mensual|por\s+mes|mês|\/mes|mensais))?/i,
  );
  if (singleMonth && /mes|mensual|mês|salario|sueldo/i.test(lower)) {
    const n = normalizeMoneyToken(singleMonth[1]);
    if (n !== null && n >= 1000) return { amount: String(Math.round(n)), payment_frequency: 'mensal' };
  }

  const sueldoLine = t.match(/(?:^|\n)\s*(?:sueldo|salario|salário)\s*:?\s*\$?\s*([\d.,]+)\s*[-–—]?\s*\$?\s*([\d.,]+)?/im);
  if (sueldoLine) {
    const a = normalizeMoneyToken(sueldoLine[1]);
    const b = sueldoLine[2] ? normalizeMoneyToken(sueldoLine[2]) : null;
    if (a !== null && b !== null) return { amount: midpoint(a, b), payment_frequency: 'mensal' };
    if (a !== null) return { amount: String(Math.round(a)), payment_frequency: 'mensal' };
  }

  return null;
}

function cleanCompanyName(raw: string) {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[,.\-\s]+|[,.\-\s]+$/g, '');
  if (s.length < 2 || s.length > 120) return null;
  if (PORTAL_NAMES.test(s)) return null;
  return s;
}

/**
 * Try to recover legal employer name from title + JD (e.g. "… EN CORRUFACIL S.A. DE C.V.").
 */
export function extractCompanyNameFromJd(title: string, jd: string): string | null {
  const blob = `${title || ''}\n${jd || ''}`.replace(/\r/g, '\n');
  if (!blob.trim()) return null;

  const patterns: RegExp[] = [
    /\bEN\s+([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑ0-9\s.\-&]{2,58}?)\s+S\.\s*A\.\s*DE\s*C\.\s*V\./i,
    /\b([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑ0-9\s.\-&]{2,58}?)\s+S\.\s*A\.\s*DE\s*C\.\s*V\./i,
    /\b([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑ0-9\s.\-&]{2,58}?)\s+S\.\s*DE\s*R\.\s*L\.\s*DE\s*C\.\s*V\./i,
    /(?:empresa|compañia|companhia|razón social|razao social)\s*[:：]\s*([^\n,]{3,80})/i,
  ];

  for (const re of patterns) {
    const m = blob.match(re);
    if (m?.[1]) {
      const hit = cleanCompanyName(m[1]);
      if (hit) return hit;
    }
  }

  return null;
}

export function isPlaceholderEmployerName(name: string) {
  const s = String(name || '').trim();
  if (!s) return true;
  return PORTAL_NAMES.test(s);
}
