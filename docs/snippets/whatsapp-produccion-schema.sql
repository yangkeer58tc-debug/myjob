-- Run once in Supabase SQL Editor: PRODUCTION project (vnolnnpegxpmsvdhwqgb)
-- WhatsApp bot tables + v3 columns + admin read policies + storage bucket.
-- Idempotent (IF NOT EXISTS / IF NOT EXISTS columns).

-- ----- From 20260507100000_add_whatsapp_bot_tables.sql -----
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_user_id text NOT NULL,
  state text NOT NULL DEFAULT 'new',
  candidate_name text,
  resume_storage_path text,
  language text NOT NULL DEFAULT 'es',
  is_human_takeover boolean NOT NULL DEFAULT false,
  last_inbound_message_id text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_state
  ON public.whatsapp_conversations(state);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  wa_user_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  message_type text NOT NULL,
  body text,
  media_url text,
  media_mime text,
  infobip_message_id text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conv
  ON public.whatsapp_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_user
  ON public.whatsapp_messages(wa_user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created
  ON public.whatsapp_messages(created_at DESC);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-resumes', 'whatsapp-resumes', false)
ON CONFLICT (id) DO NOTHING;

-- ----- From 20260507200000_whatsapp_bot_v3_state.sql -----
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS opt_in_clarify_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rmc_resume_id uuid,
  ADD COLUMN IF NOT EXISTS rmc_sync_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS rmc_sync_error text,
  ADD COLUMN IF NOT EXISTS last_resume_storage_path text,
  ADD COLUMN IF NOT EXISTS last_resume_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_rmc_sync_status_check;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_rmc_sync_status_check
  CHECK (rmc_sync_status IN ('none','pending','success','failed','skipped_no_config','skipped_staging'));

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_state_check;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_state_check
  CHECK (state IN (
    'new',
    'awaiting_name',
    'awaiting_resume',
    'awaiting_opt_in',
    'completed_opt_in',
    'completed_declined'
  ));

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_wa_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_conversations_active_user
  ON public.whatsapp_conversations(wa_user_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_archived
  ON public.whatsapp_conversations(archived_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_completed
  ON public.whatsapp_conversations(completed_at);

DROP POLICY IF EXISTS "whatsapp_conversations_authenticated_select" ON public.whatsapp_conversations;
CREATE POLICY "whatsapp_conversations_authenticated_select"
  ON public.whatsapp_conversations
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "whatsapp_messages_authenticated_select" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_authenticated_select"
  ON public.whatsapp_messages
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT SELECT ON public.whatsapp_messages TO authenticated;
