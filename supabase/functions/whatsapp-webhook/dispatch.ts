// WhatsApp bot state machine (v8) — job ref, returning users, interactive opt-in,
// post-completion actions, application audit log.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { COPY } from './copy.ts';
import { enrichResumeViaRmcAiExtract } from './resumeAiEnrich.ts';
import {
  downloadRmcResumeForSync,
  findRmcResumeByWhatsApp,
  getRmcServiceConfig,
  syncResumeToRmc,
  toE164ForRmc,
} from './rmc.ts';
import {
  BTN_HELP,
  BTN_JOIN_PANEL,
  BTN_MORE_JOBS,
  BTN_OPT_IN_NO,
  BTN_OPT_IN_YES,
  BTN_REC_JOBS,
  BTN_RET_NEW,
  BTN_RET_SAME,
  expressesNoCv,
  extFromMime,
  extractJobRefFromText,
  isExplicitNo,
  isReturningSameCvChoice,
  isStrictSi,
  matchesButton,
  stripJobRefTag,
} from './parsing.ts';
import type { InfobipConfig } from './infobip.ts';
import { sendInteractiveButtons, sendText } from './infobip.ts';

export type ConversationState =
  | 'new'
  | 'awaiting_resume'
  | 'awaiting_returning_cv_choice'
  | 'awaiting_opt_in'
  | 'completed_opt_in'
  | 'completed_declined'
  | 'completed_no_cv';

export type RmcSyncStatusValue =
  | 'none'
  | 'pending'
  | 'success'
  | 'failed'
  | 'skipped_no_config'
  | 'skipped_staging';

export type ConversationRow = {
  id: string;
  wa_user_id: string;
  state: ConversationState;
  candidate_name: string | null;
  resume_storage_path: string | null;
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
  applying_job_id: string | null;
  applying_job_title: string | null;
  applying_job_company: string | null;
};

export type InboundMessage = {
  from: string;
  messageId: string;
  type: string;
  text?: string;
  mediaUrl?: string;
  mediaMime?: string;
  filename?: string;
  /** WhatsApp display name reported by Infobip (best-effort). */
  senderName?: string;
};

/**
 * Pick the best candidate name we currently know for this WhatsApp user.
 * Priority:
 *   1. conversation.candidate_name (already stored, possibly from earlier flow)
 *   2. WhatsApp display name supplied by Infobip
 *   3. Fallback `Candidato <last4>` so /buscar-candidatos can still render it
 */
export function resolveCandidateName(
  conversation: ConversationRow,
  msg: { from: string; senderName?: string | null },
): string {
  const stored = String(conversation.candidate_name ?? '').trim();
  if (stored) return stored;
  const sender = String(msg.senderName ?? '').trim();
  if (sender) return sender;
  const last4 = String(msg.from ?? '').replace(/\D/g, '').slice(-4) || '0000';
  return `Candidato ${last4}`;
}

const RESUME_BUCKET = 'whatsapp-resumes';
const RESUME_MAX_BYTES = 10 * 1024 * 1024;
const MULTI_IMAGE_HINT_WINDOW_MS = 30 * 1000;

function scheduleBackground(promise: Promise<void>): void {
  // ALWAYS wrap the promise in a catch so a background failure (e.g. enrich
  // DNS error) can never reach the isolate / EdgeRuntime as an unhandled
  // rejection. This guarantees the foreground request finishes regardless.
  const safe = promise.catch((e: unknown) => {
    const msg = (e as { message?: unknown })?.message ?? e;
    console.error('[wa-bot background]', msg);
  });
  const w = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil;
  if (typeof w === 'function') w(safe);
}

const safeFilename = (raw: string | undefined, ext: string, fallback: string): string => {
  const cleaned = String(raw ?? '')
    .split('/').pop()!
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);
  if (cleaned && /\.[a-zA-Z0-9]+$/.test(cleaned)) return cleaned;
  return `${fallback}.${ext}`;
};

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

