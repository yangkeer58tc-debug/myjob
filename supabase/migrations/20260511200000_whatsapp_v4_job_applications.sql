-- WhatsApp bot v4: job context, returning-user flow, application log, completed_no_cv.

-- 1) Migrate legacy state
UPDATE public.whatsapp_conversations
SET state = 'awaiting_resume'
WHERE state = 'awaiting_name';

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_state_check;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_state_check
  CHECK (state IN (
    'new',
    'awaiting_resume',
    'awaiting_returning_cv_choice',
    'awaiting_opt_in',
    'completed_opt_in',
    'completed_declined',
    'completed_no_cv'
  ));

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS applying_job_id text,
  ADD COLUMN IF NOT EXISTS applying_job_title text,
  ADD COLUMN IF NOT EXISTS applying_job_company text;

-- 2) Application audit log (one row per "apply to this job" intent)
CREATE TABLE IF NOT EXISTS public.whatsapp_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  wa_user_id text NOT NULL,
  rmc_resume_id uuid,
  job_id text,
  job_title text,
  job_company text,
  source text NOT NULL DEFAULT 'whatsapp_bot',
  reused_existing_cv boolean NOT NULL DEFAULT false,
  opt_in_status text NOT NULL DEFAULT 'pending'
    CHECK (opt_in_status IN ('opted_in', 'declined', 'pending')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_applications_wa_user
  ON public.whatsapp_applications(wa_user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_applications_job
  ON public.whatsapp_applications(job_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_applications_created
  ON public.whatsapp_applications(created_at DESC);

ALTER TABLE public.whatsapp_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_applications_authenticated_select" ON public.whatsapp_applications;
CREATE POLICY "whatsapp_applications_authenticated_select"
  ON public.whatsapp_applications
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.whatsapp_applications TO authenticated;
