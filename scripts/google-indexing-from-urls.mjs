import { readFile } from 'node:fs/promises';
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
  const enabled = String(process.env.GOOGLE_INDEXING_ENABLED || '').trim() === '1';
  if (!enabled) return;

  const args = parseArgs(process.argv.slice(2));
  const type = args.type || process.env.GOOGLE_INDEXING_TYPE || 'URL_UPDATED';
  const concurrency = args.concurrency
    ? Number(args.concurrency)
    : process.env.GOOGLE_INDEXING_CONCURRENCY
      ? Number(process.env.GOOGLE_INDEXING_CONCURRENCY)
      : 4;

  const filePath = args.file || process.env.GOOGLE_INDEXING_URLS_FILE;
  if (!filePath) throw new Error('Missing --file or GOOGLE_INDEXING_URLS_FILE');

  const content = await readFile(filePath, 'utf8');
  const urls = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((u) => u.startsWith('http'));

  if (urls.length === 0) return;

  const serviceAccount = await loadServiceAccount();
  if (!serviceAccount) throw new Error('GOOGLE_INDEXING_ENABLED=1 but service account is missing');

  await publishUrls({ serviceAccount, urls, type, concurrency });
};

await main();

