// deno-lint-ignore-file no-explicit-any
// WhatsApp recruitment bot webhook (MVP).
//
// Flow (state machine):
//   new            -> reply welcome, ask for full name, set state = awaiting_name
//   awaiting_name  -> save name, ask for resume document, set state = awaiting_resume
//   awaiting_resume:
//     - if document/image -> download, upload to storage, set state = completed
//     - if text           -> remind user to send a file
//   completed      -> friendly "we already have your info" reply
//
// All inbound and outbound messages are persisted to whatsapp_messages.
// The Edge Function uses Supabase service_role to bypass RLS.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { buildConfig, downloadMedia, InfobipConfig, sendText } from './infobip.ts';
import { COPY } from './copy.ts';

type ConversationState =
  | 'new'
  | 'awaiting_name'
  | 'awaiting_resume'
  | 'completed';

type ConversationRow = {
  id: string;
  wa_user_id: string;
  state: ConversationState;
  candidate_name: string | null;
  resume_storage_path: string | null;
  language: string;
  is_human_takeover: boolean;
  last_inbound_message_id: string | null;
};

type InboundMessage = {
  from: string;
  messageId: string;
  type: string;
  text?: string;
  mediaUrl?: string;
  mediaMime?: string;
};

const RESUME_BUCKET = 'whatsapp-resumes';
const NAME_MAX_LEN = 80;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });

const getSupabase = (): SupabaseClient => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

// Infobip wraps inbound events in different shapes depending on the channel
// configuration. We only need a few fields, so normalise into InboundMessage.
const parseInbound = (payload: any): InboundMessage[] => {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const messages: InboundMessage[] = [];

  for (const r of results) {
    const from = String(r?.from ?? '').trim();
    const messageId = String(r?.messageId ?? r?.id ?? '').trim();
    if (!from || !messageId) continue;

    const m = r?.message ?? {};
    const rawType = String(m?.type ?? '').toUpperCase();

    if (rawType === 'TEXT') {
      messages.push({
        from,
        messageId,
        type: 'text',
        text: String(m?.text ?? '').trim(),
      });
      continue;
    }

    if (rawType === 'DOCUMENT' || rawType === 'IMAGE' || rawType === 'VIDEO') {
      messages.push({
        from,
        messageId,
        type: rawType.toLowerCase(),
        mediaUrl: String(m?.url ?? m?.media?.url ?? '').trim() || undefined,
        mediaMime: String(m?.mimeType ?? m?.contentType ?? '').trim() || undefined,
        text: String(m?.caption ?? '').trim() || undefined,
      });
      continue;
    }

    // Unknown type - surface as text fallback so we still record it.
    messages.push({
      from,
      messageId,
      type: rawType.toLowerCase() || 'unknown',
      text: typeof m?.text === 'string' ? m.text : undefined,
    });
  }
  return messages;
};

const sanitizeName = (raw: string): string => {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.slice(0, NAME_MAX_LEN);
};

const extFromMime = (mime?: string): string => {
  if (!mime) return 'bin';
  const m = mime.toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('msword')) return 'doc';
  if (m.includes('officedocument.wordprocessingml')) return 'docx';
  if (m.includes('jpeg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  return 'bin';
};

async function getOrCreateConversation(
  supabase: SupabaseClient,
  waUserId: string,
): Promise<ConversationRow> {
  const { data: existing, error: selErr } = await supabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('wa_user_id', waUserId)
    .maybeSingle();

  if (selErr) throw selErr;
  if (existing) return existing as ConversationRow;

  const { data: created, error: insErr } = await supabase
    .from('whatsapp_conversations')
    .insert({ wa_user_id: waUserId, state: 'new' })
    .select('*')
    .single();

  if (insErr) throw insErr;
  return created as ConversationRow;
}

async function recordMessage(
  supabase: SupabaseClient,
  args: {
    conversationId: string;
    waUserId: string;
    direction: 'inbound' | 'outbound';
    type: string;
    body?: string | null;
    mediaUrl?: string | null;
    mediaMime?: string | null;
    infobipMessageId?: string | null;
    raw?: unknown;
  },
): Promise<void> {
  await supabase.from('whatsapp_messages').insert({
    conversation_id: args.conversationId,
    wa_user_id: args.waUserId,
    direction: args.direction,
    message_type: args.type,
    body: args.body ?? null,
    media_url: args.mediaUrl ?? null,
    media_mime: args.mediaMime ?? null,
    infobip_message_id: args.infobipMessageId ?? null,
    raw_payload: args.raw ? (args.raw as any) : null,
  });
}

async function reply(
  supabase: SupabaseClient,
  config: InfobipConfig,
  conversation: ConversationRow,
  text: string,
): Promise<void> {
  const send = await sendText(config, conversation.wa_user_id, text);
  await recordMessage(supabase, {
    conversationId: conversation.id,
    waUserId: conversation.wa_user_id,
    direction: 'outbound',
    type: 'text',
    body: text,
    raw: { ok: send.ok, status: send.status, body: send.body },
  });
}

async function uploadResume(
  supabase: SupabaseClient,
  config: InfobipConfig,
  waUserId: string,
  msg: InboundMessage,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (!msg.mediaUrl) return { ok: false, reason: 'no_media_url' };

  const dl = await downloadMedia(config, msg.mediaUrl);
  if (!dl.ok || !dl.bytes) {
    return { ok: false, reason: `download_failed_${dl.status}` };
  }

  const ext = extFromMime(msg.mediaMime ?? dl.contentType);
  const ts = new Date();
  const datePart = ts.toISOString().slice(0, 10);
  const fileName = `${ts.getTime()}-${msg.messageId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)}.${ext}`;
  const path = `${waUserId}/${datePart}/${fileName}`;

  const { error } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, dl.bytes, {
      contentType: msg.mediaMime ?? dl.contentType ?? 'application/octet-stream',
      upsert: false,
    });

  if (error) return { ok: false, reason: `upload_failed_${error.message}` };
  return { ok: true, path };
}

