import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { Briefcase, MapPin, Clock, Building2, MessageCircle, ChevronRight, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWhatsAppRedirect } from '@/hooks/useWhatsAppRedirect';
import { formatRelativeTime } from '@/lib/timeUtils';
import { displaySalaryMXN, effectiveSalaryForJobPosting } from '@/lib/salaryUtils';
import { postalAddressPartsForLocality } from '@/lib/mxPostalAddress';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { Button } from '@/components/ui/button';
import {
  optionLabel,
  CATEGORY_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  EXPERIENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  WORKPLACE_TYPE_OPTIONS,
  occupationalExperienceRequirements,
} from '@/lib/jobOptions';
import { fixJobTextArtifacts } from '@/lib/jobTextUtils';
import { displayCityForJob, mexicoCityForJobId } from '@/lib/mexicoLocation';
import { getSiteOrigin, safeJsonLdStringify, toAbsoluteUrl, toIsoDatePosted } from '@/lib/siteUrl';

const DAYS_TO_EXPIRE = 60;

const maybeFixMojibake = (value: string) => {
  const s = value || '';
  const looksSuspicious = /[ÃÂ�]/.test(s) || /[\u0080-\u009F]/.test(s);
  if (!looksSuspicious) return fixJobTextArtifacts(s);

  const bytes: number[] = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code > 255) return fixJobTextArtifacts(s);
    bytes.push(code);
  }

  try {
    const fixed = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
    if (!fixed || fixed === s) return fixJobTextArtifacts(s);
    const normalized = fixJobTextArtifacts(fixed);
    if (/[À-ÿ]/.test(normalized) && !/[ÃÂ�]/.test(normalized)) return normalized;
    return fixJobTextArtifacts(s);
  } catch {
    return fixJobTextArtifacts(s);
  }
};

const stripDoubleAsterisks = (value: string) => (value || '').replaceAll('**', '');

const renderInline = (text: string) => {
  const safe = stripDoubleAsterisks(maybeFixMojibake(text));
  const parts = safe.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, idx) => {
    if (!/^https?:\/\//i.test(part)) return <span key={idx}>{part}</span>;
    return (
      <a
        key={idx}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground transition-colors"
      >
        {part}
      </a>
    );
  });
};

const preformatText = (value: string) => {
  let out = maybeFixMojibake(value || '').replace(/\r\n/g, '\n').trim();
  if (!out) return out;

  out = out.replaceAll('**', '');
  out = out.replace(/\s+\*\s+/g, '\n- ');
  out = out.replace(/(\s)(\d+[.)])\s+/g, '\n$2 ');
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
};

