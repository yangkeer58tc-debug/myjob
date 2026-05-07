/**
 * MSISDN for WhatsApp deep links (`wa.me`, `whatsapp://send`), digits only.
 * Staging uses the Infobip WABA line; production keeps the legacy number until you switch.
 * Override anytime with `VITE_WHATSAPP_BOT_NUMBER` (Cloudflare / `.env.staging`).
 */
const PRODUCTION_WHATSAPP_BOT_NUMBER = '5218132689146';
const STAGING_WHATSAPP_BOT_NUMBER = '5218132689445';

export function getWhatsAppBotNumber(): string {
  const fromEnv = String(import.meta.env.VITE_WHATSAPP_BOT_NUMBER ?? '').trim().replace(/\D/g, '');
  if (fromEnv.length >= 10) return fromEnv;
  return import.meta.env.MODE === 'staging' ? STAGING_WHATSAPP_BOT_NUMBER : PRODUCTION_WHATSAPP_BOT_NUMBER;
}
