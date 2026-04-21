/**
 * Build JobPosting + BreadcrumbList JSON-LD for static prerender (Googlebot sees markup without executing React).
 * Logic mirrors src/pages/JobDetail.tsx + jobPostingSchema / mxPostalAddress / jobOptions (subset).
 */

const DAYS_TO_EXPIRE = 180;

const escapeHtmlForJsonLd = (value) =>
  String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const safeJsonLdStringify = (value) =>
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');

export const toIsoDatePosted = (value) => {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
};

export const jobPostingDescriptionHtml = (plain) => {
  const trimmed = String(plain || '').trim();
  if (!trimmed) return '<p></p>';
  const blocks = trimmed
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '<p></p>';
  return blocks
    .map((block) => {
      const escaped = escapeHtmlForJsonLd(block).replace(/\n/g, '<br>\n');
      return `<p>${escaped}</p>`;
    })
    .join('\n');
};

export const normalizeEmployerSameAs = (raw) => {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.protocol === 'http:') u.protocol = 'https:';
    u.hash = '';
    const href = u.href.replace(/\/$/, '');
    return href || null;
  } catch {
    return null;
  }
};

const simplify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const EDUCATION_LEVEL_OPTIONS = [
  { id: 'sem-exigencia', label: 'Sin estudios requeridos' },
  { id: 'fundamental', label: 'Primaria' },
  { id: 'medio', label: 'Secundaria o preparatoria' },
  { id: 'tecnico', label: 'Carrera técnica' },
  { id: 'superior', label: 'Licenciatura' },
  { id: 'pos', label: 'Posgrado' },
];

const EXPERIENCE_OPTIONS = [
  { id: 'sem-experiencia', label: 'Sin experiencia' },
  { id: 'ate-1-ano', label: 'Menos de 1 año' },
  { id: '1-2-anos', label: '1–2 años' },
  { id: '3-5-anos', label: '3–5 años' },
  { id: 'mais-5-anos', label: 'Más de 5 años' },
];

const educationLegacy = (normalizedLabel) => {
  const m = {
    'sem exigencia': 'sem-exigencia',
    'sin requisitos': 'sem-exigencia',
    'sin estudios': 'sem-exigencia',
    'ensino fundamental': 'fundamental',
    primaria: 'fundamental',
    'educacion primaria': 'fundamental',
    'ensino medio': 'medio',
    secundaria: 'medio',
    preparatoria: 'medio',
    bachillerato: 'medio',
    'ensino tecnico': 'tecnico',
    'carrera tecnica': 'tecnico',
    'ensino superior': 'superior',
    licenciatura: 'superior',
    universidad: 'superior',
    'pos graduacao': 'pos',
    posgrado: 'pos',
    maestria: 'pos',
  };
  return m[normalizedLabel];
};

const experienceLegacy = (normalizedLabel) => {
  const m = {
    'sem experiencia': 'sem-experiencia',
    'sin experiencia': 'sem-experiencia',
    'ate 1 ano': 'ate-1-ano',
    'menos de 1 ano': 'ate-1-ano',
    'menos de 1 año': 'ate-1-ano',
    '1 2 anos': '1-2-anos',
    '1-2 anos': '1-2-anos',
    '1 2 años': '1-2-anos',
    '1-2 años': '1-2-anos',
    '3 5 anos': '3-5-anos',
    '3-5 anos': '3-5-anos',
    '3 5 años': '3-5-anos',
    '3-5 años': '3-5-anos',
    'mais de 5 anos': 'mais-5-anos',
    'mas de 5 anos': 'mais-5-anos',
    'más de 5 años': 'mais-5-anos',
  };
  return m[normalizedLabel];
};

const normalizeOptionId = (value, options, legacyFn) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const idMap = new Map(options.map((o) => [o.id, o]));
  if (idMap.has(raw)) return raw;
  const simplified = simplify(raw);
  for (const o of options) {
    if (simplify(o.label) === simplified) return o.id;
  }
  const leg = legacyFn(simplified);
  if (leg && idMap.has(leg)) return leg;
  return raw;
};

const EXPERIENCE_MONTHS_MAX = {
  'sem-experiencia': 0,
  'ate-1-ano': 12,
  '1-2-anos': 24,
  '3-5-anos': 60,
  'mais-5-anos': 120,
};

const occupationalExperienceRequirements = (value) => {
  const id = normalizeOptionId(value, EXPERIENCE_OPTIONS, experienceLegacy);
  const months = EXPERIENCE_MONTHS_MAX[id];
  if (months === undefined || months === 0) return undefined;
  return { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: months };
};

