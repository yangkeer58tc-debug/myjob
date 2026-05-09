// Adapter that pushes WhatsApp-collected resumes into the RMC project
// (separate Supabase: storage bucket `resumes` + table `public.resumes`).
//
// Architecture (PRD v3 Q1=A):
//   Edge Function uses RMC's service_role key directly. We do NOT proxy
//   through any RMC HTTP API; that keeps latency low and avoids a second
//   deploy surface.
//
// Per-environment routing (PRD v3 Q6):
//   - MYJOB_ENV=staging  →  use RMC_STAGING_* if present; otherwise SKIP sync
//                            (returns ok=true with status='skipped_no_config'
//                            so the user-facing flow still completes).
//   - MYJOB_ENV=production → use RMC_SUPABASE_URL + RMC_SERVICE_ROLE_KEY.

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { toE164ForRmc as _sharedToE164 } from './parsing.ts';

export type RmcSyncStatus =
  | 'success'
  | 'failed'
  | 'skipped_no_config'
  | 'skipped_staging';

export type RmcSyncResult = {
  ok: boolean;
  status: RmcSyncStatus;
  resumeId?: string;
  error?: string;
};

export type RmcConfig = {
  url: string;
  serviceRoleKey: string;
};

// Resolve which RMC instance to write to based on MYJOB_ENV.
//
// Returns null when no RMC instance should be used (typically because we are
// running in staging and RMC has not been configured for staging — per Q6 we
// then skip sync and report `skipped_no_config`).
const resolveRmcConfig = (): { config: RmcConfig | null; reason: RmcSyncStatus | null } => {
  const env = (Deno.env.get('MYJOB_ENV') ?? 'production').trim().toLowerCase();

  if (env === 'staging') {
    const stagingUrl = (Deno.env.get('RMC_STAGING_SUPABASE_URL') ?? '').trim();
    const stagingKey = (Deno.env.get('RMC_STAGING_SERVICE_ROLE_KEY') ?? '').trim();
    if (stagingUrl && stagingKey) return { config: { url: stagingUrl, serviceRoleKey: stagingKey }, reason: null };
    return { config: null, reason: 'skipped_no_config' };
  }

  const url = (Deno.env.get('RMC_SUPABASE_URL') ?? '').trim();
  const key = (Deno.env.get('RMC_SERVICE_ROLE_KEY') ?? '').trim();
  if (!url || !key) return { config: null, reason: 'skipped_no_config' };
  return { config: { url, serviceRoleKey: key }, reason: null };
};

/** Service-role target for the current MYJOB_ENV (null → skip RMC entirely). */
export const getRmcServiceConfig = (): RmcConfig | null => resolveRmcConfig().config;

const buildRmcClient = (config: RmcConfig): SupabaseClient =>
  createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// Re-export so existing callers that imported this from `rmc.ts` keep working.
export const toE164ForRmc = _sharedToE164;

const RMC_RESUMES_BUCKET = 'resumes';
const RMC_RESUMES_TABLE = 'resumes';

const safeFilename = (filename: string | undefined, ext: string, fallback: string): string => {
  const cleaned = String(filename ?? '')
    .split('/').pop()!
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);
  if (cleaned) return cleaned;
  return `${fallback}.${ext}`;
};

const extFromMime = (mime?: string): string => {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('officedocument.wordprocessingml')) return 'docx';
  if (m.includes('msword')) return 'doc';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  return 'bin';
};

export type RmcSyncInput = {
  waUserId: string;          // digits only as Infobip delivers it
  candidateName: string;     // user-provided full name
  fileBytes: Uint8Array;     // resume bytes (already downloaded by webhook)
  fileMime: string;          // best-effort content type
  originalFilename?: string; // original filename if WhatsApp provided one
};

// Push a resume into RMC. Idempotent on `whatsapp` column: re-runs upsert and
// overwrites the storage object so RMC always has the latest CV per user.
export async function syncResumeToRmc(input: RmcSyncInput): Promise<RmcSyncResult> {
  const { config, reason } = resolveRmcConfig();
  if (!config) {
    const status = reason ?? 'skipped_no_config';
    console.log('[wa-bot rmc] skip sync, no RMC config (status=%s)', status);
    return { ok: true, status };
  }

  try {
    const rmc = buildRmcClient(config);
    const phone = toE164ForRmc(input.waUserId);

    const ext = extFromMime(input.fileMime);
    const filename = safeFilename(input.originalFilename, ext, `whatsapp-${input.waUserId}`);
    const storagePath = `whatsapp/${input.waUserId}/${filename}`;

    // 1. Look up an existing RMC row for this phone (idempotency key).
    const { data: existing, error: selErr } = await rmc
      .from(RMC_RESUMES_TABLE)
      .select('id, storage_path, job_direction')
      .eq('whatsapp', phone)
      .maybeSingle();

    if (selErr) {
      console.error('[wa-bot rmc] select error', selErr);
      return { ok: false, status: 'failed', error: `select_failed:${selErr.message}` };
    }

    // 2. Upload (overwrite) the resume object.
    const { error: upErr } = await rmc.storage
      .from(RMC_RESUMES_BUCKET)
      .upload(storagePath, input.fileBytes, {
        contentType: input.fileMime || 'application/octet-stream',
        upsert: true,
      });

    if (upErr) {
      console.error('[wa-bot rmc] storage upload error', upErr);
      return { ok: false, status: 'failed', error: `storage_failed:${upErr.message}` };
    }

    // 3. Insert or update the row. is_public=true marks it for the candidate
    //    panel (RMC `public_candidates` view requires parse_status='success').
    //    MyJob /buscar-candidatos also filters with isCandidateEligible: needs
    //    both a display name and job_direction — WhatsApp flow has no parsed JD,
    //    so we set a neutral default direction (do not overwrite a non-empty
    //    job_direction on re-sync).
    const defaultJobDirection = 'Búsqueda de empleo';
    const existingJobDir = String(
      (existing as { job_direction?: string | null } | null)?.job_direction ?? '',
    ).trim();
    const jobDirection = existingJobDir || defaultJobDirection;

    const baseFields = {
      source_type: 'upload' as const,
      storage_bucket: RMC_RESUMES_BUCKET,
      storage_path: storagePath,
      original_filename: filename,
      name: input.candidateName || null,
      job_direction: jobDirection,
      whatsapp: phone,
      parse_status: 'success' as const,
      is_public: true,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error: updErr } = await rmc
        .from(RMC_RESUMES_TABLE)
        .update(baseFields)
        .eq('id', existing.id);
      if (updErr) {
        console.error('[wa-bot rmc] update error', updErr);
        return { ok: false, status: 'failed', error: `update_failed:${updErr.message}` };
      }
      return { ok: true, status: 'success', resumeId: existing.id };
    }

    const { data: inserted, error: insErr } = await rmc
      .from(RMC_RESUMES_TABLE)
      .insert(baseFields)
      .select('id')
      .single();

    if (insErr || !inserted?.id) {
      console.error('[wa-bot rmc] insert error', insErr);
      // Best-effort: remove the orphan storage object we just uploaded so we
      // never leave files in RMC without a row pointing at them.
      await rmc.storage.from(RMC_RESUMES_BUCKET).remove([storagePath]).catch(() => {});
      return { ok: false, status: 'failed', error: `insert_failed:${insErr?.message ?? 'no_id'}` };
    }

    return { ok: true, status: 'success', resumeId: inserted.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[wa-bot rmc] unexpected error', err);
    return { ok: false, status: 'failed', error: `exception:${msg}` };
  }
}
