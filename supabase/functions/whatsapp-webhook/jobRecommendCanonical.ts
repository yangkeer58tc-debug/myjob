// Map OK MX `cate_code` + IMC-ish free text into the same five `jobs.category` ids used on MyJob.
import { MX_CODE_TO_SITE_CATEGORY } from './mxCodeToSiteCategoryMap.generated.ts';

const SITE_CATEGORY_IDS = new Set([
  'healthcare-medical',
  'call-center-customer-service',
  'sales',
  'mfg-transport-logistics',
  'trades-services',
]);

const mxMap = MX_CODE_TO_SITE_CATEGORY as Record<string, string>;

function simplifyBlob(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * IMC-style heuristics (aligned with `categoryIdFromFullPath` in src/lib/imcCsvImport.ts)
 * applied to title / industry / summary when `category` is missing or non-canonical.
 */
function inferSiteCategoryFromTextBlob(raw: string): string | null {
  const path = simplifyBlob(raw);
  if (!path) return null;

  const rules: Array<{ re: RegExp; id: string }> = [
    { re: /\b(salud|saude|health|m[eé]dic|clinic|hospital|nutrici|enfermer|farmacia|dental|enfermer[ií]a)\b/, id: 'healthcare-medical' },
    {
      re: /\b(call\s*center|atenci[oó]n|atendimento|customer|contact\s*center|telemarketing|help\s*desk|mesa\s+de\s+ayuda)\b/,
      id: 'call-center-customer-service',
    },
    { re: /\b(venta|vendas|sales|comercial|vendedor|promotor|mostrador)\b/, id: 'sales' },
    {
      re: /\b(log[ií]stica|transporte|almac[eé]n|warehouse|reparto|mensajer[ií]a|chofer|conductor|supply\s*chain)\b/,
      id: 'mfg-transport-logistics',
    },
    {
      re: /\b(servicio|services|mantenimiento|limpieza|obrero|t[eé]cnico\s+de\s+campo|jardinero|seguridad\s+privada)\b/,
      id: 'trades-services',
    },
  ];
  for (const { re, id } of rules) {
    if (re.test(path)) return id;
  }
  return null;
}

export type JobCategorySource = {
  category: string | null;
  mx_category_code: string | null;
  industry: string | null;
  title: string | null;
  summary: string | null;
};

/**
 * Best-effort canonical MyJob category id for cross-source (OK MX vs IMC) recommendation matching.
 */
export function canonicalSiteCategory(job: JobCategorySource): string | null {
  const c = String(job.category ?? '').trim();
  if (c && SITE_CATEGORY_IDS.has(c)) return c;

  const code = String(job.mx_category_code ?? '').trim();
  if (code && mxMap[code]) {
    const mapped = mxMap[code];
    if (SITE_CATEGORY_IDS.has(mapped)) return mapped;
  }

  const industryStripped = String(job.industry ?? '')
    .replace(/^mx\s*[·.:]\s*/iu, '')
    .trim();
  const blob = [job.title, industryStripped, job.summary, c].filter(Boolean).join(' ');
  return inferSiteCategoryFromTextBlob(blob);
}
