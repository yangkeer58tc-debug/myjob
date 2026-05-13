-- ok.com MX real posts: mark source + MX taxonomy code on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS mx_category_code text;

CREATE INDEX IF NOT EXISTS idx_jobs_external_source
  ON public.jobs (external_source)
  WHERE external_source IS NOT NULL;

COMMENT ON COLUMN public.jobs.external_source IS 'Feed marker, e.g. ok_mx_real for MX real posts imported via admin.';
COMMENT ON COLUMN public.jobs.mx_category_code IS 'Leaf category code from MX taxonomy (matches MX category CSV code).';

-- Allow signed URL / download in dashboard for admins (authenticated) on WhatsApp resume bucket
DROP POLICY IF EXISTS "whatsapp_resumes_authenticated_select_objects" ON storage.objects;
CREATE POLICY "whatsapp_resumes_authenticated_select_objects"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'whatsapp-resumes');