const EDUCATION_CREDENTIAL_CATEGORY = {
  fundamental: 'primary education',
  medio: 'high school',
  tecnico: 'technical certificate',
  superior: "bachelor's degree",
  pos: "master's degree",
};

const educationRequirementsStructured = (value) => {
  const id = normalizeOptionId(value, EDUCATION_LEVEL_OPTIONS, educationLegacy);
  if (!id || id === 'sem-exigencia') return undefined;
  const credentialCategory = EDUCATION_CREDENTIAL_CATEGORY[id];
  if (!credentialCategory) return undefined;
  return { '@type': 'EducationalOccupationalCredential', credentialCategory };
};

const simplifyLocality = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const LOCALITY_MAP = [
  {
    match: (s) => s.includes('ciudad de mexico') || s.includes('cdmx') || s === 'mexico',
    addressRegion: 'Ciudad de México',
    postalCode: '06000',
  },
  {
    match: (s) => s.includes('quer') && s.includes('taro'),
    addressRegion: 'Querétaro',
    postalCode: '76000',
  },
  { match: (s) => s.includes('guadalajara'), addressRegion: 'Jalisco', postalCode: '44100' },
  { match: (s) => s.includes('monterrey'), addressRegion: 'Nuevo León', postalCode: '64000' },
  { match: (s) => s.includes('puebla'), addressRegion: 'Puebla', postalCode: '72000' },
  { match: (s) => s.includes('veracruz'), addressRegion: 'Veracruz', postalCode: '91700' },
  { match: (s) => s.includes('tijuana'), addressRegion: 'Baja California', postalCode: '22000' },
  { match: (s) => s.includes('leon'), addressRegion: 'Guanajuato', postalCode: '37000' },
  { match: (s) => s.includes('merida'), addressRegion: 'Yucatán', postalCode: '97000' },
];

export const postalAddressPartsForLocality = (displayCity) => {
  const locality = String(displayCity || '').trim() || 'México';
  const s = simplifyLocality(locality);
  for (const row of LOCALITY_MAP) {
    if (row.match(s)) {
      return {
        addressLocality: locality,
        addressRegion: row.addressRegion,
        postalCode: row.postalCode,
      };
    }
  }
  return {
    addressLocality: locality,
    addressRegion: 'México',
    postalCode: '01000',
  };
};

const isPlaceholderSalaryText = (raw) => {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return true;
  return /a combinar|a negociar|negociable|combinar|sobre el monto|consultar/i.test(s);
};

const salaryNumberForSchema = (value) => {
  if (!value) return null;
  const raw = String(value).trim().replace(/\u00A0/g, ' ');
  if (!raw || /[A-Za-z]/.test(raw)) return null;
  const cleaned = raw
    .replace(/(brl|mxn|r\$|mx\$|\$)/gi, '')
    .replace(/[^\d.,-]/g, '')
    .trim();
  if (!/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    else normalized = cleaned.replace(/,/g, '');
  } else if (lastComma !== -1) normalized = cleaned.replace(/,/g, '.');
  else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1;
    if (decimals === 3 && cleaned.length > 4) normalized = cleaned.replace(/\./g, '');
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
};

const paymentFrequencyToSalaryUnitText = (paymentFrequency) => {
  const f = String(paymentFrequency || '').trim();
  if (f === 'mensal') return 'MONTH';
  if (f === 'quinzenal') return 'WEEK';
  if (f === 'semanal') return 'WEEK';
  if (f === 'hora') return 'HOUR';
  if (f === 'diario') return 'DAY';
  return 'OTHER';
};

const schemaBaseSalaryFromJob = (job) => {
  if (isPlaceholderSalaryText(job.salary_amount)) return null;
  const value = salaryNumberForSchema(job.salary_amount);
  if (value === null) return null;
  const unitText = paymentFrequencyToSalaryUnitText(String(job.payment_frequency ?? 'mensal'));
  return {
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'MXN',
      value: {
        '@type': 'QuantitativeValue',
        value,
        unitText,
      },
    },
  };
};

const toAbsoluteUrl = (href, origin) => {
  if (!href) return undefined;
  const s = String(href).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  const base = origin.replace(/\/+$/, '');
  return `${base}${s.startsWith('/') ? '' : '/'}${s}`;
};

const employmentTypeFromJob = (jobType) => {
  if (jobType === 'tempo-integral') return 'FULL_TIME';
  if (jobType === 'meio-periodo') return 'PART_TIME';
  if (jobType === 'estagio') return 'INTERN';
  return 'OTHER';
};

