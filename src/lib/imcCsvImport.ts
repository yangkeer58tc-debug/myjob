import { collectFirstEmployerLogoRaw, looksLikeCompanyLogoUrl, stripCsvCellDecorations } from '@/lib/jobLogoUrl';
import { normalizeIndustryLabelForMexico } from '@/lib/industryEsMx';
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
  const hasCategoryCol =
    set.has('category_full_path') || set.has('category_1') || set.has('category_path');
  const hasAuthorNameCol = set.has('author_name') || set.has('author_na');
  const hasAuthorProfileCol = set.has('author_profile') || set.has('author_pro');
  const fixedHeader =
    set.has('id') &&
    set.has('origin_id') &&
    hasCategoryCol &&
    set.has('title') &&
    set.has('amount') &&
    set.has('company') &&
    set.has('description') &&
    set.has('location') &&
    set.has('latitude') &&
    set.has('longitude') &&
    hasAuthorNameCol &&
    hasAuthorProfileCol &&
    set.has('create_at') &&
    set.has('ext');
  if (fixedHeader) return true;
  if (set.has('category_full_path')) return true;
  /** Title / Company / Logo / … job-board style sheets (even if a `b_name` column exists empty). */
  if (set.has('company') && set.has('logo')) return true;
  if (set.has('company') && !set.has('b_name')) return true;
  return false;
}

const pick = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = stripCsvCellDecorations(String(row[k] ?? ''));
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

function firstHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s) return '';
  const direct = stripCsvCellDecorations(s);
  if (/^https?:\/\//i.test(direct)) return direct;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : '';
}

function inferIndeedUrlFromOriginId(originIdRaw: string): string {
  const originId = String(originIdRaw || '').trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(originId)) return '';
  return `https://mx.indeed.com/viewjob?jk=${originId}`;
}

/** Pull best-effort original post URL from IMC row/ext; falls back to Indeed URL from origin_id. */
export function sourceJobUrlFromImc(row: Record<string, string>): string {
  const fromColumns = firstHttpUrl(
    pick(
      row,
      'src_url',
      'source_url',
      'job_url',
      'post_url',
      'url',
      'origin_url',
      'same_as',
      'b_same_as',
      'external_url',
    ),
  );
  if (fromColumns) return fromColumns;

  const parsedExt = tryParseJson(pick(row, 'ext'));
  if (parsedExt && typeof parsedExt === 'object') {
    const ext = parsedExt as Record<string, unknown>;
    const fromExt =
      firstHttpUrl(ext.source_url) ||
      firstHttpUrl(ext.job_url) ||
      firstHttpUrl(ext.post_url) ||
      firstHttpUrl(ext.url) ||
      firstHttpUrl(ext.origin_url) ||
      firstHttpUrl(ext.indeed_url);
    if (fromExt) return fromExt;
  }

  return inferIndeedUrlFromOriginId(pick(row, 'origin_id'));
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
  const b_name = pick(row, 'b_name', 'company', 'author_name', 'author_na');
  const category =
    pick(row, 'category') ||
    categoryIdFromFullPath(pick(row, 'category_full_path', 'category_path', 'category_1'));
  const industryRaw = pick(row, 'industry') || industryFromExtJson(pick(row, 'ext'));
  const industry = industryRaw ? normalizeIndustryLabelForMexico(industryRaw) : '';
  const salaryFromAmount = salaryHintFromAmountJson(pick(row, 'amount'));
  const authorPro = pick(row, 'author_profile', 'author_pro');
  const fromCols = collectFirstEmployerLogoRaw(row);
  const b_logo_url = fromCols || (authorPro && looksLikeCompanyLogoUrl(authorPro) ? authorPro : '');
  const sourceJobUrl = sourceJobUrlFromImc(row);
  const b_same_as_hint =
    sourceJobUrl ||
    pick(row, 'b_same_as', 'company_url', 'website', 'employer_url') ||
    (authorPro && /^https?:\/\//i.test(authorPro) && !looksLikeCompanyLogoUrl(authorPro) ? authorPro : '');

  return {
    ...row,
    id: id || row.id,
    b_name: b_name || row.b_name,
    b_same_as: b_same_as_hint || row.b_same_as || '',
    street_address:
      pick(row, 'street_address', 'direccion', 'calle', 'address_line', 'domicilio') || row.street_address || '',
    category: category || row.category,
    industry: industry || (row.industry ? normalizeIndustryLabelForMexico(row.industry) : ''),
    salary_amount: pick(row, 'salary_amount') || salaryFromAmount,
    location: pick(row, 'location') || row.location,
    title: pick(row, 'title', 'job_title') || row.title,
    description: pick(row, 'description') || row.description,
    requirements: pick(row, 'requirements') || row.requirements || '',
    summary: pick(row, 'summary') || row.summary || '',
    highlights: pick(row, 'highlights') || row.highlights || '',
    b_logo_url,
    job_type: pick(row, 'job_type', 'employment_type') || row.job_type || '',
    workplace_type: pick(row, 'workplace_type') || row.workplace_type || '',
    payment_frequency: pick(row, 'payment_frequency') || row.payment_frequency || '',
    education_level: pick(row, 'education_level') || row.education_level || '',
    language_req: pick(row, 'language_req') || row.language_req || '',
    experience: pick(row, 'experience') || row.experience || '',
    is_active: pick(row, 'is_active') || row.is_active || 'TRUE',
  };
}
