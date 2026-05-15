/** Input contract — docs/job-content-rewrite-plan-zh.md §6 */
export type JobRewriteStructured = {
  title: string;
  company_name: string;
  city: string | null;
  location: string | null;
  workplace_type: 'presencial' | 'remoto' | 'hibrido' | null;
  job_type: string | null;
  salary_amount: string | null;
  salary_currency: 'MXN' | null;
  category: string | null;
  company_url: string | null;
  requirements_bullets: string[];
  benefits_bullets: string[];
};

export type JobRewriteInput = {
  job_id: string;
  short_source: boolean;
  structured: JobRewriteStructured;
  raw_text: string;
  locale: 'es-MX';
};

/** Output contract — §7 + SEO title */
export type JobRewriteLlmOutput = {
  job_id: string;
  title_rewritten: string;
  body_markdown: string;
  notes: string | null;
};

export type JobRewriteQaResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  bodyCharCount: number;
  duplicateRatio: number | null;
};

export type JobRewriteApiResponse =
  | {
      success: true;
      data: JobRewriteLlmOutput;
      meta: { model: string; base_url: string | null; route: string };
      qa: JobRewriteQaResult;
    }
  | {
      success: false;
      error: string;
      meta?: { model?: string; base_url?: string | null };
    };
