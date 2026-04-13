import { CATEGORY_OPTIONS } from '@/lib/jobOptions';

const normKey = (k: string) => k.replace(/^\uFEFF/, '').trim().toLowerCase();

/** Lowercase keys and strip UTF-8 BOM from the first header for stable lookups. */
export function normalizeCsvRecordKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[normKey(k)] = v == null ? '' : String(v);
  }
  return out;
}

export function isImcExportCsv(fieldNames: string[]): boolean {
  const set = new Set(fieldNames.map(normKey));
  if (set.has('category_full_path')) return true;
  if (set.has('company') && !set.has('b_name')) return true;
  return false;
}

const pick = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = String(row[k] ?? '').trim();
    if (v) return v;
  }
  return '';
};

function tryParseJson(raw: string): unknown {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

/** Map IMC `category_full_path` (e.g. "Jobs > Salud > …") to a site category id when possible. */
export function categoryIdFromFullPath(fullPath: string): string {
  const path = simplifyPath(fullPath);
  if (!path) return '';

  const rules: Array<{ re: RegExp; id: string }> = [
    { re: /\b(salud|sa[uú]de|health|m[eé]dic|clinic|hospital|nutrici|enfermer|farmacia|tecnolog[ií]a\s+en\s+la\s+salud)\b/, id: 'healthcare-medical' },
    { re: /\b(call\s*center|atenci[oó]n|atendimento|customer|contact\s*center|telemarketing)\b/, id: 'call-center-customer-service' },
    { re: /\b(venta|vendas|sales|comercial)\b/, id: 'sales' },
    { re: /\b(log[ií]stica|transporte|almac[eé]n|warehouse|reparto|mensajer[ií]a)\b/, id: 'mfg-transport-logistics' },
    { re: /\b(servicio|services|mantenimiento|limpieza|obrero|t[eé]cnico\s+de\s+campo)\b/, id: 'trades-services' },
  ];
  for (const { re, id } of rules) {
    if (re.test(path)) return id;
  }

  const last = path.split('>').pop()?.trim() || '';
  for (const opt of CATEGORY_OPTIONS) {
    if (simplifyPath(opt.label) === simplifyPath(last)) return opt.id;
  }
  return '';
}

function simplifyPath(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Pull `industry` (or similar) from IMC `ext` JSON. */
export function industryFromExtJson(extRaw: string): string {
  const parsed = tryParseJson(extRaw);
  if (!parsed || typeof parsed !== 'object') return '';
  const o = parsed as Record<string, unknown>;
  const industry = o.industry ?? o.Industry;
  if (typeof industry === 'string' && industry.trim()) return industry.trim();
  return '';
}

/**
 * Best-effort salary hint from IMC `amount` JSON. Shapes vary by source;
 * falls back to empty string when unknown.
 */
export function salaryHintFromAmountJson(amountRaw: string): string {
  const parsed = tryParseJson(amountRaw);
  if (!parsed || typeof parsed !== 'object') return '';
  const o = parsed as Record<string, unknown>;

  const scalar = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v));
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(n) && n > 0) return String(Math.round(n));
    }
    return '';
  };

  const minN = typeof o.min === 'number' ? o.min : typeof o.min === 'string' ? Number(o.min) : NaN;
  const maxN = typeof o.max === 'number' ? o.max : typeof o.max === 'string' ? Number(o.max) : NaN;
  if (Number.isFinite(minN) && Number.isFinite(maxN) && minN > 0 && maxN >= minN) {
    return String(Math.round((minN + maxN) / 2));
  }

  const direct =
    scalar(o.amount) ||
    scalar(o.value) ||
    scalar(o.max) ||
    scalar(o.min) ||
    scalar(o.monthly) ||
    scalar(o.salary);
  if (direct) return direct;

  const nested = o.value;
  if (nested && typeof nested === 'object') {
    const v = nested as Record<string, unknown>;
    const r = scalar(v.amount) || scalar(v.max) || scalar(v.min);
    if (r) return r;
  }

  return '';
}

/**
 * Turn an IMC export row (already key-normalized) into the classic CSV column
 * shape expected by Admin import (`b_name`, `category`, …).
 */
export function mergeImcColumnsIntoClassicRow(row: Record<string, string>): Record<string, string> {
  const id = pick(row, 'id', 'origin_id');
  const b_name = pick(row, 'b_name', 'company', 'author_na', 'author_name');
  const category =
    pick(row, 'category') || categoryIdFromFullPath(pick(row, 'category_full_path'));
  const industry = pick(row, 'industry') || industryFromExtJson(pick(row, 'ext'));
  const salaryFromAmount = salaryHintFromAmountJson(pick(row, 'amount'));

  return {
    ...row,
    id: id || row.id,
    b_name: b_name || row.b_name,
    category: category || row.category,
    industry: industry || row.industry,
    salary_amount: pick(row, 'salary_amount') || salaryFromAmount,
    location: pick(row, 'location') || row.location,
    title: pick(row, 'title') || row.title,
    description: pick(row, 'description') || row.description,
    requirements: pick(row, 'requirements') || row.requirements || '',
    summary: pick(row, 'summary') || row.summary || '',
    highlights: pick(row, 'highlights') || row.highlights || '',
    b_logo_url: pick(row, 'b_logo_url') || row.b_logo_url || '',
    job_type: pick(row, 'job_type') || row.job_type || '',
    workplace_type: pick(row, 'workplace_type') || row.workplace_type || '',
    payment_frequency: pick(row, 'payment_frequency') || row.payment_frequency || '',
    education_level: pick(row, 'education_level') || row.education_level || '',
    language_req: pick(row, 'language_req') || row.language_req || '',
    experience: pick(row, 'experience') || row.experience || '',
    is_active: pick(row, 'is_active') || row.is_active || 'TRUE',
  };
}