/**
 * @param {Record<string, unknown>} job - row from Supabase jobs
 * @param {{ siteOrigin: string; jobPageUrl: string; displayCity: string }} ctx
 */
export const buildJobPostingJsonLd = (job, ctx) => {
  const { siteOrigin, jobPageUrl, displayCity } = ctx;
  const now = Date.now();
  const createdAtMs = job.created_at ? Date.parse(String(job.created_at)) : NaN;
  const isExpired = Number.isFinite(createdAtMs) ? now - createdAtMs > DAYS_TO_EXPIRE * 24 * 60 * 60 * 1000 : false;
  const isActive = Boolean(job.is_active) && !isExpired;
  if (!isActive) return null;

  const description = String(job.description || '');
  const summary = String(job.summary || '');
  const requirements = String(job.requirements || '');
  const jobDescriptionPlain = [description || summary || '', requirements ? `\n\nRequisitos:\n${requirements}` : '']
    .filter(Boolean)
    .join('')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const title = String(job.title || '');
  const safeCompany = String(job.b_name || '').trim();
  const datePostedIso = toIsoDatePosted(job.created_at);
  const datePostedForSchema =
    datePostedIso ||
    (() => {
      const d = new Date(String(job.created_at || ''));
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    })();
  const validThrough = new Date(now + DAYS_TO_EXPIRE * 24 * 60 * 60 * 1000).toISOString();
  const occExpReq = occupationalExperienceRequirements(job.experience);
  const addressParts = postalAddressPartsForLocality(displayCity);
  const employerSameAs = normalizeEmployerSameAs(job.b_same_as);
  const schemaSalary = schemaBaseSalaryFromJob(job);
  const orgLogoUrl = toAbsoluteUrl(job.b_logo_url, siteOrigin);

  const street = String(job.street_address || '').trim();
  const schemaStreetAddress =
    (street ? street.slice(0, 500) : '') ||
    addressParts.streetAddress ||
    'Dirección no publicada por el empleador';
  const address = {
    '@type': 'PostalAddress',
    addressLocality: addressParts.addressLocality,
    addressCountry: 'MX',
    ...(addressParts.addressRegion ? { addressRegion: addressParts.addressRegion } : {}),
    ...(addressParts.postalCode ? { postalCode: addressParts.postalCode } : {}),
    ...(schemaStreetAddress ? { streetAddress: schemaStreetAddress } : {}),
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: title || 'Vacante',
    url: jobPageUrl,
    identifier: {
      '@type': 'PropertyValue',
      name: 'MyJob',
      value: String(job.id),
    },
    description: jobPostingDescriptionHtml(jobDescriptionPlain),
    datePosted: datePostedForSchema,
    validThrough,
    employmentType: employmentTypeFromJob(String(job.job_type || '')),
    hiringOrganization: {
      '@type': 'Organization',
      name: safeCompany || 'Empresa',
      sameAs: employerSameAs ?? siteOrigin,
      ...(orgLogoUrl ? { logo: orgLogoUrl } : {}),
    },
    jobLocation: {
      '@type': 'Place',
      address,
    },
    ...(schemaSalary ?? {}),
    directApply: true,
    applicantLocationRequirements: {
      '@type': 'Country',
      name: 'MX',
    },
    jobLocationType: job.workplace_type === 'remoto' ? 'TELECOMMUTE' : undefined,
    ...(occExpReq ? { experienceRequirements: occExpReq } : {}),
    ...(job.industry ? { industry: String(job.industry) } : {}),
  };
};

export const buildBreadcrumbJsonLd = (safeTitle, jobPageUrl, siteOrigin) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: siteOrigin },
    { '@type': 'ListItem', position: 2, name: 'Empleos', item: `${siteOrigin}/empleos` },
    { '@type': 'ListItem', position: 3, name: safeTitle, item: jobPageUrl },
  ],
});

export const injectPrerenderJobJsonLd = (html, jobPostingLd, breadcrumbLd, prerenderJobId) => {
  const idAttr =
    prerenderJobId != null && String(prerenderJobId).trim()
      ? `<meta name="myjob-prerender-job" content="${String(prerenderJobId).replace(/"/g, '&quot;')}" />`
      : '<meta name="myjob-prerender-job" content="" />';
  const parts = [idAttr];
  if (jobPostingLd) {
    parts.push(`<script type="application/ld+json">${safeJsonLdStringify(jobPostingLd)}</script>`);
  }
  if (breadcrumbLd) {
    parts.push(`<script type="application/ld+json">${safeJsonLdStringify(breadcrumbLd)}</script>`);
  }
  return html.replace(/<\/head>/i, `${parts.join('\n')}\n</head>`);
};
