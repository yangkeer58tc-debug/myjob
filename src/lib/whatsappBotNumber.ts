/**
 * MSISDN selection for WhatsApp deep links (`wa.me`, `whatsapp://send`).
 *
 * - `LEGACY_CONTACT_NUMBER` — production "manual contact" line. Still used by
 *   Footer + candidate-side CTAs (CandidateCard) so recruiters can keep
 *   reaching applicants the way they do today.
 * - `BOT_LINE_NUMBER` — Infobip WABA line that drives the v10 state-machine
 *   recruitment bot (welcome → CV → opt-in → post-flow buttons).
 *
 * Rollout (2026-05-11): every job posting now routes "Postular / Contactar"
 * CTAs into the WhatsApp bot. Candidate-side CTAs are intentionally untouched.
 *
 * Overrides (any deployment):
 * - `VITE_WHATSAPP_BOT_NUMBER`     → forces a fixed number for non-job CTAs
 *                                    (legacy behavior, used by Footer etc.)
 * - `VITE_WHATSAPP_BOT_JOB_IDS`    → still honored as an additive override;
 *                                    no longer needed for normal rollout.
 */
const LEGACY_CONTACT_NUMBER = '5218132689146';
const BOT_LINE_NUMBER = '5218132689445';

const cleanDigits = (raw: unknown): string =>
  String(raw ?? '').trim().replace(/\D/g, '');

const envBotJobIds = (): Set<string> => {
  const raw = String(import.meta.env.VITE_WHATSAPP_BOT_JOB_IDS ?? '');
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(parts);
};

const isStagingMode = (): boolean => import.meta.env.MODE === 'staging';

/**
 * Default WhatsApp number for "generic" CTAs that are not tied to a posting
 * (Footer, candidate panel, etc.). Production keeps the legacy contact line
 * so the candidate-side flow stays exactly as today.
 */
export function getWhatsAppBotNumber(): string {
  const fromEnv = cleanDigits(import.meta.env.VITE_WHATSAPP_BOT_NUMBER);
  if (fromEnv.length >= 10) return fromEnv;
  return isStagingMode() ? BOT_LINE_NUMBER : LEGACY_CONTACT_NUMBER;
}

/**
 * True when this posting should send applicants into the WhatsApp bot.
 * Full rollout: any posting with an id goes to the bot. The env-based
 * additive override (`VITE_WHATSAPP_BOT_JOB_IDS`) is kept as a safety hatch
 * but is effectively a no-op now.
 */
export function isJobRoutedToWhatsAppBot(jobId?: string | null): boolean {
  const id = String(jobId ?? '').trim();
  if (!id) return false;
  if (isStagingMode()) return true;
  if (envBotJobIds().has(id)) return true;
  return true;
}

/**
 * Per-posting WhatsApp number. Use from "Contactar / Postular" CTAs that have
 * a job id in scope. Pass `undefined` to fall back to {@link getWhatsAppBotNumber}.
 */
export function getWhatsAppBotNumberForJob(jobId?: string | null): string {
  if (isJobRoutedToWhatsAppBot(jobId)) return BOT_LINE_NUMBER;
  return getWhatsAppBotNumber();
}