async function replyInteractive(
  supabase: SupabaseClient,
  config: InfobipConfig,
  conversation: ConversationRow,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<void> {
  const send = await sendInteractiveButtons(config, conversation.wa_user_id, bodyText, buttons);
  await recordMessage(supabase, {
    conversationId: conversation.id,
    waUserId: conversation.wa_user_id,
    direction: 'outbound',
    type: 'interactive_buttons',
    body: JSON.stringify({ bodyText, buttons }),
    raw: { ok: send.ok, status: send.status, body: send.body },
  });
}

async function purgeUserResumeFiles(supabase: SupabaseClient, waUserId: string): Promise<void> {
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

async function downloadAndStoreResume(
  supabase: SupabaseClient,
  config: InfobipConfig,
  waUserId: string,
  msg: InboundMessage,
  downloadMedia: (c: InfobipConfig, url: string) => Promise<
    { ok: boolean; status: number; bytes?: Uint8Array; contentType?: string; error?: string }
  >,
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
  const others = data.filter((d: any) => String(d.infobip_message_id) !== currentMessageId);
  return others.length > 0;
}

async function archiveConversation(supabase: SupabaseClient, conversationId: string) {
  await supabase
    .from('whatsapp_conversations')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', conversationId);
}

async function fetchJobByRef(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ title: string; b_name: string } | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('title,b_name')
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) return null;
  return { title: String((data as any).title ?? ''), b_name: String((data as any).b_name ?? '') };
}

async function patchConversationJobFields(
  supabase: SupabaseClient,
  convId: string,
  ref: string | null,
  job: { title: string; b_name: string } | null,
) {
  await supabase
    .from('whatsapp_conversations')
    .update({
      applying_job_id: ref,
      applying_job_title: job?.title ?? null,
      applying_job_company: job?.b_name ?? null,
    } as any)
    .eq('id', convId);
}

async function insertApplication(
  supabase: SupabaseClient,
  row: {
    conversation_id: string;
    wa_user_id: string;
    rmc_resume_id: string | null;
    job_id: string | null;
    job_title: string | null;
    job_company: string | null;
    reused_existing_cv: boolean;
    opt_in_status: 'opted_in' | 'declined' | 'pending';
  },
) {
  await supabase.from('whatsapp_applications').insert({
    conversation_id: row.conversation_id,
    wa_user_id: row.wa_user_id,
    rmc_resume_id: row.rmc_resume_id,
    job_id: row.job_id,
    job_title: row.job_title,
    job_company: row.job_company,
    reused_existing_cv: row.reused_existing_cv,
    opt_in_status: row.opt_in_status,
  } as any);
}

function jobTitleLabel(c: ConversationRow): string {
  return (c.applying_job_title ?? '').trim() || 'esta vacante';
}

function jobCompanyLabel(c: ConversationRow): string {
  return (c.applying_job_company ?? '').trim() || 'la empresa';
}

async function recommendQueryForUser(
  supabase: SupabaseClient,
  conversation: ConversationRow,
): Promise<string> {
  if (conversation.rmc_resume_id) {
    const rmcCfg = getRmcServiceConfig();
    if (rmcCfg) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
      const rmc = createClient(rmcCfg.url, rmcCfg.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await rmc
        .from('resumes')
        .select('job_direction')
        .eq('id', conversation.rmc_resume_id)
        .maybeSingle();
      const jd = String((data as any)?.job_direction ?? '').trim();
      if (jd) return jd;
    }
  }
  return (conversation.applying_job_title ?? '').trim() || 'empleo';
}

async function sendPostFlowInteractive(
  supabase: SupabaseClient,
  config: InfobipConfig,
  conversation: ConversationRow,
  variant: 'after_opt_in' | 'after_decline' | 'after_no_cv',
) {
  const body = `${COPY.postFlowIntro}\n\n${COPY.menuHint}`;
  if (variant === 'after_no_cv') {
    await replyInteractive(supabase, config, conversation, body, [
      { id: BTN_MORE_JOBS, title: 'Ver vacantes' },
      { id: BTN_HELP, title: 'Ayuda' },
    ]);
    return;
  }
  const buttons =
    variant === 'after_decline'
      ? [
          { id: BTN_MORE_JOBS, title: 'Más vacantes' },
          { id: BTN_REC_JOBS, title: 'Recomiéndame' },
          { id: BTN_JOIN_PANEL, title: 'Súmame al panel' },
        ]
      : [
          { id: BTN_MORE_JOBS, title: 'Más vacantes' },
          { id: BTN_REC_JOBS, title: 'Recomiéndame' },
          { id: BTN_HELP, title: 'Ayuda' },
        ];
  await replyInteractive(supabase, config, conversation, body, buttons);
}

