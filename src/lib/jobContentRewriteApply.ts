import { extractCompanyNameFromJd, extractSalaryFromJd, isPlaceholderEmployerName } from '@/lib/jdExtract';
import { estimatedMonthlyMxnForJob } from '@/lib/mxSalaryFallback';
import { parseHighlights } from '@/lib/highlightUtils';
import { normalizeIndustryLabelForMexico } from '@/lib/industryEsMx';
import {
  CATEGORY_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  EXPERIENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  PAYMENT_FREQUENCY_OPTIONS,
  WORKPLACE_TYPE_OPTIONS,
  normalizeOptionId,
} from '@/lib/jobOptions';
import { normalizeCompanyName, normalizeJobTextFields, normalizeJobTitle } from '@/lib/jobTextUtils';
import {
  collectFirstEmployerLogoRaw,
  looksLikeCompanyLogoUrl,
  normalizeImportedEmployerLogoUrl,
  stripCsvCellDecorations,
} from '@/lib/jobLogoUrl';
import { isPlaceholderSalaryText } from '@/lib/salaryUtils';
import type { JobRewriteLlmOutput } from '@/lib/jobContentRewriteTypes';
import { splitRewriteBodyMarkdown } from '@/lib/jobContentRewriteSplit';
import { clampJobRewriteTitle } from '@/lib/jobRewriteTitle';

const normalizeSalaryInput = (value: string) => stripCsvCellDecorations(value).trim();

/** Merge LLM rewrite into CSV row, then build Supabase upsert payload (one row). */
export function buildJobUpsertAfterRewrite(
  row: Record<string, string>,
  llm: JobRewriteLlmOutput,
) {
  const split = splitRewriteBodyMarkdown(llm.body_markdown);
  const mergedRow: Record<string, string> = {
    ...row,
    title: llm.title_rewritten,
    summary: split.summary || row.summary || '',
    description: split.description || llm.body_markdown,
    requirements: split.requirements || row.requirements || '',
  };

  const locationRaw = mergedRow.location || 'Mexico';
  const location = stripCsvCellDecorations(locationRaw).trim() || 'Mexico';
  const authorPro = stripCsvCellDecorations(mergedRow.author_profile ?? mergedRow.author_pro ?? '');
  const logoRaw =
    collectFirstEmployerLogoRaw(mergedRow) ||
    (authorPro && looksLikeCompanyLogoUrl(authorPro) ? authorPro : '');
  const b_logo_url = normalizeImportedEmployerLogoUrl(logoRaw);
  const normalizedText = normalizeJobTextFields({
    summary: mergedRow.summary || null,
    description: mergedRow.description || null,
    requirements: mergedRow.requirements || null,
  });
  const jdBlob = [normalizedText.summary, normalizedText.description, normalizedText.requirements]
    .filter(Boolean)
    .join('\n\n');
  const titleNorm = clampJobRewriteTitle(
    stripCsvCellDecorations(llm.title_rewritten) || 'Sin título',
  );
  const categoryNorm = mergedRow.category ? normalizeOptionId(mergedRow.category, CATEGORY_OPTIONS) : null;

  let b_name = normalizeCompanyName(stripCsvCellDecorations(mergedRow.b_name || mergedRow.company || ''));
  if (!b_name || isPlaceholderEmployerName(b_name)) {
    const fromJd = extractCompanyNameFromJd(titleNorm, jdBlob);
    if (fromJd) b_name = normalizeCompanyName(fromJd);
  }
  if (!b_name || isPlaceholderEmployerName(b_name)) b_name = 'MyJob';

  let salary_amount = mergedRow.salary_amount ? normalizeSalaryInput(mergedRow.salary_amount) : '';
  let payment_frequency = mergedRow.payment_frequency
    ? normalizeOptionId(mergedRow.payment_frequency, PAYMENT_FREQUENCY_OPTIONS)
    : 'mensal';

  if (!salary_amount.trim() || isPlaceholderSalaryText(salary_amount)) {
    const ex = extractSalaryFromJd(jdBlob);
    if (ex) {
      salary_amount = normalizeSalaryInput(ex.amount);
      payment_frequency = ex.payment_frequency;
    } else {
      const est = estimatedMonthlyMxnForJob(categoryNorm, titleNorm, location);
      salary_amount = est.salary_amount;
      payment_frequency = est.payment_frequency;
    }
  }

  return {
    id: mergedRow.id || `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    b_name,
    b_logo_url,
    b_same_as: stripCsvCellDecorations(mergedRow.b_same_as || '').trim() || null,
    street_address: stripCsvCellDecorations(mergedRow.street_address || '').trim() || null,
    title: titleNorm,
    category: categoryNorm,
    location,
    salary_amount,
    payment_frequency,
    job_type: mergedRow.job_type ? normalizeOptionId(mergedRow.job_type, JOB_TYPE_OPTIONS) : 'tempo-integral',
    workplace_type: mergedRow.workplace_type
      ? normalizeOptionId(mergedRow.workplace_type, WORKPLACE_TYPE_OPTIONS)
      : 'presencial',
    summary: normalizedText.summary,
    description: normalizedText.description,
    requirements: normalizedText.requirements,
    highlights: mergedRow.highlights ? parseHighlights(mergedRow.highlights) : null,
    education_level: mergedRow.education_level
      ? normalizeOptionId(mergedRow.education_level, EDUCATION_LEVEL_OPTIONS)
      : null,
    industry: mergedRow.industry ? normalizeIndustryLabelForMexico(mergedRow.industry) : null,
    language_req: mergedRow.language_req || null,
    experience: mergedRow.experience ? normalizeOptionId(mergedRow.experience, EXPERIENCE_OPTIONS) : null,
    /** AI rewrite import always publishes; CSV is_active is ignored so /empleos matches success count. */
    is_active: true,
    created_at: new Date().toISOString(),
  };
}
