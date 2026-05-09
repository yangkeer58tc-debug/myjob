// Tolerant secret-URL normalization. Operators frequently paste the
// PostgREST endpoint or a wrong path; we strip the suffix and force the
// expected path so /ai-extract is always reachable and createClient gets
// the bare project origin.

/** Returns `https://<host>` (no path), tolerating trailing `/rest/v1/`, `/`, etc. */
export function normalizeSupabaseProjectUrl(raw: unknown): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/** Forces the path on an arbitrary URL (handy when operators paste `/import/ai-extract`). */
export function forceUrlPath(raw: unknown, path: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const desired = path.startsWith('/') ? path : `/${path}`;
  try {
    const u = new URL(trimmed);
    u.pathname = desired;
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}
