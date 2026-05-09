// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
// WhatsApp recruitment bot webhook — PRD v3.
//
// Flow (state machine):
//   new              -> reply welcome, ask name,    state -> awaiting_name
//   awaiting_name    -> validate + store name,
//                       ask resume,                 state -> awaiting_resume
//   awaiting_resume:
//     - valid file       -> store latest, ack +
//                           offer destacados,       state -> awaiting_opt_in
//     - invalid/missing  -> bounce with hint,       state stays awaiting_resume
//   awaiting_opt_in:
//     - strict "si"/"sí" -> sync to RMC,            state -> completed_opt_in
//     - explicit "no"/.. -> friendly close,         state -> completed_declined
//     - ambiguous (1st)  -> clarify once,           state stays awaiting_opt_in
//     - ambiguous (2nd+) -> close as declined,      state -> completed_declined
//   completed_*       -> within 5 min cooldown: silently logged, no reply.
//                        After cooldown: archive, start a brand new flow.
//
// All inbound + outbound persisted in whatsapp_messages.
// Edge Function runs with the project's SUPABASE_SERVICE_ROLE_KEY (bypasses
// RLS); RMC sync uses a separate RMC service-role key (see rmc.ts).
//
// Build marker (used to confirm Supabase Edge runtime is serving the latest
// version): WA_BOT_BUILD_2026_05_09_v7

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { buildConfig, downloadMedia, InfobipConfig, sendText } from './infobip.ts';
import { COPY } from './copy.ts';
import { enrichResumeViaRmcAiExtract } from './resumeAiEnrich.ts';
import { getRmcServiceConfig, syncResumeToRmc, toE164ForRmc } from './rmc.ts';
import {
  extFromMime,
  isExplicitNo,
  isStrictSi,
  sanitizeName,
} from './parsing.ts';

type ConversationState =
  | 'new'
  | 'awaiting_name'
  | 'awaiting_resume'
  | 'awaiting_opt_in'
  | 'completed_opt_in'
  | 'completed_declined';

type RmcSyncStatusValue =
  | 'none'
  | 'pending'
  | 'success'
  | 'failed'
  | 'skipped_no_config'
  | 'skipped_staging';

type ConversationRow = {
  id: string;
  wa_user_id: string;
  state: ConversationState;
  candidate_name: string | null;
  resume_storage_path: string | null; // legacy column, kept in sync
  last_resume_storage_path: string | null;
  last_resume_received_at: string | null;
  language: string;
  is_human_takeover: boolean;
  last_inbound_message_id: string | null;
  opt_in_clarify_count: number;
  rmc_resume_id: string | null;
  rmc_sync_status: RmcSyncStatusValue;
  rmc_sync_error: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  last_message_at: string;
};

type InboundMessage = {
  from: string;
  messageId: string;
  type: string;        // 'text' | 'document' | 'image' | 'audio' | 'video' | ...
  text?: string;
  mediaUrl?: string;
  mediaMime?: string;
  filename?: string;
};

const RESUME_BUCKET = 'whatsapp-resumes';
const RESUME_MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard cap
const OPT_IN_TIMEOUT_HOURS = 24;
const COMPLETED_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const MULTI_IMAGE_HINT_WINDOW_MS = 30 * 1000; // 30s

/** Supabase Edge: keep Infobip webhook fast while AI runs. */
function scheduleBackground(promise: Promise<void>): void {
  const w = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil;
  if (typeof w === 'function') w(promise);
  else promise.catch((e) => console.error('[wa-bot enrich]', e));
}

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

// -------- Inbound payload normalization --------

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

    if (rawType === 'DOCUMENT' || rawType === 'IMAGE' || rawType === 'VIDEO' || rawType === 'AUDIO' || rawType === 'STICKER') {
      messages.push({
        from,
        messageId,
        type: rawType.toLowerCase(),
        mediaUrl: String(m?.url ?? m?.media?.url ?? '').trim() || undefined,
        mediaMime: String(m?.mimeType ?? m?.contentType ?? '').trim() || undefined,
        filename: String(m?.caption ?? m?.fileName ?? m?.filename ?? '').trim() || undefined,
        text: String(m?.caption ?? '').trim() || undefined,
      });
      continue;
    }

    messages.push({
      from,
      messageId,
      type: rawType.toLowerCase() || 'unknown',
      text: typeof m?.text === 'string' ? m.text : undefined,
    });
  }
  return messages;
};

// -------- Pure helpers (file-local) --------

