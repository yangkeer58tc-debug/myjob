const MYJOB_BRAND_PATH = /\/brand-logo\.(jpg|jpeg|png|webp)(\?|$)/i;

/** Strip BOM, Excel formula prefix, and CSV wrapping quotes from a cell value. */
export function stripCsvCellDecorations(raw: string): string {
  let s = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  if (s.startsWith('="') && s.endsWith('"')) s = s.slice(2, -1).trim();
  else if (s.startsWith('=')) s = s.slice(1).trim();
  while (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.trim();
}

const EXPLICIT_LOGO_ROW_KEYS = [
  'b_logo_url',
  'logo_url',
  'company_logo_url',
  'company_logo',
  'logo',
  'employer_logo',
  'employer_logo_url',
  'image_url',
  'thumbnail_url',
  'company_image',
  'brand_logo',
  'squarelogo',
];

/** Keys like `Logo`, `company_logo`, `logo_image` after CSV header normalization. */
function rowKeyLooksLikeLogoColumn(key: string): boolean {
  const k = key.toLowerCase();
  if (k === 'logo') return true;
  if (k.startsWith('logo_')) return true;
  if (k.endsWith('_logo')) return true;
  if (k.includes('_logo_')) return true;
  return false;
}

/** First non-empty logo cell from a normalized (lowercase keys) CSV row. */
export function collectFirstEmployerLogoRaw(row: Record<string, string>): string {
  for (const k of EXPLICIT_LOGO_ROW_KEYS) {
    const v = stripCsvCellDecorations(row[k] ?? '');
    if (v) return v;
  }
  for (const [k, raw] of Object.entries(row)) {
    if (!rowKeyLooksLikeLogoColumn(k)) continue;
    const v = stripCsvCellDecorations(raw ?? '');
    if (v && /^https?:\/\//i.test(v)) return v;
  }
  return '';
}

/** True if URL looks like a company logo image (not a generic profile page). */
export function looksLikeCompanyLogoUrl(raw: string): boolean {
  const u = stripCsvCellDecorations(raw);
  if (!/^https?:\/\//i.test(u)) return false;
  if (MYJOB_BRAND_PATH.test(u)) return false;
  const lower = u.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(lower)) return true;
  if (lower.includes('squarelogo') || lower.includes('/logo') || lower.includes('logo/')) return true;
  if (lower.includes('cloudfront.net')) return true;
  return false;
}

export function normalizeImportedEmployerLogoUrl(raw: string | undefined | null): string | null {
  const u = stripCsvCellDecorations(String(raw ?? ''));
  if (!u) return null;
  if (MYJOB_BRAND_PATH.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) return null;
  return u;
}
