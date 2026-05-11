// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
// WhatsApp recruitment bot webhook — PRD v4 (job ref, returning CV, interactive opt-in, post-flow).
//
// State machine implementation lives in dispatch.ts (dispatchBotMessage).
//
// Build marker (used to confirm Supabase Edge runtime is serving the latest
// version): WA_BOT_BUILD_2026_05_11_v10

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { buildConfig, downloadMedia, InfobipConfig } from './infobip.ts';
import { enrichResumeViaRmcAiExtract } from './resumeAiEnrich.ts';
import { dispatchBotMessage, type ConversationRow, type InboundMessage } from './dispatch.ts';
import { getRmcServiceConfig, toE164ForRmc } from './rmc.ts';

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

    // WhatsApp display name as reported by Infobip. The field lives on the
    // outer `r.contact.name` in most variants but some payloads put it on
    // r.contact.profile.name or r.contactInfo.name — try all of them.
    const senderName = String(
      r?.contact?.name ??
        r?.contact?.profile?.name ??
        r?.contactInfo?.name ??
        r?.pushName ??
        '',
    ).trim() || undefined;

    // Try to extract a button reply payload regardless of declared type:
    // Infobip variants use BUTTON / INTERACTIVE / INTERACTIVE_BUTTON_REPLY /
    // sometimes plain TEXT with a parallel payload field. If any of those
    // candidates exist, treat the message as a button reply.
    const buttonPayload = String(
      m?.payload ??
        m?.button?.id ??
        m?.button?.payload ??
        m?.interactive?.buttonReply?.id ??
        m?.buttonReply?.id ??
        m?.id ??
        '',
    ).trim();
    const looksLikeButton =
      rawType === 'BUTTON' ||
      rawType.startsWith('INTERACTIVE') ||
      (!!buttonPayload && rawType !== 'TEXT');

    if (looksLikeButton) {
      const title = String(
        m?.title ??
          m?.button?.title ??
          m?.interactive?.buttonReply?.title ??
          m?.buttonReply?.title ??
          m?.text ??
          '',
      ).trim();
      messages.push({
        from,
        messageId,
        type: 'button',
        text: buttonPayload || title || undefined,
        senderName,
      });
      continue;
    }

    if (rawType === 'TEXT') {
      messages.push({
        from,
        messageId,
        type: 'text',
        text: String(m?.text ?? '').trim(),
        senderName,
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
        senderName,
      });
      continue;
    }

    messages.push({
      from,
      messageId,
      type: rawType.toLowerCase() || 'unknown',
      text: typeof m?.text === 'string' ? m.text : undefined,
      senderName,
    });
  }
  return messages;
};

// -------- DB helpers --------

const DEFAULT_CONVERSATION_FIELDS = `
  id, wa_user_id, state, candidate_name, resume_storage_path,
  last_resume_storage_path, last_resume_received_at, language,
  is_human_takeover, last_inbound_message_id, opt_in_clarify_count,
  rmc_resume_id, rmc_sync_status, rmc_sync_error,
  completed_at, archived_at, created_at, last_message_at,
  applying_job_id, applying_job_title, applying_job_company
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
// Rule:
//   - Active row exists (archived_at IS NULL) → use it.
//   - Otherwise → create a fresh row.
async function resolveConversationForInbound(
  supabase: SupabaseClient,
  waUserId: string,
): Promise<{ conversation: ConversationRow; isFreshlyCreated: boolean }> {
  const active = await findActiveConversation(supabase, waUserId);
  if (active) {
    return { conversation: active, isFreshlyCreated: false };
  }

  const created = await createConversation(supabase, waUserId);
  return { conversation: created, isFreshlyCreated: true };
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
    return json({ ok: true, service: 'whatsapp-webhook', build: 'v10' });
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
      await dispatchBotMessage(supabase, config, msg, payload, downloadMedia, resolveConversationForInbound);
      processed += 1;
    } catch (err) {
      console.error('[wa-bot] handle error', err);
      errors.push(String((err as { message?: unknown })?.message ?? err));
    }
  }

  return json({ ok: errors.length === 0, processed, errors });
});
