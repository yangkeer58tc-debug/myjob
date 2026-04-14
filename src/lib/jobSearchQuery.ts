/**
 * PostgREST parses `col.op.value` by splitting on `.`; values that contain `.` (or other
 * reserved chars) must be double-quoted or the whole `or=(...)` clause can fail silently
 * and return unfiltered rows.
 */
function postgrestDoubleQuotedValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '""')}"`;
}

export type JobTextSearchRow = {
  title?: string | null;
  b_name?: string | null;
  summary?: string | null;
  description?: string | null;
  requirements?: string | null;
  industry?: string | null;
  salary_amount?: string | null;
};

const normFold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Same semantics as the multi-column `ilike %q%` OR in `jobsTextSearchOrFilter`, but
 * evaluated client-side (accent-folded) to hide PostgREST parse failures or edge cases.
 */
export function jobMatchesJobsTextSearch(job: JobTextSearchRow, q: string): boolean {
  const raw = q
    .trim()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  if (!raw) return true;
  const needle = normFold(raw);
  if (!needle) return true;
  const parts = [
    job.title,
    job.b_name,
    job.summary,
    job.description,
    job.requirements,
    job.industry,
    job.salary_amount,
  ]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => normFold(String(v)));
  return parts.some((h) => h.includes(needle));
}

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
  const quoted = postgrestDoubleQuotedValue(pattern);
  const cols = ['title', 'b_name', 'summary', 'description', 'requirements', 'industry', 'salary_amount'] as const;
  return cols.map((c) => `${c}.ilike.${quoted}`).join(',');
}
