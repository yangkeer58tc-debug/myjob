export type AiExtractResult = {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  country?: string | null
  city?: string | null
  email?: string | null
  whatsapp?: string | null
  phone?: string | null
  work_years?: number | null
  education?: unknown[] | null
  intro_summary_original?: string | null
  intro_language?: string | null
  profile_summary?: string | null
  profile_summary_language?: string | null
  job_direction?: string | null
}

export type AiExtractMeta = {
  model?: string
  base_url?: string
  input_chars?: number
}

export type AiExtractResponse =
  | { ok: true; data: AiExtractResult; meta?: AiExtractMeta }
  | { ok: false; error: string; meta?: AiExtractMeta }
