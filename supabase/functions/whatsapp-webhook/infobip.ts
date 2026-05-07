// Thin wrapper around the Infobip WhatsApp API for the MVP bot.
// Docs: https://www.infobip.com/docs/api/channels/whatsapp

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

export const buildConfig = (): InfobipConfig => {
  const baseUrl = cleanBaseUrl(Deno.env.get('INFOBIP_BASE_URL') ?? '');
  const apiKey = (Deno.env.get('INFOBIP_API_KEY') ?? '').trim();
  const sender = (Deno.env.get('INFOBIP_SENDER') ?? '').trim();
  return { baseUrl, apiKey, sender };
};

const authHeader = (apiKey: string) => `App ${apiKey}`;

export async function sendText(
  config: InfobipConfig,
  to: string,
  text: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${config.baseUrl}/whatsapp/1/message/text`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(config.apiKey),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: config.sender,
      to,
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
