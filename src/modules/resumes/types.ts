export type ResumeRecord = Record<string, unknown>;

export interface ResumeListItem {
  id: string;
  name: string;
  jobDirection: string | null;
  profileSummary: string | null;
  updatedAt: string | null;
  raw: ResumeRecord;
}

export interface ResumeListResult {
  rows: ResumeListItem[];
  count: number;
}

export interface ListResumesParams {
  query?: string;
  page: number;
  pageSize: number;
}

