/**
 * Publish one URL to Google Indexing API (no GOOGLE_INDEXING_ENABLED required).
 * Use for local smoke tests after wiring credentials.
 *
 *   GOOGLE_INDEXING_SERVICE_ACCOUNT_FILE=./key.json node scripts/google-indexing-one.mjs --url=https://myjob.com/empleo/foo-123/
 *
 * Or: GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' node ...
 */
import { loadServiceAccount, publishUrls } from './googleIndexing.mjs';

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.split('=');
    out[k.slice(2)] = v ?? argv[i + 1];
    if (!a.includes('=') && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1;
  }
  return out;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url || '').trim();
  if (!url.startsWith('https://')) {
    console.error('Usage: node scripts/google-indexing-one.mjs --url=https://myjob.com/...');
    console.error('Auth: set GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON or GOOGLE_INDEXING_SERVICE_ACCOUNT_FILE or GOOGLE_INDEXING_ACCESS_TOKEN');
    process.exit(1);
  }

  const type = args.type || process.env.GOOGLE_INDEXING_TYPE || 'URL_UPDATED';
  const serviceAccount = await loadServiceAccount();
  const accessToken = String(process.env.GOOGLE_INDEXING_ACCESS_TOKEN || '').trim();
  if (!serviceAccount && !accessToken) {
    console.error('[google-indexing-one] Missing credentials.');
    process.exit(1);
  }

  console.log(`[google-indexing-one] Publishing ${type}: ${url}`);
  await publishUrls({ serviceAccount, accessToken, urls: [url], type, concurrency: 1 });
  console.log('[google-indexing-one] Done.');
};

await main();