async function handleMessage(
  supabase: SupabaseClient,
  config: InfobipConfig,
  msg: InboundMessage,
  raw: unknown,
): Promise<void> {
  const conversation = await getOrCreateConversation(supabase, msg.from);

  // Persist inbound message first.
  await recordMessage(supabase, {
    conversationId: conversation.id,
    waUserId: msg.from,
    direction: 'inbound',
    type: msg.type,
    body: msg.text ?? null,
    mediaUrl: msg.mediaUrl ?? null,
    mediaMime: msg.mediaMime ?? null,
    infobipMessageId: msg.messageId,
    raw,
  });

  // Idempotency: if we've already processed this message, skip.
  if (conversation.last_inbound_message_id === msg.messageId) return;

  // Human takeover short-circuits all auto behaviour.
  if (conversation.is_human_takeover) {
    await supabase
      .from('whatsapp_conversations')
      .update({
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return;
  }

  // ---- State machine ----
  if (conversation.state === 'new') {
    await reply(supabase, config, conversation, COPY.welcome);
    await supabase
      .from('whatsapp_conversations')
      .update({
        state: 'awaiting_name',
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return;
  }

  if (conversation.state === 'awaiting_name') {
    if (msg.type !== 'text' || !msg.text) {
      await reply(supabase, config, conversation, COPY.welcome);
      return;
    }
    const name = sanitizeName(msg.text);
    if (!name) {
      await reply(supabase, config, conversation, COPY.welcome);
      return;
    }
    await reply(supabase, config, conversation, COPY.askResume(name));
    await supabase
      .from('whatsapp_conversations')
      .update({
        state: 'awaiting_resume',
        candidate_name: name,
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return;
  }

  if (conversation.state === 'awaiting_resume') {
    const isFile = msg.type === 'document' || msg.type === 'image';
    if (!isFile) {
      await reply(supabase, config, conversation, COPY.pleaseSendDocument);
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_inbound_message_id: msg.messageId,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id);
      return;
    }

    const upload = await uploadResume(supabase, config, msg.from, msg);
    if (!upload.ok) {
      console.error('uploadResume_failed', upload.reason);
      await reply(supabase, config, conversation, COPY.errorGeneric);
      return;
    }

    await reply(supabase, config, conversation, COPY.resumeReceived);
    await supabase
      .from('whatsapp_conversations')
      .update({
        state: 'completed',
        resume_storage_path: upload.path,
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return;
  }

  if (conversation.state === 'completed') {
    await reply(supabase, config, conversation, COPY.alreadyCompleted);
    await supabase
      .from('whatsapp_conversations')
      .update({
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method === 'GET') {
    // Health check; useful when registering the webhook URL in Infobip.
    return json({ ok: true, service: 'whatsapp-webhook' });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const config = buildConfig();
  if (!config.baseUrl || !config.apiKey || !config.sender) {
    return json(
      {
        error:
          'Missing Infobip config. Set INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_SENDER as Edge Function secrets.',
      },
      500,
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const messages = parseInbound(payload);
  if (messages.length === 0) {
    // Acknowledge gracefully so Infobip does not retry status callbacks indefinitely.
    return json({ ok: true, processed: 0 });
  }

  const supabase = getSupabase();
  let processed = 0;
  const errors: string[] = [];

  for (const msg of messages) {
    try {
      await handleMessage(supabase, config, msg, payload);
      processed += 1;
    } catch (err) {
      console.error('whatsapp-webhook handle error', err);
      errors.push(String((err as { message?: unknown })?.message ?? err));
    }
  }

  return json({ ok: errors.length === 0, processed, errors });
});
