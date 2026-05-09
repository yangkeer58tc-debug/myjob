import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SITE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://myjob.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const staticUrls = [
  { path: '/', changefreq: 'daily', priority: 1.0 },
  { path: '/empleos', changefreq: 'hourly', priority: 0.9 },
  { path: '/empleos?q=chofer', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?q=ayudante%20general', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?q=seguridad', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?q=cajero', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?q=atencion%20al%20cliente', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?q=almacenista', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?ciudad=Ciudad%20de%20M%C3%A9xico', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?ciudad=Guadalajara', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?ciudad=Monterrey', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?ciudad=Puebla', changefreq: 'daily', priority: 0.8 },
  { path: '/empleos?ciudad=Tijuana', changefreq: 'daily', priority: 0.8 },
];

const SEO_CITY_SLUGS = ['ciudad-de-mexico', 'guadalajara', 'monterrey', 'puebla', 'tijuana'];
const SEO_ROLE_SLUGS = ['chofer', 'ayudante-general', 'seguridad', 'cajero', 'atencion-al-cliente', 'almacenista'];

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


const slugify = (value) => {
  const s = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'empleo';
};

const jobPath = (job) => {
  const head = (job.slug && String(job.slug).trim()) ? slugify(job.slug) : slugify(job.title);
  return `/empleo/${head}-${job.id}/`;
};

/**
 * Paginate like @supabase/supabase-js .range(from, to): PostgREST uses the Range header.
 * Query-string limit/offset is easy to misconfigure across gateways; Range matches the live app.
 */
const fetchJobs = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const jobs = [];
  const pageSize = 1000;
  let reportedTotal = null;

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/jobs`);
    url.searchParams.set('select', 'id,created_at,title,slug');
    url.searchParams.set('is_active', 'eq.true');
    /** Tie-breaker id keeps order stable across pages (required for correct offset paging). */
    url.searchParams.set('order', 'created_at.desc,id.desc');

    const rangeEnd = offset + pageSize - 1;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${offset}-${rangeEnd}`,
        Prefer: 'count=exact',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sitemap job fetch failed: ${res.status} ${res.statusText} ${body}`.trim());
    }

    const cr = res.headers.get('content-range');
    if (cr) {
      const m = cr.match(/\/(\d+|\*)\s*$/);
      if (m && m[1] !== '*') reportedTotal = Number(m[1]);
    }

    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    jobs.push(...page);
    if (page.length < pageSize) break;
  }

  if (reportedTotal != null && jobs.length !== reportedTotal) {
    console.warn(
      `Sitemap: jobs fetched (${jobs.length}) != PostgREST Content-Range total (${reportedTotal}). Check Range paging or build env (same Supabase as production).`,
    );
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
  for (const city of SEO_CITY_SLUGS) {
    urls.push({
      loc: `${SITE_URL}/empleos-en/${city}`,
      changefreq: 'daily',
      priority: 0.85,
    });
    for (const role of SEO_ROLE_SLUGS) {
      urls.push({
        loc: `${SITE_URL}/empleos-en/${city}/${role}`,
        changefreq: 'daily',
        priority: 0.8,
      });
    }
  }

  try {
    const jobs = await fetchJobs();
    for (const job of jobs) {
      urls.push({
        loc: `${SITE_URL}${jobPath(job)}`,
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
