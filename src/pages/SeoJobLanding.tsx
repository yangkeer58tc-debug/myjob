import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { supabase } from '@/integrations/supabase/client';
import { getSiteOrigin, safeJsonLdStringify } from '@/lib/siteUrl';
import { displayCityForJob } from '@/lib/mexicoLocation';
import { jobMatchesJobsTextSearch, jobsTextSearchOrFilter, type JobTextSearchRow } from '@/lib/jobSearchQuery';
import { SEO_CITIES, SEO_ROLES, seoCityBySlug, seoRoleBySlug, seoCityPath, seoCityRolePath } from '@/lib/seoLanding';

const SeoJobLanding = () => {
  const { citySlug = '', roleSlug = '' } = useParams<{ citySlug: string; roleSlug?: string }>();
  const siteOrigin = useMemo(() => getSiteOrigin(), []);
  const city = seoCityBySlug(citySlug);
  const role = roleSlug ? seoRoleBySlug(roleSlug) : undefined;
  const canonicalPath = role ? seoCityRolePath(citySlug, role.slug) : seoCityPath(citySlug);
  const canonical = `${siteOrigin}${canonicalPath}`;

  const searchOr = role ? jobsTextSearchOrFilter(role.query) : '';

  const { data, isLoading } = useQuery({
    queryKey: ['seo-landing-jobs', citySlug, role?.slug || 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      let rows = Array.isArray(data) ? data : [];
      if (city) {
        rows = rows.filter((j) => displayCityForJob(j as { id: string; location?: string | null }) === city.name);
      }
      if (searchOr && role) {
        rows = rows.filter((j) => jobMatchesJobsTextSearch(j as JobTextSearchRow, role.query));
      }
      return rows.slice(0, 60);
    },
    enabled: Boolean(city),
  });

  if (!city) {
    return (
      <PublicLayout>
        <div className="container mx-auto px-4 py-16">
          <h1 className="text-2xl font-bold">Pagina no encontrada</h1>
        </div>
      </PublicLayout>
    );
  }

  const title = role
    ? `Empleos de ${role.label} en ${city.name} | MyJob`
    : `Empleos en ${city.name} | MyJob`;
  const description = role
    ? `Vacantes de ${role.label} en ${city.name}. Postulacion rapida por WhatsApp en MyJob.`
    : `Vacantes activas en ${city.name}. Encuentra empleo y postulate por WhatsApp en MyJob.`;

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${siteOrigin}/` },
      { '@type': 'ListItem', position: 2, name: 'Empleos', item: `${siteOrigin}/empleos` },
      { '@type': 'ListItem', position: 3, name: city.name, item: `${siteOrigin}${seoCityPath(city.slug)}` },
      ...(role ? [{ '@type': 'ListItem', position: 4, name: role.label, item: canonical }] : []),
    ],
  };

  return (
    <PublicLayout>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        <script type="application/ld+json">{safeJsonLdStringify(breadcrumbLd)}</script>
      </Helmet>

      <div className="container mx-auto px-4 py-10">
        <h1 className="text-3xl md:text-4xl font-black">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>

        <div className="mt-8 grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Ciudades</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {SEO_CITIES.map((c) => (
                <Link key={c.slug} to={seoCityPath(c.slug)} className="text-sm text-primary hover:underline">
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Puestos</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {SEO_ROLES.map((r) => (
                <Link key={r.slug} to={seoCityRolePath(city.slug, r.slug)} className="text-sm text-primary hover:underline">
                  {r.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10">
          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-card rounded-3xl h-72 animate-pulse border border-border/50" />
              ))}
            </div>
          ) : data && data.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {data.map((job) => (
                <JobCard key={job.id} job={job} searchQuery={role?.query || ''} />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No hay vacantes activas para este filtro en este momento.</p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
};

export default SeoJobLanding;
