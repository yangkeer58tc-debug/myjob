import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SITE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://myjob.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const staticUrls = [
  { path: '/', changefreq: 'daily', priority: 1.0 },
  { path: '/empleos', changefreq: 'hourly', priority: 0.9 },
];

const toIsoDate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const fetchJobs = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const jobs = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/jobs`);
    url.searchParams.set('select', 'id,created_at');
    url.searchParams.set('is_active', 'eq.true');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sitemap job fetch failed: ${res.status} ${res.statusText} ${body}`.trim());
    }

    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    jobs.push(...page);
    if (page.length < pageSize) break;
  }

  return jobs;
};

const buildXml = (items) => {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];

  for (const item of items) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(item.loc)}</loc>`);
    if (item.lastmod) lines.push(`    <lastmod>${escapeXml(item.lastmod)}</lastmod>`);
    if (item.changefreq) lines.push(`    <changefreq>${escapeXml(item.changefreq)}</changefreq>`);
    if (typeof item.priority === 'number') lines.push(`    <priority>${item.priority.toFixed(1)}</priority>`);
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  lines.push('');
  return lines.join('\n');
};

const main = async () => {
  const urls = staticUrls.map((u) => ({
    loc: `${SITE_URL}${u.path}`,
    changefreq: u.changefreq,
    priority: u.priority,
  }));

  try {
    const jobs = await fetchJobs();
    for (const job of jobs) {
      urls.push({
        loc: `${SITE_URL}/empleo/${job.id}/`,
        lastmod: toIsoDate(job.created_at),
        changefreq: 'daily',
        priority: 0.8,
      });
    }
  } catch (e) {
    console.warn(String(e));
  }

  const xml = buildXml(urls);
  const outDir = path.resolve('public');
  const outFile = path.join(outDir, 'sitemap.xml');
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, xml, 'utf8');

  const robots = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
  await writeFile(path.join(outDir, 'robots.txt'), robots, 'utf8');
  console.log(`Sitemap written: ${outFile} (${urls.length} URLs)`);
};

await main();
