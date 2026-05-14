-- Log each job card shown via WhatsApp "Recomiéndame" for daily caps and de-duplication.

CREATE TABLE IF NOT EXISTS public.whatsapp_job_recommendation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_user_id text NOT NULL,
  job_id text NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  /** Calendar date in America/Mexico_City when the row was inserted (YYYY-MM-DD). */
  day_mx text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_job_rec_events_wa_day
  ON public.whatsapp_job_recommendation_events (wa_user_id, day_mx);

CREATE INDEX IF NOT EXISTS idx_wa_job_rec_events_wa_job
  ON public.whatsapp_job_recommendation_events (wa_user_id, job_id);

ALTER TABLE public.whatsapp_job_recommendation_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.whatsapp_job_recommendation_events IS
  'WhatsApp bot: one row each time a job is shown in the in-chat recommendation flow.';
