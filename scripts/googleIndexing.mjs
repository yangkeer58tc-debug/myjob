import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/indexing';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const INDEXING_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

const parseJsonEnv = (raw) => {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(decoded);
};

export const loadServiceAccount = async () => {
  const fromEnv = parseJsonEnv(process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON);
  if (fromEnv) return fromEnv;

  const filePath = process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT_FILE;
  if (filePath) {
    const json = await readFile(filePath, 'utf8');
    return JSON.parse(json);
  }

  return null;
};

const normalizePrivateKey = (value) => String(value || '').replaceAll('\\n', '\n');

const buildJwt = ({ clientEmail, privateKey, scope, audience }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope,
    aud: audience,
    iat: now,
    exp: now + 60 * 60,
  };

  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replaceAll('=', '')
      .replaceAll('+', '-')
      .replaceAll('/', '_');

  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(normalizePrivateKey(privateKey))
    .toString('base64')
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_');

  return `${unsigned}.${signature}`;
};

export const getAccessToken = async (serviceAccount, scope = DEFAULT_SCOPE) => {
  const jwt = buildJwt({
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
    scope,
    audience: TOKEN_URL,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Indexing token failed: ${res.status} ${res.statusText} ${text}`.trim());
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error('Indexing token missing access_token');
  return json.access_token;
};

const verbose = () => String(process.env.GOOGLE_INDEXING_VERBOSE || '').trim() === '1';

export const publishUrlNotification = async ({ accessToken, url, type }) => {
  const res = await fetch(INDEXING_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url, type }),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Indexing publish failed: ${res.status} ${res.statusText} ${text}`.trim());
  const json = JSON.parse(text);
  if (verbose()) {
    const snippet = text.length > 280 ? `${text.slice(0, 280)}…` : text;
    console.log(`[google-indexing] OK ${url} → ${snippet}`);
  }
  return json;
};

export const publishUrls = async ({ serviceAccount, accessToken, urls, type, scope = DEFAULT_SCOPE, concurrency = 4 }) => {
  const token = accessToken || String(process.env.GOOGLE_INDEXING_ACCESS_TOKEN || '').trim();
  const resolvedToken = token || (serviceAccount ? await getAccessToken(serviceAccount, scope) : null);
  if (!resolvedToken) throw new Error('Missing Indexing API auth: set GOOGLE_INDEXING_ACCESS_TOKEN or provide serviceAccount');

  const queue = [...urls];
  const results = [];
  const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!url) break;
      results.push(await publishUrlNotification({ accessToken: resolvedToken, url, type }));
    }
  });
  await Promise.all(workers);
  console.log(`[google-indexing] Finished: ${results.length} URL notification(s) published (type=${type}).`);
  return results;
};
