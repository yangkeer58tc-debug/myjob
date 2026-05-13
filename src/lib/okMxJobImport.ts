import Papa from 'papaparse';
import { fallbackHighlightsFromDescription } from '@/lib/jobSummaryAi';
import { normalizeJobTitle, normalizeJobTextFields } from '@/lib/jobTextUtils';

export const OK_MX_EMPLOYER_NAME = 'ok.com招聘';
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

function mapCateCodeToSiteCategory(cateCode: string): string {
  const c = cateCode.toLowerCase();
  if (/cust-service|call|atencion|support|telefon|helpdesk|mesa|recepcion|recepci/i.test(c)) {
    return 'call-center-customer-service';
  }
  if (/sales|venta|vendedor|comercial|merchant/i.test(c)) return 'sales';
  if (/logistics|transport|courier|driver|chofer|reparto|almacen|warehouse/i.test(c)) {
    return 'mfg-transport-logistics';
  }
  if (/health|medical|nurse|hospital|clinic|dental|nutri/i.test(c)) return 'healthcare-medical';
  return 'trades-services';
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

/**
 * Build `jobs` upsert rows from MX export rows. Uses numeric `info_id` as `jobs.id` so `/empleo/...-{id}` parsing stays valid.
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
    const localName = String(row.local_name ?? '').trim();
    const para = String(row.para ?? '');
    const addr = String(row.addresscomponents ?? '');

    const nt = normalizeJobTextFields({ summary: null, description: content || null, requirements: null });
    const desc = nt.description;
    const sum = desc && desc.length > 240 ? `${desc.slice(0, 237).trim()}…` : desc || null;

    const catMeta = cateCode ? categoryByCode.get(cateCode) : undefined;
    const siteCat = mapCateCodeToSiteCategory(cateCode);

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
      location: localName || 'México',
      job_type: 'tempo-integral',
      workplace_type: 'presencial',
      summary: sum,
      description: desc,
      requirements: null,
      highlights: hl.length ? hl.slice(0, 5) : null,
      education_level: null,
      industry: catMeta?.nameEs ? `MX · ${catMeta.nameEs}` : cateCode ? `MX · ${cateCode}` : null,
      language_req: String(row.language ?? '').toLowerCase() === 'es' ? 'Español' : null,
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
