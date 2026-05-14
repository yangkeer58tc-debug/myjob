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
  BTN_BROWSE_JOBS,
  BTN_CONTACT_HUMAN,
  BTN_JOIN_PANEL,
  BTN_OPT_IN_NO,
  BTN_OPT_IN_YES,
  BTN_REC_JOBS,
  BTN_RET_NEW,
  BTN_RET_SAME,
  expressesNoCv,
  extFromMime,
  extractJobRefFromText,
  extractViewJobIdFromButtonText,
  isExplicitNo,
  isMenuRequest,
  isReturningSameCvChoice,
  isStrictSi,
  matchesButton,
  stripJobRefTag,
} from './parsing.ts';
import type { InfobipConfig } from './infobip.ts';
import { sendInteractiveButtons, sendText } from './infobip.ts';
import {
  formatEmployerNameForWhatsApp,
  formatJobCardBody,
  formatJobTitleForWhatsApp,
  mexicoCityDateString,
  pickNextRecommendedJob,
  type JobRecRow,
} from './jobRecommend.ts';

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
const MAX_JOB_RECS_PER_DAY = 5;
const JOBS_FETCH_LIMIT_FOR_RECOMMEND = 500;

const empleosListUrl = (): string => {
  const base = (Deno.env.get('MYJOB_PUBLIC_SITE_URL') ?? 'https://myjob.com').replace(/\/+$/, '');
  return `${base}/empleos`;
};

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
): Promise<{ title: string; b_name: string; slug: string | null } | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('title,b_name,slug')
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    title: String((data as any).title ?? ''),
    b_name: String((data as any).b_name ?? ''),
    slug: (data as any).slug != null ? String((data as any).slug) : null,
  };
}

async function patchConversationJobFields(
  supabase: SupabaseClient,
  convId: string,
  ref: string | null,
  job: { title: string; b_name: string; slug?: string | null } | null,
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
  const raw = (c.applying_job_title ?? '').trim();
  return raw ? formatJobTitleForWhatsApp(raw) : 'esta vacante';
}

function jobCompanyLabel(c: ConversationRow): string {
  const raw = (c.applying_job_company ?? '').trim();
  return raw ? formatEmployerNameForWhatsApp(raw) : 'la empresa';
}

/** Same rules as `scripts/prerender-jobs.mjs` job URL segment. */
function slugifyForJobUrl(value: string): string {
  const s = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'empleo';
}

function myjobPublicSiteBase(): string {
  return (Deno.env.get('MYJOB_PUBLIC_SITE_URL') ?? 'https://myjob.com').replace(/\/+$/, '');
}

async function buildMyjobJobPublicUrl(supabase: SupabaseClient, jobId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id,title,slug')
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; title: string; slug: string | null };
  const head = (row.slug && String(row.slug).trim())
    ? slugifyForJobUrl(row.slug)
    : slugifyForJobUrl(row.title);
  return `${myjobPublicSiteBase()}/empleo/${head}-${row.id}/`;
}

async function countRecommendationsToday(supabase: SupabaseClient, waUserId: string): Promise<number> {
  const day = mexicoCityDateString();
  const { count, error } = await supabase
    .from('whatsapp_job_recommendation_events')
    .select('id', { count: 'exact', head: true })
    .eq('wa_user_id', waUserId)
    .eq('day_mx', day);
  if (error) console.error('[wa-bot] count recommendations today', error);
  return count ?? 0;
}

async function collectExcludedJobIdsForRecommend(
  supabase: SupabaseClient,
  waUserId: string,
): Promise<Set<string>> {
  const excluded = new Set<string>();
  const [{ data: apps }, { data: evs }] = await Promise.all([
    supabase.from('whatsapp_applications').select('job_id').eq('wa_user_id', waUserId).not('job_id', 'is', null),
    supabase.from('whatsapp_job_recommendation_events').select('job_id').eq('wa_user_id', waUserId),
  ]);
  for (const r of apps ?? []) {
    const id = String((r as { job_id?: string }).job_id ?? '').trim();
    if (id) excluded.add(id);
  }
  for (const r of evs ?? []) {
    const id = String((r as { job_id?: string }).job_id ?? '').trim();
    if (id) excluded.add(id);
  }
  return excluded;
}

