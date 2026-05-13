import Papa from 'papaparse';
import { fallbackHighlightsFromDescription } from '@/lib/jobSummaryAi';
import { normalizeJobTitle, normalizeJobTextFields } from '@/lib/jobTextUtils';

export const OK_MX_EMPLOYER_NAME = 'OK.com Jobs';
/** Earlier imports used this display name; keep for exports / filters. */
export const OK_MX_LEGACY_EMPLOYER_NAMES = ['ok.com招聘'] as const;
export const OK_MX_LOGO_PUBLIC_PATH = '/employers/okcom-recruitment-logo.jpg';
export const OK_MX_EXTERNAL_SOURCE = 'ok_mx_real';

export function isMxRealPostsCsvHeader(fields: string[] | undefined): boolean {
  if (!fields?.length) return false;
  const f = new Set(fields.map((x) => String(x || '').trim().toLowerCase()));
  return f.has('info_id') && f.has('cate_code') && f.has('content');
}

export type MxCategoryInfo = {
  code: string;
  categoryId: string;
  path: string;
  nameEs: string;
  nameEn: string;
};

export function parseMxCategoryCsvText(text: string): Map<string, MxCategoryInfo> {
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const map = new Map<string, MxCategoryInfo>();
  for (const row of result.data || []) {
    const code = String(row.code ?? '').trim();
    if (!code) continue;
    let nameEs = '';
    let nameEn = '';
    const nameRaw = String(row.name ?? '').trim();
    if (nameRaw) {
      try {
        const j = JSON.parse(nameRaw) as { es?: string; en?: string };
        nameEs = String(j.es ?? '').trim();
        nameEn = String(j.en ?? '').trim();
      } catch {
        nameEs = nameRaw;
      }
    }
    map.set(code, {
      code,
      categoryId: String(row.categoryId ?? '').trim(),
      path: String(row.path ?? '').trim(),
      nameEs,
      nameEn,
    });
  }
  return map;
}

/**
 * Map MX category CSV `path` (e.g. `jobs,sales,sales-reps-consultants`) to one of the five site `jobs.category` ids.
 * Uses the **second path segment** under `jobs` (same taxonomy as your MX category export).
 */
export function mapMxCategoryPathToSiteCategory(mxPath: string): string {
  const segs = String(mxPath || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length < 2 || segs[0] !== 'jobs') return 'trades-services';
  const root = segs[1];
  if (root === 'call-center-customer-service') return 'call-center-customer-service';
  if (root === 'healthcare-medical') return 'healthcare-medical';
  if (root === 'mfg-transport-logistics') return 'mfg-transport-logistics';
  if (root === 'sales') return 'sales';
  if (root === 'retail-consumer-products' || root === 'real-estate-property') return 'sales';
  return 'trades-services';
}

