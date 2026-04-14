/**
 * Build PostgREST `.or()` fragment for multi-column case-insensitive search on `jobs`.
 * Returns null when the query is empty after trim.
 */
export function jobsTextSearchOrFilter(q: string): string | null {
  const raw = q
    .trim()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  if (!raw) return null;

  const escaped = raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const pattern = `%${escaped}%`;
  const cols = ['title', 'b_name', 'summary', 'description', 'requirements', 'industry'] as const;
  return cols.map((c) => `${c}.ilike.${pattern}`).join(',');
}