const safeFilename = (raw: string | undefined, ext: string, fallback: string): string => {
  const cleaned = String(raw ?? '')
    .split('/').pop()!
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);
  if (cleaned && /\.[a-zA-Z0-9]+$/.test(cleaned)) return cleaned;
  return `${fallback}.${ext}`;
};

// -------- DB helpers --------

const DEFAULT_CONVERSATION_FIELDS = `
  id, wa_user_id, state, candidate_name, resume_storage_path,
  last_resume_storage_path, last_resume_received_at, language,
  is_human_takeover, last_inbound_message_id, opt_in_clarify_count,
  rmc_resume_id, rmc_sync_status, rmc_sync_error,
  completed_at, archived_at, created_at, last_message_at
`;

async function findActiveConversation(
  supabase: SupabaseClient,
  waUserId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select(DEFAULT_CONVERSATION_FIELDS)
    .eq('wa_user_id', waUserId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as ConversationRow) ?? null;
}

async function archiveConversation(supabase: SupabaseClient, conversationId: string) {
  await supabase
    .from('whatsapp_conversations')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', conversationId);
}

async function createConversation(
  supabase: SupabaseClient,
  waUserId: string,
): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .insert({ wa_user_id: waUserId, state: 'new' })
    .select(DEFAULT_CONVERSATION_FIELDS)
    .single();
  if (error) throw error;
  return data as ConversationRow;
}

// Resolve which conversation row this inbound should drive.
//
// Rule (PRD v3 §6):
//   - Active row exists                         → use it.
//   - No active, latest completed within 5 min  → silently keep it active
//     (do not restart yet; we'll archive on the next inbound after cooldown).
//   - Otherwise (no rows / all archived / completed > 5 min ago)
//                                               → create a fresh row.
async function resolveConversationForInbound(
  supabase: SupabaseClient,
  waUserId: string,
): Promise<{ conversation: ConversationRow; isFreshlyCreated: boolean }> {
  const active = await findActiveConversation(supabase, waUserId);
  if (active) {
    return { conversation: active, isFreshlyCreated: false };
  }

  // No active row. Maybe the latest completed one is still inside cooldown?
  const { data: lastCompleted } = await supabase
    .from('whatsapp_conversations')
    .select('completed_at')
    .eq('wa_user_id', waUserId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // The active query already filters archived_at IS NULL, so any completed_at
  // we find here belongs to a row that's already archived; restarting is the
  // right move regardless. (Cooldown handled inside handleMessage when the
  // active row's state is completed_*.)
  void lastCompleted;

  const created = await createConversation(supabase, waUserId);
  return { conversation: created, isFreshlyCreated: true };
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

// Send several messages back-to-back (used for the 3-part destacados block).
async function replyMany(
  supabase: SupabaseClient,
  config: InfobipConfig,
  conversation: ConversationRow,
  texts: string[],
): Promise<void> {
  for (const t of texts) {
    await reply(supabase, config, conversation, t);
  }
}

// Delete every existing object stored under this user's prefix in the myjob
// staging bucket. Used to keep "only the latest CV" semantics (PRD v3 §5).
async function purgeUserResumeFiles(supabase: SupabaseClient, waUserId: string): Promise<void> {
  // Storage list does not recurse — we walk one date folder deep, which is
  // how we lay paths out (`<wa_user_id>/<YYYY-MM-DD>/<file>`).
  const { data: dates } = await supabase.storage.from(RESUME_BUCKET).list(waUserId, { limit: 1000 });
  if (!dates?.length) return;
  const targets: string[] = [];
  for (const d of dates) {
    const sub = `${waUserId}/${d.name}`;
    const { data: files } = await supabase.storage.from(RESUME_BUCKET).list(sub, { limit: 1000 });
    for (const f of files ?? []) {
      targets.push(`${sub}/${f.name}`);
    }
  }
  if (targets.length) {
    await supabase.storage.from(RESUME_BUCKET).remove(targets).catch(() => {});
  }
}

type ResumeUploadResult =
  | { ok: true; path: string; bytes: Uint8Array; mime: string; filename: string }
  | { ok: false; reason: 'too_large' | 'download_failed' | 'upload_failed' | 'no_media_url' | 'empty_bytes' };

// Download from Infobip → enforce 10 MB → purge old files → upload latest.
async function downloadAndStoreResume(
  supabase: SupabaseClient,
  config: InfobipConfig,
  waUserId: string,
  msg: InboundMessage,
): Promise<ResumeUploadResult> {
  if (!msg.mediaUrl) return { ok: false, reason: 'no_media_url' };

  const dl = await downloadMedia(config, msg.mediaUrl);
  if (!dl.ok || !dl.bytes) {
    console.error('[wa-bot] media download failed', { status: dl.status, error: dl.error });
    return { ok: false, reason: 'download_failed' };
  }
  if (dl.bytes.byteLength === 0) return { ok: false, reason: 'empty_bytes' };
  if (dl.bytes.byteLength > RESUME_MAX_BYTES) return { ok: false, reason: 'too_large' };

  const mime = msg.mediaMime || dl.contentType || 'application/octet-stream';
  const ext = extFromMime(mime, msg.filename);
  const datePart = new Date().toISOString().slice(0, 10);
  const storedFilename = safeFilename(msg.filename, ext, `cv-${msg.messageId.slice(0, 12)}`);
  const path = `${waUserId}/${datePart}/${Date.now()}-${storedFilename}`;

  // Always-latest semantics: drop everything we had before, then upload.
  await purgeUserResumeFiles(supabase, waUserId);

  const { error } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, dl.bytes, { contentType: mime, upsert: false });

  if (error) {
    console.error('[wa-bot] storage upload failed', error);
    return { ok: false, reason: 'upload_failed' };
  }
  return { ok: true, path, bytes: dl.bytes, mime, filename: storedFilename };
}

// -------- Multi-image hint logic --------

async function userJustSentAnotherImage(
  supabase: SupabaseClient,
  conversationId: string,
  currentMessageId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - MULTI_IMAGE_HINT_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, message_type, infobip_message_id, created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .eq('message_type', 'image')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);
  if (!data?.length) return false;
  // The current inbound message has just been recorded too; ignore it.
  const others = data.filter((d: any) => String(d.infobip_message_id) !== currentMessageId);
  return others.length > 0;
}