async function handleCompletedInbound(
  supabase: SupabaseClient,
  config: InfobipConfig,
  conversation: ConversationRow,
  msg: InboundMessage,
  inboundText: string,
  downloadMedia: (c: InfobipConfig, url: string) => Promise<
    { ok: boolean; status: number; bytes?: Uint8Array; contentType?: string; error?: string }
  >,
) {
  const t = inboundText.trim();
  const low = stripJobRefTag(t).toLowerCase();
  if (low === 'menu' || low === 'menú' || low === 'ayuda') {
    await sendPostFlowInteractive(
      supabase,
      config,
      conversation,
      conversation.state === 'completed_declined' ? 'after_decline' : 'after_opt_in',
    );
    return;
  }
  if (matchesButton(t, BTN_MORE_JOBS, 'Más vacantes', 'Mas vacantes', 'Ver vacantes')) {
    await reply(supabase, config, conversation, COPY.postFlowMoreJobs());
    return;
  }
  if (matchesButton(t, BTN_REC_JOBS, 'Recomiéndame', 'Recomiendame')) {
    const q = await recommendQueryForUser(supabase, conversation);
    await reply(supabase, config, conversation, COPY.postFlowRecommend(q));
    return;
  }
  if (matchesButton(t, BTN_HELP, 'Ayuda')) {
    await reply(supabase, config, conversation, COPY.postFlowHelp());
    return;
  }
  if (
    matchesButton(t, BTN_JOIN_PANEL, 'Súmame al panel', 'Sumame al panel') &&
    conversation.state === 'completed_declined'
  ) {
    const path = conversation.last_resume_storage_path ?? conversation.resume_storage_path;
    if (!path) {
      await reply(supabase, config, conversation, COPY.pleaseSendDocument);
      return;
    }
    const { data: blob, error: dlErr } = await supabase.storage.from(RESUME_BUCKET).download(path);
    if (dlErr || !blob) {
      await reply(supabase, config, conversation, COPY.errorGeneric);
      return;
    }
    const enrichBuf = new Uint8Array(await blob.arrayBuffer());
    const enrichMime = blob.type || 'application/octet-stream';
    const enrichFilename = path.split('/').pop() || 'cv';
    const candidateName = resolveCandidateName(conversation, msg);
    const result = await syncResumeToRmc({
      waUserId: msg.from,
      candidateName,
      fileBytes: enrichBuf,
      fileMime: enrichMime,
      originalFilename: enrichFilename,
    });
    const userOk = result.status === 'success' || result.status === 'skipped_no_config' ||
      result.status === 'skipped_staging';
    if (!userOk) {
      await reply(supabase, config, conversation, COPY.errorGeneric);
      return;
    }
    const completedAt = new Date().toISOString();
    await supabase
      .from('whatsapp_conversations')
      .update({
        state: 'completed_opt_in',
        rmc_resume_id: result.resumeId ?? conversation.rmc_resume_id,
        rmc_sync_status: result.status,
        rmc_sync_error: result.error ?? null,
        completed_at: completedAt,
        last_message_at: completedAt,
      } as any)
      .eq('id', conversation.id);
    await insertApplication(supabase, {
      conversation_id: conversation.id,
      wa_user_id: conversation.wa_user_id,
      rmc_resume_id: result.resumeId ?? null,
      job_id: conversation.applying_job_id,
      job_title: conversation.applying_job_title,
      job_company: conversation.applying_job_company,
      reused_existing_cv: false,
      opt_in_status: 'opted_in',
    });
    const aiUrl = (Deno.env.get('RMC_AI_EXTRACT_URL') ?? '').trim();
    const rmcCfg = getRmcServiceConfig();
    if (result.status === 'success' && result.resumeId && enrichBuf.length && rmcCfg && aiUrl) {
      scheduleBackground(
        enrichResumeViaRmcAiExtract({
          rmcConfig: rmcCfg,
          resumeId: result.resumeId,
          fileBytes: enrichBuf,
          fileMime: enrichMime,
          originalFilename: enrichFilename,
          candidateName,
          whatsappE164: toE164ForRmc(msg.from),
        }),
      );
    }
    await reply(supabase, config, conversation, COPY.optInConfirmed);
    await sendPostFlowInteractive(supabase, config, conversation, 'after_opt_in');
    return;
  }
  if (msg.type === 'document' || msg.type === 'image') {
    await reply(supabase, config, conversation, COPY.postFlowMoreJobs());
    return;
  }
  await sendPostFlowInteractive(
    supabase,
    config,
    conversation,
    conversation.state === 'completed_declined' ? 'after_decline' : 'after_opt_in',
  );
}