async function loadAnchorJobRow(
  supabase: SupabaseClient,
  waUserId: string,
  conversation: ConversationRow,
): Promise<JobRecRow | null> {
  const { data: app } = await supabase
    .from('whatsapp_applications')
    .select('job_id')
    .eq('wa_user_id', waUserId)
    .not('job_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let anchorId = String((app as { job_id?: string } | null)?.job_id ?? '').trim();
  if (!anchorId) anchorId = String(conversation.applying_job_id ?? '').trim();
  if (!anchorId) return null;
  const { data: row, error } = await supabase
    .from('jobs')
    .select(
      'id,slug,title,b_name,location,salary_amount,payment_frequency,job_type,workplace_type,category,mx_category_code,summary,industry,experience,education_level,is_active,created_at',
    )
    .eq('id', anchorId)
    .maybeSingle();
  if (error || !row) return null;
  return row as unknown as JobRecRow;
}

async function fetchActiveJobPoolForRecommend(supabase: SupabaseClient): Promise<JobRecRow[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id,slug,title,b_name,location,salary_amount,payment_frequency,job_type,workplace_type,category,mx_category_code,summary,industry,experience,education_level,is_active,created_at',
    )
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(JOBS_FETCH_LIMIT_FOR_RECOMMEND);
  if (error) {
    console.error('[wa-bot] fetch job pool', error);
    return [];
  }
  return (data ?? []) as unknown as JobRecRow[];
}

async function sendNextJobRecommendation(
  supabase: SupabaseClient,
  config: InfobipConfig,
  conversation: ConversationRow,
): Promise<void> {
  const n = await countRecommendationsToday(supabase, conversation.wa_user_id);
  if (n >= MAX_JOB_RECS_PER_DAY) {
    await reply(supabase, config, conversation, COPY.recommendDailyCap);
    return;
  }
  const anchor = await loadAnchorJobRow(supabase, conversation.wa_user_id, conversation);
  const excluded = await collectExcludedJobIdsForRecommend(supabase, conversation.wa_user_id);
  const pool = await fetchActiveJobPoolForRecommend(supabase);
  const next = pickNextRecommendedJob(pool, anchor, excluded);
  if (!next) {
    await reply(supabase, config, conversation, COPY.recommendNoRelatedJobs(empleosListUrl()));
    return;
  }
  const card = formatJobCardBody(next);
  const refTag = `[REF:${next.id}]`;
  let body = `${COPY.recommendJobIntro}\n\n${card}`;
  if (body.length > 1020) body = `${body.slice(0, 1017)}…`;
  await replyInteractive(supabase, config, conversation, body, [
    { id: refTag, title: 'Postular' },
    { id: `WA_VIEW_JOB:${next.id}`, title: 'Ver en MyJob' },
  ]);
  const { error: logErr } = await supabase.from('whatsapp_job_recommendation_events').insert({
    wa_user_id: conversation.wa_user_id,
    job_id: next.id,
    day_mx: mexicoCityDateString(),
  } as any);
  if (logErr) console.error('[wa-bot] recommendation event insert', logErr);
}

