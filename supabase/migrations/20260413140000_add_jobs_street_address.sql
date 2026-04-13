-- Optional work site street for JobPosting PostalAddress.streetAddress (Google recommended).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS street_address text;