async function maybeRestartCompletedForNewIntent(
  supabase: SupabaseClient,
  conversation: ConversationRow,
  msg: InboundMessage,
): Promise<{ conversation: ConversationRow; restarted: boolean }> {
  const done =
    conversation.state === 'completed_opt_in' ||
    conversation.state === 'completed_declined' ||
    conversation.state === 'completed_no_cv';
  if (!done) return { conversation, restarted: false };

  const textBlob = [msg.text, msg.filename].filter(Boolean).join(' ');
  const ref = extractJobRefFromText(textBlob);
  const isFile = msg.type === 'document' || msg.type === 'image';
  const prevRef = (conversation.applying_job_id ?? '').trim();
  const newJob = Boolean(ref && ref !== prevRef);
  if (isFile || newJob) {
    await archiveConversation(supabase, conversation.id);
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .insert({ wa_user_id: conversation.wa_user_id, state: 'new' } as any)
      .select(
        `id, wa_user_id, state, candidate_name, resume_storage_path,
        last_resume_storage_path, last_resume_received_at, language,
        is_human_takeover, last_inbound_message_id, opt_in_clarify_count,
        rmc_resume_id, rmc_sync_status, rmc_sync_error,
        completed_at, archived_at, created_at, last_message_at,
        applying_job_id, applying_job_title, applying_job_company`,
      )
      .single();
    if (error) throw error;
    if (!data) throw new Error('whatsapp_conversations insert returned no row');
    return { conversation: data as ConversationRow, restarted: true };
  }
  return { conversation, restarted: false };
}

async function runOptInSyncPipeline(
  supabase: SupabaseClient,
  config: InfobipConfig,
  conversation: ConversationRow,
  msg: InboundMessage,
  candidateName: string,
): Promise<{
  userOk: boolean;
  syncStatus: RmcSyncStatusValue;
  syncedResumeId: string | null;
  syncError: string | null;
  enrichBuf: Uint8Array | null;
  enrichMime: string;
  enrichFilename: string;
}> {
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
    const { data: blob, error: dlErr } = await supabase.storage.from(RESUME_BUCKET).download(path);
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
  return { userOk, syncStatus, syncedResumeId, syncError, enrichBuf, enrichMime, enrichFilename };
}

