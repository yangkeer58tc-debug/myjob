// After WhatsApp → RMC row + storage sync, call RMC Cloudflare /ai-extract and
// merge structured fields back into public.resumes (same Supabase as rmc.ts).
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import type { RmcConfig } from './rmc.ts';
import { extractResumePlainText } from './resumeTextExtract.ts';

/** RMC /ai-extract caps image payload (~6.5M base64 chars); stay under it. */
const MAX_IMAGE_B64_CHARS = 6_400_000;

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

async function patchAiError(rmc: RmcConfig, resumeId: string, msg: string) {
  const client = createClient(rmc.url, rmc.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client
    .from('resumes')
    .update({
      ai_error: msg.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', resumeId);
}

export async function enrichResumeViaRmcAiExtract(opts: {
  rmcConfig: RmcConfig;
  resumeId: string;
  fileBytes: Uint8Array;
  fileMime: string;
  originalFilename: string;
  candidateName: string;
  whatsappE164: string;
}): Promise<void> {
  const url = (Deno.env.get('RMC_AI_EXTRACT_URL') ?? '').trim().replace(/\/+$/, '');
  if (!url) {
    console.log('[wa-bot enrich] RMC_AI_EXTRACT_URL missing, skip');
    return;
  }

  const filename = opts.originalFilename || 'resume';
  const { text: extractedText, mode } = await extractResumePlainText(
    opts.fileBytes,
    opts.fileMime,
    filename,
  );

  let body: Record<string, unknown>;
  if (mode === 'image') {
    const b64 = encodeBase64(opts.fileBytes);
    if (b64.length > MAX_IMAGE_B64_CHARS) {
      console.warn(
        '[wa-bot enrich] image too large for multimodal; using filename-only prompt',
      );
      body = {
        text: `Resume image attached (too large for vision). Filename: ${filename}.`,
        filename,
      };
    } else {
      const imageMime = opts.fileMime.startsWith('image/') ? opts.fileMime : 'image/jpeg';
      body = {
        text: 'Resume image attached. Extract structured candidate fields from the image.',
        filename,
        image_base64: b64,
        image_mime: imageMime,
      };
    }
  } else {
    const t = extractedText.trim().length
      ? extractedText
      : '(No text could be extracted from this file; infer only from filename.)';
    body = { text: t.slice(0, 29_999), filename };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.error('[wa-bot enrich] ai-extract HTTP', res.status, raw.slice(0, 500));
    await patchAiError(opts.rmcConfig, opts.resumeId, `ai_extract_http:${res.status}`);
    return;
  }

  let parsed: { success?: boolean; data?: Record<string, unknown>; meta?: { model?: string } };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[wa-bot enrich] invalid JSON', raw.slice(0, 300));
    return;
  }

  if (!parsed.success || !parsed.data) {
    console.error('[wa-bot enrich] ai-extract error payload', raw.slice(0, 500));
    await patchAiError(opts.rmcConfig, opts.resumeId, 'ai_extract_failed');
    return;
  }

  const d = parsed.data;
  const rmc = createClient(opts.rmcConfig.url, opts.rmcConfig.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const patch: Record<string, unknown> = {
    parse_error: null,
    ai_error: null,
    ai_used: true,
    ai_model: parsed.meta?.model ?? null,
    ai_extracted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (extractedText.trim().length) {
    patch.text_content = extractedText.slice(0, 500_000);
  }

  const nameFromAi = str(d.full_name, 120);
  if (nameFromAi) patch.name = nameFromAi;
  else if (opts.candidateName.trim()) patch.name = opts.candidateName.trim().slice(0, 120);

  const fn = str(d.first_name, 80);
  const ln = str(d.last_name, 80);
  if (fn) patch.first_name = fn;
  if (ln) patch.last_name = ln;

  const c = str(d.country, 80);
  const ci = str(d.city, 80);
  if (c) patch.country = c;
  if (ci) patch.city = ci;

  const em = str(d.email, 200);
  if (em) patch.email = em;

  const ph = str(d.phone, 60);
  if (ph) patch.phone = ph;

  patch.whatsapp = opts.whatsappE164;

  if (typeof d.work_years === 'number' && Number.isFinite(d.work_years)) {
    patch.work_years = Math.min(80, Math.max(0, Math.trunc(d.work_years)));
  }

  if (Array.isArray(d.education)) patch.education = d.education.slice(0, 12);

  const intro = str(d.intro_summary_original, 2000);
  if (intro) patch.intro_summary_original = intro;

  const introLang = str(d.intro_language, 12);
  if (introLang) patch.intro_language = introLang;

  const prof = str(d.profile_summary, 2000);
  if (prof) patch.profile_summary = prof;

  const profLang = str(d.profile_summary_language, 12);
  if (profLang) patch.profile_summary_language = profLang;

  const jobDir = str(d.job_direction, 60);
  if (jobDir) patch.job_direction = jobDir;

  const { error } = await rmc.from('resumes').update(patch).eq('id', opts.resumeId);
  if (error) {
    console.error('[wa-bot enrich] DB update failed', error);
  } else {
    console.log('[wa-bot enrich] ok resumeId=%s', opts.resumeId);
  }
}
