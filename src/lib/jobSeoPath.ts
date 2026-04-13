/** SEO-friendly job URLs: /empleo/{slug}-{id}/ — legacy /empleo/{id}/ still resolves and redirects. */

export function slugifyJobSegment(value: string): string {
  const s = String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'empleo';
}

export function jobPublicPath(job: { id: string; title?: string | null; slug?: string | null }): string {
  const head = (job.slug && String(job.slug).trim()) ? slugifyJobSegment(job.slug) : slugifyJobSegment(String(job.title || ''));
  return `/empleo/${head}-${job.id}/`;
}

export type ParsedEmpleo =
  | { kind: 'id'; id: string }
  | { kind: 'slug'; slug: string };

/** Parse :id route param — numeric id, slug-id compound, or legacy slug-only. */
export function parseEmpleoParam(param: string): ParsedEmpleo {
  const raw = String(param || '').trim();
  if (!raw) return { kind: 'id', id: '' };

  if (/^\d+$/.test(raw)) {
    return { kind: 'id', id: raw };
  }

  /** Last `-digits` segment is treated as DB id (IMC / external ids are often 6–12 digits). */
  const hyphenIdx = raw.lastIndexOf('-');
  if (hyphenIdx >= 1) {
    const tail = raw.slice(hyphenIdx + 1);
    if (/^\d{4,}$/.test(tail)) {
      return { kind: 'id', id: tail };
    }
  }

  return { kind: 'slug', slug: raw };
}

export function isLegacyNumericEmpleoPath(pathname: string, jobId: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p === `/empleo/${jobId}` || p === `/empleo/${jobId}/`;
}
