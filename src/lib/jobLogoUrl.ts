const MYJOB_BRAND_PATH = /\/brand-logo\.(jpg|jpeg|png|webp)(\?|$)/i;

/** True if URL looks like a company logo image (not a generic profile page). */
export function looksLikeCompanyLogoUrl(raw: string): boolean {
  const u = String(raw || '').trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (MYJOB_BRAND_PATH.test(u)) return false;
  const lower = u.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(lower)) return true;
  if (lower.includes('squarelogo') || lower.includes('/logo') || lower.includes('logo/')) return true;
  if (lower.includes('cloudfront.net') && (lower.includes('logo') || lower.includes('image'))) return true;
  return false;
}

export function normalizeImportedEmployerLogoUrl(raw: string | undefined | null): string | null {
  const u = String(raw ?? '').trim();
  if (!u) return null;
  if (MYJOB_BRAND_PATH.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) return null;
  return u;
}