export async function dispatchBotMessage(
  supabase: SupabaseClient,
  config: InfobipConfig,
  msg: InboundMessage,
  raw: unknown,
  downloadMediaFn: (c: InfobipConfig, url: string) => Promise<
    { ok: boolean; status: number; bytes?: Uint8Array; contentType?: string; error?: string }
  >,
  resolveConversationForInbound: (
    supabase: SupabaseClient,
    waUserId: string,
  ) => Promise<{ conversation: ConversationRow; isFreshlyCreated: boolean }>,
): Promise<void> {
  let { conversation, isFreshlyCreated } = await resolveConversationForInbound(supabase, msg.from);
  const split = await maybeRestartCompletedForNewIntent(supabase, conversation, msg);
  if (split.restarted) {
    conversation = split.conversation;
    isFreshlyCreated = true;
  }

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

  if (conversation.last_inbound_message_id === msg.messageId) {
    return;
  }

  if (conversation.is_human_takeover) {
    await supabase
      .from('whatsapp_conversations')
      .update({
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      } as any)
      .eq('id', conversation.id);
    return;
  }

  const inboundText = (msg.type === 'text' || msg.type === 'button' ? msg.text : '') ?? '';

  let stateNow: ConversationState =
    (conversation.state as string) === 'awaiting_name' ? 'awaiting_resume' : conversation.state;

  if (
    stateNow === 'completed_opt_in' ||
    stateNow === 'completed_declined' ||
    stateNow === 'completed_no_cv'
  ) {
    await handleCompletedInbound(supabase, config, conversation, msg, inboundText, downloadMediaFn);
    await supabase
      .from('whatsapp_conversations')
      .update({
        last_inbound_message_id: msg.messageId,
        last_message_at: new Date().toISOString(),
      } as any)
      .eq('id', conversation.id);
    return;
  }

  const effectiveState: ConversationState = isFreshlyCreated ? 'new' : stateNow;

  const bump = {
    last_inbound_message_id: msg.messageId,
    last_message_at: new Date().toISOString(),
  };

  const extractRefFromMsg = () =>
    extractJobRefFromText(
      [msg.text, msg.filename].filter(Boolean).join(' '),
    );

  const isFile = msg.type === 'document' || msg.type === 'image';

  // ---- new ----
  if (effectiveState === 'new') {
    const ref = extractRefFromMsg();
    const job = ref ? await fetchJobByRef(supabase, ref) : null;
    await patchConversationJobFields(supabase, conversation.id, ref, job);

    const convFresh = {
      ...conversation,
      applying_job_id: ref,
      applying_job_title: job?.title ?? null,
      applying_job_company: job?.b_name ?? null,
    } as ConversationRow;

    if (isFile) {
      const stored = await downloadAndStoreResume(supabase, config, msg.from, msg, downloadMediaFn);
      if (!stored.ok) {
        const text = stored.reason === 'too_large' ? COPY.fileTooLarge : COPY.errorGeneric;
        await reply(supabase, config, convFresh, text);
        await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_resume' } as any).eq(
          'id',
          conversation.id,
        );
        return;
      }
      if (msg.type === 'image') {
        const seen = await userJustSentAnotherImage(supabase, conversation.id, msg.messageId);
        if (seen) await reply(supabase, config, convFresh, COPY.multipleImagesHint);
      }
      await replyInteractive(supabase, config, convFresh, COPY.optInInteractiveBody(), [
        { id: BTN_OPT_IN_YES, title: 'Sí, súmame' },
        { id: BTN_OPT_IN_NO, title: 'Ahora no' },
      ]);
      const derivedName = resolveCandidateName(convFresh, msg);
      await supabase
        .from('whatsapp_conversations')
        .update({
          ...bump,
          state: 'awaiting_opt_in',
          candidate_name: convFresh.candidate_name ?? derivedName,
          last_resume_storage_path: stored.path,
          resume_storage_path: stored.path,
          last_resume_received_at: new Date().toISOString(),
        } as any)
        .eq('id', conversation.id);
      return;
    }

    const existing = await findRmcResumeByWhatsApp(msg.from);
    if (existing) {
      const jt = jobTitleLabel(convFresh);
      const jc = jobCompanyLabel(convFresh);
      const body = job
        ? COPY.returningAskChoice(jt, jc)
        : COPY.returningAskChoiceNoJob;
      await replyInteractive(supabase, config, convFresh, body, [
        { id: BTN_RET_SAME, title: 'Mismo CV' },
        { id: BTN_RET_NEW, title: 'Nuevo CV' },
      ]);
      await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_returning_cv_choice' } as any)
        .eq('id', conversation.id);
      return;
    }

    const welcome = job
      ? COPY.welcomeWithJob(job.title, job.b_name)
      : COPY.welcomeNoJob;
    await reply(supabase, config, convFresh, `${welcome}\n\n${COPY.menuHint}`);
    await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_resume' } as any).eq(
      'id',
      conversation.id,
    );
    return;
  }

  // ---- awaiting_returning_cv_choice ----
  if (effectiveState === 'awaiting_returning_cv_choice') {
    const t = inboundText.trim();
    if (matchesButton(t, BTN_RET_NEW, 'Nuevo CV', 'Subir nuevo CV') || isExplicitNo(t)) {
      await reply(supabase, config, conversation, COPY.welcomeNoJob);
      await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_resume' } as any).eq(
        'id',
        conversation.id,
      );
      return;
    }
    if (isReturningSameCvChoice(inboundText)) {
      const pack = await downloadRmcResumeForSync(msg.from);
      if (!pack) {
        await reply(supabase, config, conversation, COPY.errorGeneric);
        await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_resume' } as any).eq(
          'id',
          conversation.id,
        );
        return;
      }
      const candidateName = String(pack.snapshot.name ?? '').trim();
      const result = await syncResumeToRmc({
        waUserId: msg.from,
        candidateName,
        fileBytes: pack.bytes,
        fileMime: pack.mime,
        originalFilename: pack.filename,
      });
      const userOk = result.status === 'success' || result.status === 'skipped_no_config' ||
        result.status === 'skipped_staging';
      if (!userOk) {
        await reply(supabase, config, conversation, COPY.errorGeneric);
        await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
        return;
      }
      const completedAt = new Date().toISOString();
      await supabase
        .from('whatsapp_conversations')
        .update({
          ...bump,
          state: 'completed_opt_in',
          candidate_name: candidateName || conversation.candidate_name,
          rmc_resume_id: result.resumeId ?? null,
          rmc_sync_status: result.status,
          rmc_sync_error: result.error ?? null,
          completed_at: completedAt,
          last_message_at: completedAt,
        } as any)
        .eq('id', conversation.id);
      await insertApplication(supabase, {
        conversation_id: conversation.id,
        wa_user_id: conversation.wa_user_id,
        rmc_resume_id: result.resumeId ?? null,
        job_id: conversation.applying_job_id,
        job_title: conversation.applying_job_title,
        job_company: conversation.applying_job_company,
        reused_existing_cv: true,
        opt_in_status: 'opted_in',
      });
      const aiUrl = (Deno.env.get('RMC_AI_EXTRACT_URL') ?? '').trim();
      const rmcCfg = getRmcServiceConfig();
      if (result.status === 'success' && result.resumeId && pack.bytes.byteLength && rmcCfg && aiUrl) {
        scheduleBackground(
          enrichResumeViaRmcAiExtract({
            rmcConfig: rmcCfg,
            resumeId: result.resumeId,
            fileBytes: pack.bytes,
            fileMime: pack.mime,
            originalFilename: pack.filename,
            candidateName,
            whatsappE164: toE164ForRmc(msg.from),
          }),
        );
      }
      await reply(supabase, config, conversation, COPY.returningSameSynced(jobTitleLabel(conversation)));
      await sendPostFlowInteractive(supabase, config, conversation, 'after_opt_in');
      return;
    }
    await reply(supabase, config, conversation, 'Toca *Mismo CV* o *Nuevo CV*, o escribe *menu*.');
    await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
    return;
  }

  // ---- awaiting_resume ----
  if (effectiveState === 'awaiting_resume') {
    if (msg.type === 'text' && expressesNoCv(msg.text ?? '')) {
      await reply(supabase, config, conversation, COPY.noCvClose);
      const completedAt = new Date().toISOString();
      await supabase
        .from('whatsapp_conversations')
        .update({
          ...bump,
          state: 'completed_no_cv',
          completed_at: completedAt,
          last_message_at: completedAt,
        } as any)
        .eq('id', conversation.id);
      await archiveConversation(supabase, conversation.id);
      return;
    }
    if (!isFile) {
      await reply(supabase, config, conversation, COPY.pleaseSendDocument);
      await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
      return;
    }
    const stored = await downloadAndStoreResume(supabase, config, msg.from, msg, downloadMediaFn);
    if (!stored.ok) {
      const text = stored.reason === 'too_large' ? COPY.fileTooLarge : COPY.errorGeneric;
      await reply(supabase, config, conversation, text);
      await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
      return;
    }
    if (msg.type === 'image') {
      const seen = await userJustSentAnotherImage(supabase, conversation.id, msg.messageId);
      if (seen) await reply(supabase, config, conversation, COPY.multipleImagesHint);
    }
    await replyInteractive(supabase, config, conversation, COPY.optInInteractiveBody(), [
      { id: BTN_OPT_IN_YES, title: 'Sí, súmame' },
      { id: BTN_OPT_IN_NO, title: 'Ahora no' },
    ]);
    const derivedName = resolveCandidateName(conversation, msg);
    await supabase
      .from('whatsapp_conversations')
      .update({
        ...bump,
        state: 'awaiting_opt_in',
        candidate_name: conversation.candidate_name ?? derivedName,
        last_resume_storage_path: stored.path,
        resume_storage_path: stored.path,
        last_resume_received_at: new Date().toISOString(),
      } as any)
      .eq('id', conversation.id);
    return;
  }

  // ---- awaiting_opt_in ----
  if (effectiveState === 'awaiting_opt_in') {
    const text = inboundText;
    const positive = isStrictSi(text);
    const negative = isExplicitNo(text);
    if (positive) {
      const candidateName = resolveCandidateName(conversation, msg);
      const pipe = await runOptInSyncPipeline(supabase, config, conversation, msg, candidateName);
      if (!pipe.userOk) {
        await reply(supabase, config, conversation, COPY.errorGeneric);
        await supabase
          .from('whatsapp_conversations')
          .update({
            rmc_sync_status: pipe.syncStatus,
            rmc_sync_error: pipe.syncError,
            ...bump,
          } as any)
          .eq('id', conversation.id);
        return;
      }
      const completedAt = new Date().toISOString();
      await supabase
        .from('whatsapp_conversations')
        .update({
          state: 'completed_opt_in',
          rmc_resume_id: pipe.syncedResumeId,
          rmc_sync_status: pipe.syncStatus,
          rmc_sync_error: pipe.syncError,
          completed_at: completedAt,
          ...bump,
          last_message_at: completedAt,
        } as any)
        .eq('id', conversation.id);
      await insertApplication(supabase, {
        conversation_id: conversation.id,
        wa_user_id: conversation.wa_user_id,
        rmc_resume_id: pipe.syncedResumeId,
        job_id: conversation.applying_job_id,
        job_title: conversation.applying_job_title,
        job_company: conversation.applying_job_company,
        reused_existing_cv: false,
        opt_in_status: 'opted_in',
      });
      const aiUrl = (Deno.env.get('RMC_AI_EXTRACT_URL') ?? '').trim();
      const rmcCfg = getRmcServiceConfig();
      if (
        pipe.syncStatus === 'success' &&
        pipe.syncedResumeId &&
        pipe.enrichBuf &&
        rmcCfg &&
        aiUrl
      ) {
        scheduleBackground(
          enrichResumeViaRmcAiExtract({
            rmcConfig: rmcCfg,
            resumeId: pipe.syncedResumeId,
            fileBytes: pipe.enrichBuf,
            fileMime: pipe.enrichMime,
            originalFilename: pipe.enrichFilename,
            candidateName,
            whatsappE164: toE164ForRmc(msg.from),
          }),
        );
      }
      await reply(supabase, config, conversation, COPY.optInConfirmed);
      await sendPostFlowInteractive(supabase, config, conversation, 'after_opt_in');
      return;
    }
    if (negative) {
      const completedAt = new Date().toISOString();
      await reply(supabase, config, conversation, COPY.optInDeclinedNote);
      await supabase
        .from('whatsapp_conversations')
        .update({
          state: 'completed_declined',
          completed_at: completedAt,
          ...bump,
          last_message_at: completedAt,
        } as any)
        .eq('id', conversation.id);
      await insertApplication(supabase, {
        conversation_id: conversation.id,
        wa_user_id: conversation.wa_user_id,
        rmc_resume_id: conversation.rmc_resume_id,
        job_id: conversation.applying_job_id,
        job_title: conversation.applying_job_title,
        job_company: conversation.applying_job_company,
        reused_existing_cv: false,
        opt_in_status: 'declined',
      });
      await sendPostFlowInteractive(supabase, config, conversation, 'after_decline');
      return;
    }
    if ((conversation.opt_in_clarify_count ?? 0) >= 1) {
      const completedAt = new Date().toISOString();
      await supabase
        .from('whatsapp_conversations')
        .update({
          state: 'completed_declined',
          completed_at: completedAt,
          ...bump,
          last_message_at: completedAt,
        } as any)
        .eq('id', conversation.id);
      return;
    }
    await reply(supabase, config, conversation, COPY.optInDeclinedOrUnclear);
    await supabase
      .from('whatsapp_conversations')
      .update({
        opt_in_clarify_count: (conversation.opt_in_clarify_count ?? 0) + 1,
        ...bump,
      } as any)
      .eq('id', conversation.id);
    return;
  }

  await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
}