function postFlowMenuVariant(
  conversation: ConversationRow,
): 'after_opt_in' | 'after_decline' | 'after_no_cv' {
  if (conversation.state === 'completed_declined') return 'after_decline';
  if (conversation.state === 'completed_no_cv') return 'after_no_cv';
  return 'after_opt_in';
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
      { id: BTN_BROWSE_JOBS, title: 'Ver empleos' },
      { id: BTN_CONTACT_HUMAN, title: 'Contacto humano' },
    ]);
    return;
  }
  if (variant === 'after_decline') {
    await replyInteractive(supabase, config, conversation, body, [
      { id: BTN_REC_JOBS, title: 'Recomiéndame' },
      { id: BTN_JOIN_PANEL, title: 'Súmame al panel' },
      { id: BTN_CONTACT_HUMAN, title: 'Contacto humano' },
    ]);
    return;
  }
  await replyInteractive(supabase, config, conversation, body, [
    { id: BTN_REC_JOBS, title: 'Recomiéndame' },
    { id: BTN_CONTACT_HUMAN, title: 'Contacto humano' },
  ]);
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
  const viewJobId = extractViewJobIdFromButtonText(t);
  if (viewJobId) {
    const url = await buildMyjobJobPublicUrl(supabase, viewJobId);
    if (url) await reply(supabase, config, conversation, COPY.viewJobOnMyjob(url));
    else await reply(supabase, config, conversation, COPY.viewJobNotFound);
    return;
  }
  if (isMenuRequest(stripJobRefTag(t))) {
    await sendPostFlowInteractive(supabase, config, conversation, postFlowMenuVariant(conversation));
    return;
  }
  if (
    matchesButton(t, BTN_BROWSE_JOBS, 'Ver empleos', 'Ver vacantes', 'Más vacantes', 'Mas vacantes') ||
    matchesButton(t, 'WA_MORE_JOBS', 'Más vacantes', 'Mas vacantes', 'Ver vacantes', 'Ver empleos')
  ) {
    await reply(supabase, config, conversation, COPY.postFlowMoreJobs());
    return;
  }
  if (matchesButton(t, 'WA_HELP', 'Ayuda')) {
    await reply(supabase, config, conversation, COPY.contactHumanMessage());
    return;
  }
  if (
    matchesButton(
      t,
      BTN_CONTACT_HUMAN,
      'Contacto humano',
      'Contacto',
      'Soporte',
      'Ayuda',
    )
  ) {
    await reply(supabase, config, conversation, COPY.contactHumanMessage());
    return;
  }
  if (
    matchesButton(t, BTN_REC_JOBS, 'Recomiéndame', 'Recomiendame') &&
    (conversation.state === 'completed_opt_in' || conversation.state === 'completed_declined')
  ) {
    await sendNextJobRecommendation(supabase, config, conversation);
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
    postFlowMenuVariant(conversation),
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
    const newId = String((data as any).id);
    const { data: prev } = await supabase
      .from('whatsapp_conversations')
      .select('resume_storage_path,last_resume_storage_path,candidate_name,rmc_resume_id')
      .eq('wa_user_id', conversation.wa_user_id)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev) {
      const p = prev as {
        resume_storage_path: string | null;
        last_resume_storage_path: string | null;
        candidate_name: string | null;
        rmc_resume_id: string | null;
      };
      await supabase
        .from('whatsapp_conversations')
        .update({
          resume_storage_path: p.resume_storage_path ?? null,
          last_resume_storage_path: p.last_resume_storage_path ?? p.resume_storage_path ?? null,
          candidate_name: p.candidate_name ?? null,
          rmc_resume_id: p.rmc_resume_id ?? null,
        } as any)
        .eq('id', newId);
    }
    const { data: merged, error: errMerge } = await supabase
      .from('whatsapp_conversations')
      .select(
        `id, wa_user_id, state, candidate_name, resume_storage_path,
        last_resume_storage_path, last_resume_received_at, language,
        is_human_takeover, last_inbound_message_id, opt_in_clarify_count,
        rmc_resume_id, rmc_sync_status, rmc_sync_error,
        completed_at, archived_at, created_at, last_message_at,
        applying_job_id, applying_job_title, applying_job_company`,
      )
      .eq('id', newId)
      .single();
    if (errMerge || !merged) throw errMerge ?? new Error('whatsapp_conversations re-select failed');
    return { conversation: merged as ConversationRow, restarted: true };
  }
  return { conversation, restarted: false };
}

/**
 * "Reuse previous CV" needs *any* prior CV bytes. Try RMC first (canonical
 * source other modules read from), then fall back to our local
 * `whatsapp-resumes` storage — the user's latest WhatsApp upload, which is
 * always available unless we lost the row entirely.
 *
 * Returning null means the user must re-upload from scratch.
 */
async function downloadAnyPriorResumeForReuse(
  supabase: SupabaseClient,
  conversation: ConversationRow,
  waUserId: string,
): Promise<
  | {
      bytes: Uint8Array;
      mime: string;
      filename: string;
      candidateNameHint: string;
      source: 'rmc' | 'whatsapp_local';
    }
  | null
