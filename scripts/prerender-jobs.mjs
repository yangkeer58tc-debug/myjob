import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBreadcrumbJsonLd, buildJobPostingJsonLd, injectPrerenderJobJsonLd } from './jobPostingPrerenderLd.mjs';

const SITE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://myjob.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const stripScripts = (value) => String(value || '').replace(/<script[^>]*>[\s\S]*?(?:<\/script>|$)/gi, '');
const stripTags = (value) => String(value || '').replace(/<[^>]+>/g, '');
const normalizeWhitespace = (value) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const textForSchema = (value) => normalizeWhitespace(stripTags(stripScripts(value)));

/** Crawlers need visible body text; empty #root often triggers Soft 404. Replaced when React mounts. */
const injectVisibleRootStub = (html, jobTitle, plainBody) => {
  const h1 = escapeHtml(jobTitle || 'Vacante');
  const body = escapeHtml(String(plainBody || '').slice(0, 4500)).replace(/\n/g, '<br />\n');
  const block = `<div id="root"><main id="job-prerender-stub" style="max-width:44rem;margin:1rem auto;padding:1.25rem;font-family:system-ui,sans-serif;line-height:1.55;color:#0f172a"><h1 style="font-size:1.375rem;font-weight:700;margin:0 0 1rem;line-height:1.25">${h1}</h1><div style="font-size:0.95rem">${body}</div><p style="margin-top:1.25rem;font-size:0.875rem;color:#64748b">MyJob — Empleos en México.</p></main></div>`;
  let out = html.replace(/<div\s+id=["']root["'][^>]*>\s*<\/div>/i, block);
  if (!out.includes('job-prerender-stub')) {
    out = html.replace(/<div\s+id=["']root["'][^>]*>[\s\S]*?<\/div>/i, block);
  }
  return out;
};

/** Ensure schema / OG image URLs are absolute (Google JobPosting prefers absolute logo URLs). */
const absoluteUrl = (href) => {
  if (!href) return undefined;
  const s = String(href).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return `${SITE_URL}${s.startsWith('/') ? '' : '/'}${s}`;
};

const DAYS_TO_EXPIRE = 60;
const cutoffIso = new Date(Date.now() - DAYS_TO_EXPIRE * 24 * 60 * 60 * 1000).toISOString();

const MEXICO_CITIES = [
  'Ciudad de México',
  'Guadalajara',
  'Monterrey',
  'Puebla',
  'Tijuana',
  'León',
  'Querétaro',
  'Mérida',
];

const hashString = (value) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
};

const mexicoCityForJobId = (jobId) => {
  const raw = String(jobId ?? '').trim();
  const seed = raw || '0';
  const idx = hashString(seed) % MEXICO_CITIES.length;
  return MEXICO_CITIES[idx] || 'Ciudad de México';
};

const displayCityForJob = (job) => {
  const loc = String(job.location ?? '').trim();
  if (loc) return loc;
  return mexicoCityForJobId(job.id);
};

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

const fetchJobs = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const jobs = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/jobs`);
    url.searchParams.set(
      'select',
      [
        'id',
        'title',
        'slug',
        'summary',
        'description',
        'created_at',
        'is_active',
        'b_logo_url',
        'location',
        'b_name',
        'b_same_as',
        'requirements',
        'job_type',
        'workplace_type',
        'experience',
        'education_level',
        'industry',
        'street_address',
        'salary_amount',
        'payment_frequency',
        'category',
      ].join(','),
    );
    url.searchParams.set('is_active', 'eq.true');
    url.searchParams.set('created_at', `gte.${cutoffIso}`);
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
      throw new Error(`Prerender job fetch failed: ${res.status} ${res.statusText} ${body}`.trim());
    }

    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    jobs.push(...page);
    if (page.length < pageSize) break;
  }

  return jobs;
};

const applyHead = ({ html, title, description, canonical, ogImage }) => {
  let out = html;

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  if (!/<title>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><title>${escapeHtml(title)}</title>`);
  }

  // Update description
  if (/<meta[^>]+name=["']description["'][^>]*>/i.test(out)) {
    out = out.replace(
      /<meta[^>]+name=["']description["'][^>]*>/i,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    );
  } else {
    out = out.replace(/<head([^>]*)>/i, `<head$1><meta name="description" content="${escapeHtml(description)}" />`);
  }

  // Update canonical
  if (/<link[^>]+rel=["']canonical["'][^>]*>/i.test(out)) {
    out = out.replace(
      /<link[^>]+rel=["']canonical["'][^>]*>/i,
      `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    );
  } else {
    out = out.replace(/<head([^>]*)>/i, `<head$1><link rel="canonical" href="${escapeHtml(canonical)}" />`);
  }

  // Update Open Graph tags
  const ogTags = `
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta name="twitter:url" content="${escapeHtml(canonical)}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
  `;

  // Remove existing OG and Twitter tags if present, to avoid duplicates
  out = out.replace(/<meta[^>]+property=["']og:[^>]+>/gi, '');
  out = out.replace(/<meta[^>]+name=["']twitter:[^>]+>/gi, '');
  
  out = out.replace(/<\/head>/i, `${ogTags}</head>`);

  return out;
};

const main = async () => {
  const distDir = path.resolve('dist');
  const templatePath = path.join(distDir, 'index.html');
  const template = await readFile(templatePath, 'utf8');

  let jobs = [];
  try {
    jobs = await fetchJobs();
  } catch {
    return;
  }

  for (const job of jobs) {
    const jobUrl = `${SITE_URL}${jobPath(job)}`;
    const city = displayCityForJob(job);
    const title = `${job.title || 'Vaga'} em ${city} | MyJob`;
    const bodyPlain = textForSchema(
      job.summary || job.description || `Vacante en ${city}. Postúlate por WhatsApp en MyJob.`,
    );
    const desc = normalizeWhitespace(bodyPlain).slice(0, 170);
    const ogImage = absoluteUrl(job.b_logo_url) || `${SITE_URL}/placeholder.svg`;
    let html = applyHead({ html: template, title, description: desc, canonical: jobUrl, ogImage });
    const jobPostingLd = buildJobPostingJsonLd(job, {
      siteOrigin: SITE_URL,
      jobPageUrl: jobUrl,
      displayCity: city,
    });
    const breadcrumbLd = buildBreadcrumbJsonLd(job.title || 'Vacante', jobUrl, SITE_URL);
    html = injectPrerenderJobJsonLd(html, jobPostingLd, breadcrumbLd, job.id);
    html = injectVisibleRootStub(html, job.title || 'Vacante', bodyPlain);

    const pathSeg = jobPath(job).replace(/^\/+|\/+$/g, '').split('/');
    const outDir = path.join(distDir, ...pathSeg);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  }
};

await main();
