export type ParseStatus = 'processing' | 'success' | 'failed'
export type SourceType = 'upload' | 'url'

export type EducationItem = {
  degree?: string
  startDate?: string
  endDate?: string
  raw?: string
}

export type ResumeListItem = {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  job_direction: string | null
  admin_note: string | null
  country: string | null
  city: string | null
  email: string | null
  whatsapp: string | null
  phone: string | null
  work_years: number | null
  ai_used: boolean
  ai_model: string | null
  ai_error: string | null
  ai_extracted_at: string | null
  profile_summary: string | null
  profile_summary_language: string | null
  parse_status: ParseStatus
  parse_error: string | null
  created_at: string
  updated_at: string
}

export type ResumeDetail = ResumeListItem & {
  source_type: SourceType
  source_url: string | null
  storage_bucket: string
  storage_path: string
  original_filename: string | null
  intro_summary_original: string | null
  intro_language: string | null
  education: EducationItem[] | null
  text_content?: string | null
}
