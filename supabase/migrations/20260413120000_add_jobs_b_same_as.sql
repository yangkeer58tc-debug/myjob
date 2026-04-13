-- Employer canonical website for JobPosting hiringOrganization.sameAs (optional).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS b_same_as text;
