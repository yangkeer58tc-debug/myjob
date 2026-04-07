import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SITE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://myjob.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const toIsoDate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const escapeJsonLd = (value) =>
  String(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

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
        'summary',
        'description',
        'requirements',
        'highlights',
        'created_at',
        'is_active',
        'location',
        'category',
        'salary_amount',
        'payment_frequency',
        'job_type',
        'workplace_type',
        'education_level',
        'experience',
        'b_name',
        'b_logo_url',
      ].join(','),
    );
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
      throw new Error(`Prerender job fetch failed: ${res.status} ${res.statusText} ${body}`.trim());
    }

    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    jobs.push(...page);
    if (page.length < pageSize) break;
  }

  return jobs;
};

const applyHead = ({ html, title, description, canonical, jsonLd, breadcrumbLd, ogImage }) => {
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
    <meta property="og:type" content="article" />
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

  const ld = `
<script type="application/ld+json">${escapeJsonLd(JSON.stringify(jsonLd))}</script>
<script type="application/ld+json">${escapeJsonLd(JSON.stringify(breadcrumbLd))}</script>
`;
  if (/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/i.test(out)) {
    // If we have an existing ld+json, append our new ones
    out = out.replace(/(<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>)/i, `$1${ld}`);
  } else {
    out = out.replace(/<\/head>/i, `${ld}</head>`);
  }

  return out;
};

const buildJobPostingJsonLd = (job) => {
  const descriptionParts = [
    textForSchema(job.summary || job.description || ''),
    job.requirements ? `\n\nRequisitos:\n${textForSchema(job.requirements)}` : '',
  ]
    .filter(Boolean)
    .join('');

  const base = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title || '',
    description: descriptionParts,
    datePosted: toIsoDate(job.created_at) || undefined,
    validThrough: toIsoDate(new Date(new Date(job.created_at).getTime() + 30 * 24 * 60 * 60 * 1000)) || undefined,
    employmentType:
      job.job_type === 'tempo-integral'
        ? 'FULL_TIME'
        : job.job_type === 'meio-periodo'
          ? 'PART_TIME'
          : job.job_type === 'estagio'
            ? 'INTERN'
            : 'OTHER',
    hiringOrganization: {
      '@type': 'Organization',
      name: job.b_name || 'MyJob',
      sameAs: SITE_URL,
      ...(job.b_logo_url ? { logo: job.b_logo_url } : {}),
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: job.location || '',
        addressCountry: 'BR',
      },
    },
    directApply: true,
  };

  const numericSalary = typeof job.salary_amount === 'string' ? Number(job.salary_amount.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')) : NaN;
  if (Number.isFinite(numericSalary) && numericSalary > 0) {
    base.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'BRL',
      value: {
        '@type': 'QuantitativeValue',
        value: numericSalary,
        unitText:
          job.payment_frequency === 'mensal'
            ? 'MONTH'
            : job.payment_frequency === 'quinzenal'
              ? 'WEEK'
              : job.payment_frequency === 'hora'
                ? 'HOUR'
                : 'OTHER',
      },
    };
  }

  return base;
};

const buildBreadcrumbLd = (job) => {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Vagas',
        item: `${SITE_URL}/empleos`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: job.title || 'Vaga',
        item: `${SITE_URL}/empleo/${job.id}/`,
      },
    ],
  };
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
    const jobUrl = `${SITE_URL}/empleo/${job.id}/`;
    const title = `${job.title || 'Vaga'} em ${job.location || 'Brasil'} | MyJob`;
    const desc = normalizeWhitespace(textForSchema(job.summary || job.description || `Vaga em ${job.location || 'Brasil'}`)).slice(0, 170);
    const jsonLd = buildJobPostingJsonLd(job);
    const breadcrumbLd = buildBreadcrumbLd(job);
    const ogImage = job.b_logo_url || `${SITE_URL}/placeholder.svg`;
    const html = applyHead({ html: template, title, description: desc, canonical: jobUrl, jsonLd, breadcrumbLd, ogImage });

    const outDir = path.join(distDir, 'empleo', String(job.id));
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  }
};

await main();
