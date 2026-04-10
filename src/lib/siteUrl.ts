/** Public site origin, no trailing slash. Prefer VITE_SITE_URL in production for stable canonicals. */
export function getSiteOrigin(): string {
  const fromEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SITE_URL
    ? String(import.meta.env.VITE_SITE_URL).trim()
    : '';
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://myjob.com';
}

/** Normalize job datePosted for JobPosting schema (ISO 8601). */
export function toIsoDatePosted(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Resolve logo or asset href to absolute https URL for schema / OG. */
export function toAbsoluteUrl(href: string | null | undefined, origin: string): string | undefined {
  if (!href) return undefined;
  const s = String(href).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  const base = origin.replace(/\/+$/, '');
  return `${base}${s.startsWith('/') ? '' : '/'}${s}`;
}

export function safeJsonLdStringify(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');
}
