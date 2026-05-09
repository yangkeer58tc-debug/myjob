-- WhatsApp bot MVP tables
-- Stores per-user conversation state and message history for the WhatsApp recruitment bot.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_user_id text NOT NULL UNIQUE,
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

-- Lock down access; only the Edge Function (using service_role) should read/write.
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Private storage bucket for resume files received via WhatsApp.
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-resumes', 'whatsapp-resumes', false)
ON CONFLICT (id) DO NOTHING;
