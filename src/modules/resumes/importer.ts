import { parseResumeText } from './parser';
import type { ResumeRecord } from './types';

export interface ResumeImportDraft {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  country: string | null;
  work_years: number | null;
  profile_summary: string | null;
  education: Array<Record<string, unknown>> | null;
  source_text: string;
}

const toNullable = (value: unknown): string | null => {
  const t = String(value ?? '').trim();
  return t || null;
};

export const buildResumeImportDraft = (sourceText: string): ResumeImportDraft => {
  const parsed = parseResumeText(sourceText);
  return {
    full_name: toNullable(parsed.name),
    email: toNullable(parsed.email),
    phone: toNullable(parsed.phone),
    whatsapp: toNullable(parsed.whatsapp),
    city: toNullable(parsed.city),
    country: toNullable(parsed.country),
    work_years: typeof parsed.workYears === 'number' && Number.isFinite(parsed.workYears) ? parsed.workYears : null,
    profile_summary: toNullable(parsed.introSummaryOriginal),
    education: Array.isArray(parsed.education) ? (parsed.education as Array<Record<string, unknown>>) : null,
    source_text: sourceText,
  };
};

export const buildResumeImportDraftFromRow = (row: ResumeRecord): ResumeImportDraft | null => {
  const source =
    String(row.resume_text ?? '').trim() ||
    String(row.profile_summary ?? '').trim() ||
    String(row.summary ?? '').trim();
  if (!source) return null;
  return buildResumeImportDraft(source);
};