const ReadableText = ({ text, suppressHeadings }: { text: string; suppressHeadings?: string[] }) => {
  const normalized = preformatText(text);
  if (!normalized) return null;

  const lines = normalized.split('\n');
  const blocks: Array<
    | { type: 'heading'; text: string }
    | { type: 'list'; items: string[] }
    | { type: 'para'; lines: string[] }
  > = [];

  const isHeading = (line: string) => /^\s*[A-Za-zÀ-ÿ0-9][^:]{1,80}:\s*$/.test(line);
  const listMatch = (line: string) => /^\s*(?:[-•*]|\d+[.)])\s+/.exec(line);
  const suppress = new Set((suppressHeadings || []).map((h) => h.trim().toLowerCase()).filter(Boolean));

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] || '';
    const line = raw.trimEnd();
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (isHeading(line.trim())) {
      blocks.push({ type: 'heading', text: line.trim().replace(/:\s*$/, '') });
      i += 1;
      continue;
    }

    const lm = listMatch(line);
    if (lm) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = (lines[i] || '').trimEnd();
        const mm = listMatch(current);
        if (!mm) break;
        items.push(current.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const current = (lines[i] || '').trimEnd();
      if (!current.trim()) break;
      if (isHeading(current.trim())) break;
      if (listMatch(current)) break;
      paraLines.push(current);
      i += 1;
    }
    blocks.push({ type: 'para', lines: paraLines });
  }

  return (
    <div className="text-muted-foreground leading-relaxed prose prose-sm max-w-none">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          if (suppress.has(block.text.trim().toLowerCase())) return null;
          return (
            <h3 key={idx} className="text-base font-semibold text-foreground mt-6 mb-2">
              {block.text}
            </h3>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1 my-3">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} className="my-3">
            {block.lines.map((l, lineIdx) => (
              <span key={lineIdx}>
                {renderInline(l)}
                {lineIdx < block.lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
};

const JobDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { lang, t } = useLanguage();

  const { data: job, isLoading } = useQuery({
    queryKey: ['job', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const title = job?.title || '';
  const description = job?.description || '';
  const summary = job?.summary || '';
  const requirements = job?.requirements || '';
  const highlights = job?.highlights || null;

  const safeTitle = maybeFixMojibake(title);
  const safeCompany = maybeFixMojibake(job?.b_name || '');
  const safeLocation = job ? displayCityForJob(job) : mexicoCityForJobId(id);
  const siteOrigin = getSiteOrigin();
  const jobPageUrl = `${siteOrigin}/empleo/${job?.id ?? id}/`;
  const orgLogoUrl = job ? toAbsoluteUrl(job.b_logo_url, siteOrigin) : undefined;

  const { handleApply, QRModal } = useWhatsAppRedirect(safeTitle, safeCompany);

  // Related jobs (same city, active, excluding current)
  const { data: relatedJobs } = useQuery({
    queryKey: ['relatedJobs', job?.location, job?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('is_active', true)
        .eq('location', job!.location)
        .neq('id', job!.id)
        .limit(3);
      if (error) throw error;
      return data;
    },
    enabled: !!job,
  });

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="container mx-auto px-4 py-16 max-w-4xl">
          <div className="animate-pulse space-y-6">
            <div className="h-6 bg-secondary rounded w-1/3" />
            <div className="h-12 bg-secondary rounded w-2/3" />
            <div className="h-64 bg-secondary rounded-3xl" />
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (!job) {
    return (
      <PublicLayout>
        <div className="container mx-auto px-4 py-20 text-center">
          <p className="text-xl text-muted-foreground">{t('detail.notFound')}</p>
        </div>
      </PublicLayout>
    );
  }

  const now = Date.now();
  const createdAtMs = job.created_at ? Date.parse(String(job.created_at)) : NaN;
  const isExpired = Number.isFinite(createdAtMs) ? now - createdAtMs > DAYS_TO_EXPIRE * 24 * 60 * 60 * 1000 : false;
  const validThrough = new Date(now + DAYS_TO_EXPIRE * 24 * 60 * 60 * 1000).toISOString();

  const isActive = Boolean(job.is_active) && !isExpired;

  const jobDescriptionForSchema = [description || summary || '', requirements ? `\n\nRequisitos:\n${requirements}` : '']
    .filter(Boolean)
    .join('')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const datePostedIso = toIsoDatePosted(job.created_at);
  const occExpReq = occupationalExperienceRequirements(job.experience);
  const addressParts = postalAddressPartsForLocality(safeLocation);
  const effSalary = effectiveSalaryForJobPosting(job);

  const jsonLd = isActive
    ? {
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        title: safeTitle,
        url: jobPageUrl,
        identifier: {
          '@type': 'PropertyValue',
          name: 'MyJob',
          value: String(job.id),
        },
        description: jobDescriptionForSchema,
        ...(datePostedIso ? { datePosted: datePostedIso } : {}),
        validThrough,
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
          name: safeCompany,
          sameAs: siteOrigin,
          ...(orgLogoUrl ? { logo: orgLogoUrl } : {}),
        },
        jobLocation: {
          '@type': 'Place',
          address: {
            '@type': 'PostalAddress',
            addressLocality: addressParts.addressLocality,
            addressCountry: 'MX',
            ...(addressParts.addressRegion ? { addressRegion: addressParts.addressRegion } : {}),
            ...(addressParts.postalCode ? { postalCode: addressParts.postalCode } : {}),
            ...(addressParts.streetAddress ? { streetAddress: addressParts.streetAddress } : {}),
          },
        },
        ...(effSalary
          ? {
              baseSalary: {
                '@type': 'MonetaryAmount',
                currency: 'MXN',
                value: {
                  '@type': 'QuantitativeValue',
                  value: effSalary.value,
                  unitText:
                    effSalary.payment_frequency === 'mensal'
                      ? 'MONTH'
                      : effSalary.payment_frequency === 'quinzenal'
                        ? 'WEEK'
                        : effSalary.payment_frequency === 'hora'
                          ? 'HOUR'
                          : effSalary.payment_frequency === 'semanal'
                            ? 'WEEK'
                            : effSalary.payment_frequency === 'diario'
                              ? 'DAY'
                              : 'OTHER',
                },
              },
            }
          : {}),
        directApply: true,
        applicantLocationRequirements: {
          '@type': 'Country',
          name: 'MX',
        },
        jobLocationType: job.workplace_type === 'remoto' ? 'TELECOMMUTE' : undefined,
        ...(occExpReq ? { experienceRequirements: occExpReq } : {}),
        ...(job.education_level
          ? {
              educationRequirements: optionLabel(job.education_level, EDUCATION_LEVEL_OPTIONS) || String(job.education_level),
            }
          : {}),
        ...(job.industry ? { industry: String(job.industry) } : {}),
      }
    : null;

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteOrigin },
      { '@type': 'ListItem', position: 2, name: 'Vagas', item: `${siteOrigin}/empleos` },
      { '@type': 'ListItem', position: 3, name: safeTitle, item: jobPageUrl },
    ],
  };

  const pageTitle = `${safeTitle} em ${safeLocation || 'México'} | MyJob`;
  const pageDescription = (summary || description || '').slice(0, 160);
  const pageImage = orgLogoUrl || `${siteOrigin}/placeholder.svg`;
  const pageUrl = jobPageUrl;

  return (
    <PublicLayout>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <link rel="canonical" href={pageUrl} />
        {isExpired ? <meta name="robots" content="noindex,follow" /> : null}
        
        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:image" content={pageImage} />
        <meta property="og:url" content={pageUrl} />
        
        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={pageImage} />
        
        {jsonLd ? <script type="application/ld+json">{safeJsonLdStringify(jsonLd)}</script> : null}
        <script type="application/ld+json">{safeJsonLdStringify(breadcrumbLd)}</script>
      </Helmet>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Expired Banner */}
        {!job.is_active && (
          <div className="bg-warning/15 text-warning-foreground rounded-2xl p-4 mb-6 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <p className="font-medium text-sm">{t('detail.expired')}</p>
          </div>
        )}

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 flex-wrap">
          <Link to="/" className="hover:text-foreground transition-colors">{t('detail.breadHome')}</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link to="/empleos" className="hover:text-foreground transition-colors">{t('detail.breadJobs')}</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link to={`/empleos?ciudad=${encodeURIComponent(job.location)}`} className="hover:text-foreground transition-colors">{job.location}</Link>
          {job.category && (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-foreground">{optionLabel(job.category, CATEGORY_OPTIONS)}</span>
            </>
          )}
        </nav>

        {/* Header Module */}
        <div className="mb-8">
          <div className="flex items-start gap-4 mb-4">
            {job.b_logo_url ? (
              <img src={job.b_logo_url} alt={job.b_name} className="h-14 w-14 rounded-2xl object-cover flex-shrink-0" />
            ) : (
              <div className="h-14 w-14 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0">
                <Briefcase className="h-7 w-7 text-muted-foreground" />
              </div>
            )}
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-foreground leading-tight">{safeTitle}</h1>
              <p className="text-lg text-muted-foreground mt-1">{safeCompany}</p>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 text-sm bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full">
              <MapPin className="h-3.5 w-3.5" /> {safeLocation}
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full">
              <Clock className="h-3.5 w-3.5" /> {optionLabel(job.job_type, JOB_TYPE_OPTIONS)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full">
              <Building2 className="h-3.5 w-3.5" /> {optionLabel(job.workplace_type, WORKPLACE_TYPE_OPTIONS)}
            </span>
            {job.education_level && (
              <span className="inline-flex items-center gap-1.5 text-sm bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full">
                {optionLabel(job.education_level, EDUCATION_LEVEL_OPTIONS)}
              </span>
            )}
            {job.experience && (
              <span className="inline-flex items-center gap-1.5 text-sm bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full">
                {optionLabel(job.experience, EXPERIENCE_OPTIONS)}
              </span>
            )}
          </div>

          {/* Salary */}
          <p className="text-3xl font-black text-whatsapp mb-1">{displaySalaryMXN(job)}</p>
          <p className="text-sm text-muted-foreground">{formatRelativeTime(job.created_at, lang)}</p>
        </div>

        {/* CTA Button */}
        <Button
          variant={job.is_active ? 'whatsapp' : 'whatsappDisabled'}
          className="w-full rounded-2xl h-14 text-lg mb-10"
          onClick={job.is_active ? handleApply : undefined}
          disabled={!job.is_active}
        >
          <MessageCircle className="h-6 w-6" />
          {job.is_active ? t('wa.apply') : t('detail.closed')}
        </Button>

        {/* Body Details */}
        <div className="bg-card rounded-3xl p-8 shadow-sm border border-border/50 space-y-8">
          {summary && (
            <article>
              <h2 className="text-xl font-bold text-foreground mb-4">{t('detail.summary')}</h2>
              <ReadableText text={summary} suppressHeadings={['Resumo da Vaga']} />
            </article>
          )}

          {description && (
            <article>
              <h2 className="text-xl font-bold text-foreground mb-4">{t('detail.description')}</h2>
              <ReadableText text={description} suppressHeadings={['Descrição da Vaga', 'Resumo da Vaga']} />
            </article>
          )}

          {requirements && (
            <article>
              <h2 className="text-xl font-bold text-foreground mb-4">{t('detail.requirements')}</h2>
              <ReadableText text={requirements} suppressHeadings={['Requisitos', 'Requisitos e qualificações']} />
            </article>
          )}

        </div>

        {/* Related Jobs */}
        {!job.is_active && relatedJobs && relatedJobs.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">{t('detail.related')}</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {relatedJobs.map((rj) => (
                <JobCard key={rj.id} job={rj} />
              ))}
            </div>
          </div>
        )}
      </div>

      <QRModal />
    </PublicLayout>
  );
};

export default JobDetail;
