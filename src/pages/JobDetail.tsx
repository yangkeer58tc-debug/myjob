import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { Briefcase, MapPin, Clock, Building2, MessageCircle, ChevronRight, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWhatsAppRedirect } from '@/hooks/useWhatsAppRedirect';
import { formatRelativeTime } from '@/lib/timeUtils';
import { formatSalaryBRL, salaryNumberForSchema } from '@/lib/salaryUtils';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { Button } from '@/components/ui/button';
import { optionLabel, CATEGORY_OPTIONS, EDUCATION_LEVEL_OPTIONS, EXPERIENCE_OPTIONS, JOB_TYPE_OPTIONS, WORKPLACE_TYPE_OPTIONS, PAYMENT_FREQUENCY_OPTIONS } from '@/lib/jobOptions';

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
  const salaryValue = salaryNumberForSchema(job?.salary_amount);

  const { handleApply, QRModal } = useWhatsAppRedirect(title, job?.b_name || '');

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

  const jsonLd = job.is_active
    ? {
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        title: title,
        description: `
          <p>${description || summary || ''}</p>
          ${requirements ? `<h3>Requisitos</h3><p>${requirements}</p>` : ''}
          ${highlights ? `<h3>Beneficios</h3><ul>${highlights.map((h: string) => `<li>${h}</li>`).join('')}</ul>` : ''}
        `,
        datePosted: job.created_at,
        validThrough: new Date(new Date(job.created_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Assume valid for 30 days
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
          name: job.b_name,
          sameAs: 'https://myjob.com',
          ...(job.b_logo_url && { logo: job.b_logo_url }),
        },
        jobLocation: {
          '@type': 'Place',
          address: {
            '@type': 'PostalAddress',
            addressLocality: job.location,
            addressCountry: 'BR',
          },
        },
        ...(salaryValue !== null
          ? {
              baseSalary: {
                '@type': 'MonetaryAmount',
                currency: 'BRL',
                value: {
                  '@type': 'QuantitativeValue',
                  value: salaryValue,
                  unitText:
                    job.payment_frequency === 'mensal'
                      ? 'MONTH'
                      : job.payment_frequency === 'quinzenal'
                        ? 'WEEK'
                        : job.payment_frequency === 'hora'
                          ? 'HOUR'
                          : 'OTHER',
                },
              },
            }
          : {}),
        directApply: true,
        applicantLocationRequirements: {
          '@type': 'Country',
          name: 'BR'
        },
        jobLocationType: job.workplace_type === 'remoto' ? 'TELECOMMUTE' : undefined,
      }
    : null;

  return (
    <PublicLayout>
      <Helmet>
        <title>{title} en {job.location} | MyJob</title>
        <meta name="description" content={summary || `${title} en ${job.b_name} - ${job.location}`} />
        {jsonLd && (
          <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        )}
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
              <h1 className="text-3xl md:text-4xl font-extrabold text-foreground leading-tight">{title}</h1>
              <p className="text-lg text-muted-foreground mt-1">{job.b_name}</p>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 text-sm bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full">
              <MapPin className="h-3.5 w-3.5" /> {job.location}
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
          <p className="text-3xl font-black text-whatsapp mb-1">
            {formatSalaryBRL(job.salary_amount)}{' '}
            <span className="text-base font-medium text-muted-foreground">{optionLabel(job.payment_frequency, PAYMENT_FREQUENCY_OPTIONS)}</span>
          </p>
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
              <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed prose prose-sm max-w-none">
                {summary}
              </div>
            </article>
          )}

          {description && (
            <article>
              <h2 className="text-xl font-bold text-foreground mb-4">{t('detail.description')}</h2>
              <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed prose prose-sm max-w-none">
                {description}
              </div>
            </article>
          )}

          {requirements && (
            <article>
              <h2 className="text-xl font-bold text-foreground mb-4">{t('detail.requirements')}</h2>
              <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed prose prose-sm max-w-none">
                {requirements}
              </div>
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