function isPlaceholderLocationToken(raw: string): boolean {
  const t = String(raw ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (!t) return true;
  return (
    t === 'n' ||
    t === '/n' ||
    t === 'na' ||
    t === 'n/a' ||
    t === '-' ||
    t === '--' ||
    t === 'null' ||
    t === 'undefined' ||
    t === 'mexico' ||
    t === 'mx' ||
    t === 'unknown' ||
    t === 'sin ubicacion' ||
    t === 'sin ubicación' ||
    t === 's/u'
  );
}

function prettifyLocalCode(code: string): string {
  const c = String(code ?? '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!c || isPlaceholderLocationToken(c)) return '';
  return c.replace(/\b\w/g, (x) => x.toUpperCase());
}

/** Build one line from Google-style `addressComponents` array (longText + types). */
function lineFromAddressComponentArray(arr: Array<{ longText?: string; types?: string[] }>): string {
  const parts: string[] = [];
  const prefer = [
    'sublocality_level_1',
    'sublocality',
    'locality',
    'administrative_area_level_2',
    'administrative_area_level_1',
  ] as const;
  for (const typ of prefer) {
    const hit = arr.find((x) => x.types?.includes(typ));
    const lt = String(hit?.longText ?? '').trim();
    if (!lt || isPlaceholderLocationToken(lt)) continue;
    if (!parts.includes(lt)) parts.push(lt);
  }
  const countryHit = arr.find((x) => x.types?.includes('country'));
  const ctry = String(countryHit?.longText ?? '').trim();
  if (parts.length > 0 && ctry && !isPlaceholderLocationToken(ctry)) {
    const label = ctry === 'Mexico' ? 'México' : ctry;
    if (!parts.includes(label)) parts.push(label);
  }
  return parts.join(', ').trim();
}

/** Parse `para` field key `66` (Google-style address object) for locality / state. */
function locationFromPara66(para: string): string | null {
  if (!para?.trim()) return null;
  try {
    const o = JSON.parse(para) as Record<string, unknown>;
    const raw66 = o['66'];
    if (typeof raw66 !== 'string') return null;
    const inner = JSON.parse(raw66) as {
      detail?: string;
      standard?: Record<string, string>;
      addressComponents?: Array<{ longText?: string; types?: string[] }>;
    };

    if (Array.isArray(inner.addressComponents) && inner.addressComponents.length > 0) {
      const acLine = lineFromAddressComponentArray(inner.addressComponents);
      if (acLine) return acLine;
    }

    const std = inner?.standard;
    const parts: string[] = [];
    const locality = std?.locality || std?.administrative_area_level_2;
    const a1 = std?.administrative_area_level_1;
    const country = std?.country;
    const detail = String(inner?.detail ?? '').trim();

    const push = (x: string) => {
      const v = x.trim();
      if (!v || isPlaceholderLocationToken(v)) return;
      if (!parts.includes(v)) parts.push(v);
    };

    if (locality) push(locality);
    if (a1 && a1 !== locality) push(a1);
    if (detail && detail !== locality && detail !== a1) push(detail);
    if (country && !isPlaceholderLocationToken(country) && parts.length > 0) {
      push(country === 'Mexico' ? 'México' : country);
    }
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}

/**
 * Prefer structured address (`addresscomponents`, then `para` 66), then `local_name` / `local_code`.
 * Generic country-only → **México** as default.
 */
export function resolveMxJobLocation(row: Record<string, string>): string {
  const geo = String(row.mx_geocoded_location ?? '').trim();
  if (geo) return geo;

  const parts: string[] = [];
  const ac = String(row.addresscomponents ?? '').trim();

  if (ac) {
    try {
      const arr = JSON.parse(ac) as Array<{ longText?: string; types?: string[] }>;
      if (Array.isArray(arr)) {
        const acLine = lineFromAddressComponentArray(arr);
        if (acLine) {
          for (const seg of acLine.split(',').map((s) => s.trim())) {
            if (seg && !parts.includes(seg)) parts.push(seg);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  let line = parts.join(', ').trim();

  const collapseMexicoOnly = (s: string) => {
    const t = s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    return t === 'mexico' || t === 'méxico' || t === 'mx';
  };

  if (!line || collapseMexicoOnly(line)) {
    const fromPara = locationFromPara66(String(row.para ?? ''));
    if (fromPara && !collapseMexicoOnly(fromPara)) line = fromPara;
  }

  const ln = String(row.local_name ?? '').trim();
  if ((!line || collapseMexicoOnly(line)) && ln && !isPlaceholderLocationToken(ln)) {
    line = ln;
  }

  const lc = prettifyLocalCode(String(row.local_code ?? ''));
  if ((!line || collapseMexicoOnly(line)) && lc && !isPlaceholderLocationToken(lc)) {
    line = lc;
  }

  if (!line || collapseMexicoOnly(line)) return 'México';
  return line;
}

function formatMxAmount(amountRaw: string): string {
  const raw = String(amountRaw ?? '').trim();
  if (!raw) return 'A convenir';
  if (raw.includes('_')) {
    const [a, b] = raw.split('_');
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      return `$${na.toLocaleString('es-MX')} – $${nb.toLocaleString('es-MX')} MXN`;
    }
  }
  const n = Number(raw);
  if (!Number.isNaN(n) && n > 0) return `$${n.toLocaleString('es-MX')} MXN`;
  return raw;
}

function parsePaymentFromPara(para: string): 'mensal' | 'semanal' | 'quinzenal' | 'diario' | 'hora' | 'a-combinar' {
  if (!para?.trim()) return 'mensal';
  try {
    const o = JSON.parse(para) as Record<string, unknown>;
    const raw67 = o['67'];
    if (typeof raw67 !== 'string') return 'mensal';
    const inner = JSON.parse(raw67) as { unit?: { id?: number } };
    const uid = inner?.unit?.id;
    if (uid === 3) return 'semanal';
    if (uid === 4) return 'mensal';
    return 'mensal';
  } catch {
    const m = /"unit"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/.exec(para);
    if (m?.[1] === '3') return 'semanal';
    return 'mensal';
  }
}

function extractStreetFromAddressComponents(json: string): string | null {
  if (!json?.trim()) return null;
  try {
    const arr = JSON.parse(json) as Array<{ longText?: string; types?: string[] }>;
    if (!Array.isArray(arr)) return null;
    const route = arr.find((x) => x.types?.includes('route'));
    if (route?.longText) return route.longText;
    return null;
  } catch {
    return null;
  }
}

export type OkMxJobUpsertRow = {
  id: string;
  b_name: string;
  b_logo_url: string | null;
  title: string;
  slug: string | null;
  category: string | null;
  salary_amount: string;
  payment_frequency: string;
  location: string;
  job_type: string;
  workplace_type: string;
  summary: string | null;
  description: string | null;
  requirements: string | null;
  highlights: string[] | null;
  education_level: string | null;
  industry: string | null;
  language_req: string | null;
  experience: string | null;
  is_active: boolean;
  external_source: string | null;
  mx_category_code: string | null;
  b_same_as: string | null;
  street_address: string | null;
};

/** When prod DB has not run MX migration yet, PostgREST rejects unknown columns — retry without them. */
export function isJobsMissingMxExtensionColumnError(message: string): boolean {
  const m = String(message || '').toLowerCase();
  if (m.includes('pgrst204')) return true;
  if (!m.includes('column')) return false;
  return m.includes('external_source') || m.includes('mx_category_code');
}

export function okMxJobRowForLegacyJobsTable(
  row: OkMxJobUpsertRow,
): Omit<OkMxJobUpsertRow, 'external_source' | 'mx_category_code'> {
  const { external_source: _e, mx_category_code: _m, ...rest } = row;
  return rest;
}

/**
 * Build `jobs` upsert rows from MX export rows. Uses numeric `info_id` as `jobs.id` so `/empleo/...-{id}` parsing stays valid.
 * Expects `title` / `content` already in Spanish when non-`es` rows were translated upstream.
 */
export function buildOkMxJobRows(
  rows: Record<string, string>[],
  categoryByCode: Map<string, MxCategoryInfo>,
): OkMxJobUpsertRow[] {
  const out: OkMxJobUpsertRow[] = [];
  for (const row of rows) {
    const infoId = String(row.info_id ?? '').trim();
    if (!infoId) continue;
    const title = normalizeJobTitle(String(row.title ?? '').trim()) || 'Vacante';
    const content = String(row.content ?? '').trim();
    const cateCode = String(row.cate_code ?? '').trim();
    const para = String(row.para ?? '');
    const addr = String(row.addresscomponents ?? '');

    const nt = normalizeJobTextFields({ summary: null, description: content || null, requirements: null });
    const desc = nt.description;
    const sum = desc && desc.length > 240 ? `${desc.slice(0, 237).trim()}…` : desc || null;

    const catMeta = cateCode ? categoryByCode.get(cateCode) : undefined;
    const mxPath = catMeta?.path ?? '';
    const siteCat = mapMxCategoryPathToSiteCategory(mxPath);

    const payment = parsePaymentFromPara(para);
    const periodLabel = payment === 'semanal' ? 'semana' : 'mes';
    const salaryAmount = `${formatMxAmount(String(row.amount ?? ''))} (${periodLabel})`;

    const hl = desc ? fallbackHighlightsFromDescription(desc) : [];

    out.push({
      id: infoId,
      b_name: OK_MX_EMPLOYER_NAME,
      b_logo_url: OK_MX_LOGO_PUBLIC_PATH,
      title,
      slug: `mx-${infoId}`,
      category: siteCat,
      salary_amount: salaryAmount,
      payment_frequency: payment,
      location: resolveMxJobLocation(row),
      job_type: 'tempo-integral',
      workplace_type: 'presencial',
      summary: sum,
      description: desc,
      requirements: null,
      highlights: hl.length ? hl.slice(0, 5) : null,
      education_level: null,
      industry: catMeta?.nameEs ? `MX · ${catMeta.nameEs}` : cateCode ? `MX · ${cateCode}` : null,
      language_req: 'Español',
      experience: null,
      is_active: true,
      external_source: OK_MX_EXTERNAL_SOURCE,
      mx_category_code: cateCode || null,
      b_same_as: null,
      street_address: extractStreetFromAddressComponents(addr),
    });
  }
  return out;
}
