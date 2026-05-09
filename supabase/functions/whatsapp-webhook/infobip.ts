// Thin wrapper around the Infobip WhatsApp API for the MVP bot.
// Docs: https://www.infobip.com/docs/api/channels/whatsapp
// Build marker (used to verify Supabase Edge runtime is serving the latest
// version): WA_BOT_BUILD_2026_05_07_v4

const cleanBaseUrl = (url: string): string => {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
};

export type InfobipConfig = {
  baseUrl: string;
  apiKey: string;
  sender: string;
};

// Sender must match the WhatsApp-enabled MSISDN Infobip registered for THIS API key.
// Strip spaces/plus/dashes only — do NOT "fix" Mexican numbers here: truncating to 12 digits
// (52 + 10) often breaks `from` and surfaces as REJECTED_SOURCE / Invalid Source address.
export const normalizeSenderMsisdn = (sender: string): string =>
  sender.trim().replace(/\D/g, '');

export const buildConfig = (): InfobipConfig => {
  const baseUrl = cleanBaseUrl(Deno.env.get('INFOBIP_BASE_URL') ?? '');
  const apiKey = (Deno.env.get('INFOBIP_API_KEY') ?? '').trim();
  const sender = normalizeSenderMsisdn(Deno.env.get('INFOBIP_SENDER') ?? '');
  return { baseUrl, apiKey, sender };
};

const authHeader = (apiKey: string) => `App ${apiKey}`;

// Normalize a destination MSISDN before calling Infobip's WhatsApp API.
//
// Mexican mobile numbers are quirky on WhatsApp: every cellular WA account is
// registered with the legacy "1" mobile prefix (e.g. 5215512345678), but
// Infobip's inbound webhook delivers `from` WITHOUT the "1" (e.g.
// 525512345678). If we echo the 12-digit form back as `to`, Meta rejects with
// REJECTED_DESTINATION_NOT_REGISTERED. We re-insert the legacy "1" so
// outbound matches the WA-side wa_id.
//
// Numbers from any other country are passed through unchanged.
export const normalizeMsisdnForWhatsApp = (msisdn: string): string => {
  const digits = msisdn.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('52')) {
    return `521${digits.slice(2)}`;
  }
  return digits;
};

export async function sendText(
  config: InfobipConfig,
  to: string,
  text: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${config.baseUrl}/whatsapp/1/message/text`;
  const normalizedTo = normalizeMsisdnForWhatsApp(to);
  console.log('[wa-bot v4] sendText fromSuffix=%s toRaw=%s toNorm=%s', config.sender.slice(-4), to, normalizedTo);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(config.apiKey),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: config.sender,
      to: normalizedTo,
      content: { text },
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

export async function downloadMedia(
  config: InfobipConfig,
  mediaUrl: string,
): Promise<{ ok: boolean; status: number; bytes?: Uint8Array; contentType?: string; error?: string }> {
  // Infobip media URLs are temporary signed URLs. They generally do not require auth,
  // but we send Authorization defensively in case the endpoint is on the Infobip API host.
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: authHeader(config.apiKey),
      Accept: '*/*',
    },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text() };
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { ok: true, status: res.status, bytes, contentType };
}
