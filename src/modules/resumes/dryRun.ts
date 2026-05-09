import { buildResumeImportDraft } from './importer';
import type { ResumeImportDraft } from './importer';

export interface ResumeDryRunItem {
  index: number;
  sourceText: string;
  draft: ResumeImportDraft;
  warnings: string[];
}

export interface ResumeDryRunSummary {
  total: number;
  withName: number;
  withEmail: number;
  withPhone: number;
  withWorkYears: number;
}

export interface ResumeDryRunResult {
  items: ResumeDryRunItem[];
  summary: ResumeDryRunSummary;
}

const splitBatchInput = (input: string): string[] => {
  const raw = String(input || '').trim();
  if (!raw) return [];
  // Allow separators used in manual ops notes.
  const blocks = raw
    .split(/\n-{3,}\n|\n={3,}\n|\n#{3,}\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks;
  return [raw];
};

export const runResumeDryRun = (batchInput: string): ResumeDryRunResult => {
  const blocks = splitBatchInput(batchInput);
  const items: ResumeDryRunItem[] = blocks.map((sourceText, idx) => {
    const draft = buildResumeImportDraft(sourceText);
    const warnings: string[] = [];
    if (!draft.full_name) warnings.push('missing_full_name');
    if (!draft.email) warnings.push('missing_email');
    if (!draft.phone && !draft.whatsapp) warnings.push('missing_phone_and_whatsapp');
    if (draft.work_years === null) warnings.push('missing_work_years');
    return { index: idx + 1, sourceText, draft, warnings };
  });

  const summary: ResumeDryRunSummary = {
    total: items.length,
    withName: items.filter((x) => Boolean(x.draft.full_name)).length,
    withEmail: items.filter((x) => Boolean(x.draft.email)).length,
    withPhone: items.filter((x) => Boolean(x.draft.phone || x.draft.whatsapp)).length,
    withWorkYears: items.filter((x) => typeof x.draft.work_years === 'number').length,
  };

  return { items, summary };
};

