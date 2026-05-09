/**
 * MSISDN selection for WhatsApp deep links (`wa.me`, `whatsapp://send`).
 *
 * - `LEGACY_CONTACT_NUMBER` — production "manual contact" line; what most
 *   listings on the live site point at today.
 * - `BOT_LINE_NUMBER` — Infobip WABA line that drives the new state-machine
 *   recruitment bot (welcome → name → CV → opt-in).
 *
 * Production rollout strategy: only postings whose id is in
 * `WHATSAPP_BOT_JOB_IDS` should funnel into the bot. Everything else keeps
 * the legacy contact number so we can validate the bot on a single posting
 * before flipping it on for the whole catalog.
 *
 * Overrides (any deployment):
 * - `VITE_WHATSAPP_BOT_NUMBER`     → forces a fixed number for non-bot CTAs
 *                                    (legacy behavior, used by Footer etc.)
 * - `VITE_WHATSAPP_BOT_JOB_IDS`    → comma-separated job ids that should be
 *                                    routed to the bot, in addition to the
 *                                    hard-coded list below.
 */
const LEGACY_CONTACT_NUMBER = '5218132689146';
const BOT_LINE_NUMBER = '5218132689445';

/** Postings explicitly routed to the new bot in production. */
const WHATSAPP_BOT_JOB_IDS: ReadonlyArray<string> = [
  '82489719', // /empleo/nutriologa-82489719/ — initial production pilot
];

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
 * (Footer, candidate panel, etc.). Staging routes everything to the bot line
 * so QA can exercise the flow end to end without touching production.
 */
export function getWhatsAppBotNumber(): string {
  const fromEnv = cleanDigits(import.meta.env.VITE_WHATSAPP_BOT_NUMBER);
  if (fromEnv.length >= 10) return fromEnv;
  return isStagingMode() ? BOT_LINE_NUMBER : LEGACY_CONTACT_NUMBER;
}

/** True when this posting should send applicants into the WhatsApp bot. */
export function isJobRoutedToWhatsAppBot(jobId?: string | null): boolean {
  const id = String(jobId ?? '').trim();
  if (!id) return false;
  if (isStagingMode()) return true;
  if (WHATSAPP_BOT_JOB_IDS.includes(id)) return true;
  return envBotJobIds().has(id);
}

/**
 * Per-posting WhatsApp number. Use from "Contactar / Postular" CTAs that have
 * a job id in scope. Pass `undefined` to fall back to {@link getWhatsAppBotNumber}.
 */
export function getWhatsAppBotNumberForJob(jobId?: string | null): string {
  if (isJobRoutedToWhatsAppBot(jobId)) return BOT_LINE_NUMBER;
  return getWhatsAppBotNumber();
}