// -------- Main message handler --------

async function handleMessage(
  supabase: SupabaseClient,
  config: InfobipConfig,
  msg: InboundMessage,
  raw: unknown,
): Promise<void> {
  let { conversation, isFreshlyCreated } = await resolveConversationForInbound(supabase, msg.from);

  // Persist the inbound message first (so we always have an audit trail even
  // if something fails further down).
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

  // Idempotency: Infobip occasionally redelivers the same messageId.
  if (conversation.last_inbound_message_id === msg.messageId) {
    return;
  }

  // ---- Cooldown / restart logic for completed_* states ----
  if (conversation.state === 'completed_opt_in' || conversation.state === 'completed_declined') {
    const completedAtMs = conversation.completed_at ? new Date(conversation.completed_at).getTime() : 0;
    const elapsed = Date.now() - completedAtMs;
    if (completedAtMs && elapsed < COMPLETED_COOLDOWN_MS) {
      // Inside cooldown → silently log, do not reply, do not restart.
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_inbound_message_id: msg.messageId,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id);
      return;
    }
    // Cooldown elapsed → archive this conversation and start a brand-new one.
    await archiveConversation(supabase, conversation.id);
    conversation = await createConversation(supabase, msg.from);
    isFreshlyCreated = true;
    // Re-record the inbound under the new conversation_id so the new flow
    // has its own audit trail.
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
  }

  // Human takeover short-circuit (PRD v3 §0 Q8 = false; kept for future use).
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

  // Treat freshly-created conversation as "new" regardless of explicit state
  // value, so the welcome path always fires for the very first inbound.
  const effectiveState: ConversationState = isFreshlyCreated ? 'new' : conversation.state;

  if (effectiveState === 'new') {
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

  if (effectiveState === 'awaiting_name') {
    if (msg.type !== 'text' || !msg.text) {
      await reply(supabase, config, conversation, COPY.welcome);
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_inbound_message_id: msg.messageId,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id);
      return;
    }
    const name = sanitizeName(msg.text);
    if (!name) {
      await reply(supabase, config, conversation, COPY.welcome);
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_inbound_message_id: msg.messageId,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id);
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

  if (effectiveState === 'awaiting_resume') {
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

    const stored = await downloadAndStoreResume(supabase, config, msg.from, msg);
    if (!stored.ok) {
      const text = stored.reason === 'too_large' ? COPY.fileTooLarge : COPY.errorGeneric;
      await reply(supabase, config, conversation, text);
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_inbound_message_id: msg.messageId,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id);
      return;
    }

    // Hint about merging multiple photos into a single PDF, when applicable.
    const replies: string[] = [];
    if (msg.type === 'image') {
      const seenAnotherImage = await userJustSentAnotherImage(
        supabase,
        conversation.id,
        msg.messageId,
      );
      if (seenAnotherImage) replies.push(COPY.multipleImagesHint);
    }
    replies.push(COPY.resumeReceived, COPY.optInOffer, COPY.optInLink);

    await replyMany(supabase, config, conversation, replies);

    await supabase
      .from('whatsapp_conversations')
      .update({
        state: 'awaiting_opt_in',
        last_resume_storage_path: stored.path,
        resume_storage_path: stored.path,
        last_resume_received_at: new Date().toISOString(),
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return;
  }

  if (effectiveState === 'awaiting_opt_in') {
    const text = (msg.type === 'text' ? msg.text : '') || '';
    const positive = isStrictSi(text);
    const negative = isExplicitNo(text);

    if (positive) {
      // Sync the latest stored resume to RMC, then confirm.
      const candidateName = conversation.candidate_name ?? '';
      const path = conversation.last_resume_storage_path ?? conversation.resume_storage_path;
      let syncStatus: RmcSyncStatusValue = 'failed';
      let syncError: string | null = null;
      let syncedResumeId: string | null = null;
      let enrichBuf: Uint8Array | null = null;
      let enrichMime = '';
      let enrichFilename = '';

      if (!path) {
        syncStatus = 'failed';
        syncError = 'missing_resume_path';
      } else {
        const { data: blob, error: dlErr } = await supabase.storage
          .from(RESUME_BUCKET)
          .download(path);
        if (dlErr || !blob) {
          syncStatus = 'failed';
          syncError = `myjob_download_failed:${dlErr?.message ?? 'no_blob'}`;
        } else {
          enrichMime = blob.type || 'application/octet-stream';
          enrichBuf = new Uint8Array(await blob.arrayBuffer());
          enrichFilename = path.split('/').pop() || 'cv';
          const result = await syncResumeToRmc({
            waUserId: msg.from,
            candidateName,
            fileBytes: enrichBuf,
            fileMime: enrichMime,
            originalFilename: enrichFilename,
          });
          syncStatus = result.status;
          syncError = result.error ?? null;
          syncedResumeId = result.resumeId ?? null;
        }
      }

      const userOk = syncStatus === 'success' || syncStatus === 'skipped_no_config' || syncStatus === 'skipped_staging';

      if (userOk) {
        await reply(supabase, config, conversation, COPY.optInConfirmed);
        const completedAt = new Date().toISOString();
        await supabase
          .from('whatsapp_conversations')
          .update({
            state: 'completed_opt_in',
            rmc_resume_id: syncedResumeId,
            rmc_sync_status: syncStatus,
            rmc_sync_error: syncError,
            completed_at: completedAt,
            last_inbound_message_id: msg.messageId,
            last_message_at: completedAt,
          })
          .eq('id', conversation.id);

        const aiUrl = (Deno.env.get('RMC_AI_EXTRACT_URL') ?? '').trim();
        const rmcCfg = getRmcServiceConfig();
        if (
          syncStatus === 'success' &&
          syncedResumeId &&
          enrichBuf &&
          rmcCfg &&
          aiUrl
        ) {
          scheduleBackground(
            enrichResumeViaRmcAiExtract({
              rmcConfig: rmcCfg,
              resumeId: syncedResumeId,
              fileBytes: enrichBuf,
              fileMime: enrichMime,
              originalFilename: enrichFilename,
              candidateName,
              whatsappE164: toE164ForRmc(msg.from),
            }),
          );
        }
      } else {
        // Hard failure: keep the user in awaiting_opt_in so they can retry by
        // resending "Si" (or we can retry from the admin UI later).
        await reply(supabase, config, conversation, COPY.errorGeneric);
        await supabase
          .from('whatsapp_conversations')
          .update({
            rmc_sync_status: syncStatus,
            rmc_sync_error: syncError,
            last_inbound_message_id: msg.messageId,
            last_message_at: new Date().toISOString(),
          })
          .eq('id', conversation.id);
      }
      return;
    }

    if (negative) {
      const completedAt = new Date().toISOString();
      // No outbound reply on explicit "no" beyond what we already said in
      // optInLink. Keep the conversation history clean.
      await supabase
        .from('whatsapp_conversations')
        .update({
          state: 'completed_declined',
          completed_at: completedAt,
          last_inbound_message_id: msg.messageId,
          last_message_at: completedAt,
        })
        .eq('id', conversation.id);
      return;
    }

    // Ambiguous reply: clarify once, then close as declined on the next
    // non-Si message.
    if ((conversation.opt_in_clarify_count ?? 0) >= 1) {
      const completedAt = new Date().toISOString();
      await supabase
        .from('whatsapp_conversations')
        .update({
          state: 'completed_declined',
          completed_at: completedAt,
          last_inbound_message_id: msg.messageId,
          last_message_at: completedAt,
        })
        .eq('id', conversation.id);
      return;
    }

    await reply(supabase, config, conversation, COPY.optInDeclinedOrUnclear);
    await supabase
      .from('whatsapp_conversations')
      .update({
        opt_in_clarify_count: (conversation.opt_in_clarify_count ?? 0) + 1,
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    return;
  }

  // Defensive: unexpected state. Just record activity.
  await supabase
    .from('whatsapp_conversations')
    .update({
      last_inbound_message_id: msg.messageId,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);
}

// -------- HTTP entrypoint --------

/**
 * Manual reprocess endpoint:
 *   POST /functions/v1/whatsapp-webhook?reprocess=1
 *   Body: { resumeId, waUserId, storagePath?, candidateName? }
 *
 * Re-runs the AI enrich step on an already-stored RMC resume. Useful when
 * the row was synced but enrichment failed earlier (e.g. wrong AI URL).
 *
 * Auth: requires header `x-reprocess-token` matching env `WA_REPROCESS_TOKEN`.
 */
async function handleReprocess(req: Request): Promise<Response> {
  const token = (Deno.env.get('WA_REPROCESS_TOKEN') ?? '').trim();
  const presented = req.headers.get('x-reprocess-token') ?? '';
  if (!token) return json({ ok: false, error: 'reprocess_disabled_no_token_set' }, 403);
  if (token !== presented) return json({ ok: false, error: 'forbidden' }, 403);

  let body: { resumeId?: string; waUserId?: string; storagePath?: string; candidateName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const resumeId = String(body.resumeId ?? '').trim();
  const waUserId = String(body.waUserId ?? '').trim();
  if (!resumeId || !waUserId) return json({ ok: false, error: 'resumeId_and_waUserId_required' }, 400);

  const rmcCfg = getRmcServiceConfig();
  if (!rmcCfg) return json({ ok: false, error: 'rmc_not_configured' }, 500);

  const aiUrl = (Deno.env.get('RMC_AI_EXTRACT_URL') ?? '').trim();
  if (!aiUrl) return json({ ok: false, error: 'RMC_AI_EXTRACT_URL_missing' }, 500);

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
  const rmc = createClient(rmcCfg.url, rmcCfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: row, error: rowErr } = await rmc
    .from('resumes')
    .select('id, storage_bucket, storage_path, original_filename, name, whatsapp')
    .eq('id', resumeId)
    .maybeSingle();
  if (rowErr || !row) return json({ ok: false, error: `lookup_failed:${rowErr?.message ?? 'not_found'}` }, 404);

  const bucket = String((row as Record<string, unknown>).storage_bucket ?? 'resumes');
  const storagePath = String(body.storagePath ?? (row as Record<string, unknown>).storage_path ?? '');
  if (!storagePath) return json({ ok: false, error: 'no_storage_path' }, 400);

  const { data: blob, error: dlErr } = await rmc.storage.from(bucket).download(storagePath);
  if (dlErr || !blob) return json({ ok: false, error: `download_failed:${dlErr?.message ?? 'no_blob'}` }, 500);

  const buf = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || 'application/octet-stream';
  const filename = storagePath.split('/').pop() || 'cv';
  const candidateName =
    String(body.candidateName ?? (row as Record<string, unknown>).name ?? '').trim();

  await enrichResumeViaRmcAiExtract({
    rmcConfig: rmcCfg,
    resumeId,
    fileBytes: buf,
    fileMime: mime,
    originalFilename: filename,
    candidateName,
    whatsappE164: toE164ForRmc(waUserId),
  });

  return json({ ok: true, resumeId });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method === 'GET') {
    return json({ ok: true, service: 'whatsapp-webhook', build: 'v7' });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const reqUrl = new URL(req.url);
  if (reqUrl.searchParams.get('reprocess') === '1') {
    return handleReprocess(req);
  }

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
      console.error('[wa-bot] handle error', err);
      errors.push(String((err as { message?: unknown })?.message ?? err));
    }
  }

  return json({ ok: errors.length === 0, processed, errors });
});
