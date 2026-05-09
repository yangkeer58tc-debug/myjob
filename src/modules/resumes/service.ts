import { getResumesSource, resumesSupabase } from '@/integrations/resumes/client';
import type { ListResumesParams, ResumeListItem, ResumeListResult, ResumeRecord } from './types';

const asText = (value: unknown): string => String(value ?? '').trim();

const buildName = (row: ResumeRecord): string => {
  const name = asText(row.name);
  if (name) return name;
  const first = asText(row.first_name);
  const last = asText(row.last_name);
  return [first, last].filter(Boolean).join(' ') || '-';
};

const mapToListItem = (row: ResumeRecord): ResumeListItem => ({
  id: asText(row.id),
  name: buildName(row),
  jobDirection: asText(row.job_direction) || null,
  profileSummary: asText(row.profile_summary) || null,
  updatedAt: asText(row.updated_at) || asText(row.created_at) || null,
  raw: row,
});

export const listResumes = async (params: ListResumesParams): Promise<ResumeListResult> => {
  if (!resumesSupabase) return { rows: [], count: 0 };

  const source = getResumesSource();
  const from = Math.max(0, (params.page - 1) * params.pageSize);
  const to = from + params.pageSize - 1;

  let req = resumesSupabase
    .from(source.tableOrView)
    .select('id,name,first_name,last_name,job_direction,profile_summary,updated_at,created_at', {
      count: 'exact',
    })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  const needle = String(params.query || '').trim();
  if (needle) {
    const escaped = needle.replaceAll(',', ' ');
    req = req.or(
      `name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,job_direction.ilike.%${escaped}%,profile_summary.ilike.%${escaped}%`,
    );
  }

  const { data, error, count } = await req;
  if (error) throw error;

  const rows = (data || []).map((row) => mapToListItem(row as ResumeRecord));
  return { rows, count: count || 0 };
};

