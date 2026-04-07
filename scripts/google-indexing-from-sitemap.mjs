import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

const extractLocs = (xml) => {
  const urls = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) {
    const url = m[1]?.trim();
    if (url) urls.push(url);
  }
  return urls;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const enabled = String(process.env.GOOGLE_INDEXING_ENABLED || '').trim() === '1';
  if (!enabled) return;

  const type = args.type || process.env.GOOGLE_INDEXING_TYPE || 'URL_UPDATED';
  const limit = args.limit ? Number(args.limit) : process.env.GOOGLE_INDEXING_LIMIT ? Number(process.env.GOOGLE_INDEXING_LIMIT) : undefined;
  const concurrency = args.concurrency
    ? Number(args.concurrency)
    : process.env.GOOGLE_INDEXING_CONCURRENCY
      ? Number(process.env.GOOGLE_INDEXING_CONCURRENCY)
      : 4;

  const sitemapPath = args.sitemap || process.env.GOOGLE_INDEXING_SITEMAP || path.resolve('public', 'sitemap.xml');
  const xml = await readFile(sitemapPath, 'utf8');
  let urls = extractLocs(xml);

  const site = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://myjob.com').replace(/\/+$/, '');
  urls = urls.filter((u) => u.startsWith(site));

  if (limit && Number.isFinite(limit) && limit > 0) urls = urls.slice(0, limit);
  if (urls.length === 0) return;

  const serviceAccount = await loadServiceAccount();
  if (!serviceAccount) throw new Error('GOOGLE_INDEXING_ENABLED=1 but service account is missing');

  await publishUrls({ serviceAccount, urls, type, concurrency });
};

await main();