> {
  const rmcPack = await downloadRmcResumeForSync(waUserId).catch((e) => {
    console.warn('[wa-bot reuse-cv] RMC download threw', e instanceof Error ? e.message : e);
    return null;
  });
  if (rmcPack) {
    return {
      bytes: rmcPack.bytes,
      mime: rmcPack.mime,
      filename: rmcPack.filename,
      candidateNameHint: String(rmcPack.snapshot.name ?? '').trim(),
      source: 'rmc',
    };
  }
  console.warn('[wa-bot reuse-cv] RMC pack not found, trying local WhatsApp storage');

  const localPath = conversation.last_resume_storage_path ?? conversation.resume_storage_path;
  if (!localPath) {
    console.warn('[wa-bot reuse-cv] no local resume path on conversation');
    return null;
  }
  const { data: blob, error } = await supabase.storage.from(RESUME_BUCKET).download(localPath);
  if (error || !blob) {
    console.warn('[wa-bot reuse-cv] local storage download failed', error?.message);
    return null;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    mime: blob.type || 'application/octet-stream',
    filename: localPath.split('/').pop() || 'cv',
    candidateNameHint: String(conversation.candidate_name ?? '').trim(),
    source: 'whatsapp_local',
  };
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
    const localPath = (convFresh.last_resume_storage_path ?? convFresh.resume_storage_path ?? '').trim();
    if (existing || localPath) {
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
      ? COPY.welcomeWithJob(formatJobTitleForWhatsApp(job.title), formatEmployerNameForWhatsApp(job.b_name))
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

    // If the user uploads a new CV directly, treat as "Nuevo CV" path.
    if (isFile) {
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

    if (isMenuRequest(t)) {
      await sendPostFlowInteractive(supabase, config, conversation, 'after_no_cv');
      await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
      return;
    }

    if (matchesButton(t, BTN_RET_NEW, 'Nuevo CV', 'Subir nuevo CV') || isExplicitNo(t)) {
      await reply(supabase, config, conversation, COPY.welcomeNoJob);
      await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_resume' } as any).eq(
        'id',
        conversation.id,
      );
      return;
    }

    if (isReturningSameCvChoice(inboundText)) {
      // Try to recover the user's previous CV from RMC, then from our local
      // WhatsApp storage as a fallback. If both fail we move the user to
      // awaiting_resume with a clear message instead of throwing errorGeneric.
      const pack = await downloadAnyPriorResumeForReuse(supabase, conversation, msg.from);
      if (!pack) {
        await reply(supabase, config, conversation, COPY.returningSameNotFound);
        await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_resume' } as any).eq(
          'id',
          conversation.id,
        );
        return;
      }
      const candidateName = pack.candidateNameHint || resolveCandidateName(conversation, msg);
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
        // RMC sync itself failed (network / permission). Don't blame the
        // user — ask them to resend so the awaiting_resume branch can try
        // a fresh upload.
        await reply(supabase, config, conversation, COPY.returningSameNotFound);
        await supabase.from('whatsapp_conversations').update({ ...bump, state: 'awaiting_resume' } as any).eq(
          'id',
          conversation.id,
        );
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
    if (msg.type === 'text' && isMenuRequest(msg.text ?? '')) {
      await sendPostFlowInteractive(supabase, config, conversation, 'after_no_cv');
      await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
      return;
    }
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
    // The user already sent a CV and we are waiting for Yes/No. If they
    // upload another file now (typical for "wait, wrong CV"), replace the
    // stored resume in place and re-issue the opt-in prompt. Without this
    // branch the bot used to silently treat the upload as no-op, which we
    // saw push users to "Speak in English please" / declined.
    if (isFile) {
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
      await reply(supabase, config, conversation, COPY.resumeReplaced);
      await replyInteractive(supabase, config, conversation, COPY.optInInteractiveBody(), [
        { id: BTN_OPT_IN_YES, title: 'Sí, súmame' },
        { id: BTN_OPT_IN_NO, title: 'Ahora no' },
      ]);
      await supabase
        .from('whatsapp_conversations')
        .update({
          ...bump,
          last_resume_storage_path: stored.path,
          resume_storage_path: stored.path,
          last_resume_received_at: new Date().toISOString(),
        } as any)
        .eq('id', conversation.id);
      return;
    }

    const text = inboundText;
    if (isMenuRequest(text)) {
      await sendPostFlowInteractive(supabase, config, conversation, 'after_no_cv');
      await supabase.from('whatsapp_conversations').update({ ...bump } as any).eq('id', conversation.id);
      return;
    }
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
