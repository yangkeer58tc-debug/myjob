import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CATEGORY_OPTIONS } from '@/lib/jobOptions';
import { displayCityForJob, mexicoCities } from '@/lib/mexicoLocation';
import { getSiteOrigin } from '@/lib/siteUrl';

const ITEMS_PER_PAGE = 30;
const CITY_FILTER_MAX = 5000;

const buildPagination = (current: number, total: number) => {
  if (total <= 1) return [];
  const siblings = 2;

  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  for (let p = current - siblings; p <= current + siblings; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const out: Array<number | '...'> = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = sorted[i - 1];
    if (i > 0 && prev !== undefined && p - prev > 1) out.push('...');
    out.push(p);
  }
  return out;
};

const JobList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();
  const city = searchParams.get('ciudad') || '';
  const category = searchParams.get('categoria') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const cutoffIso = useMemo(() => new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), []);

  // Fetch unique cities
  const { data: cities } = useQuery({
    queryKey: ['cities'],
    queryFn: async () => {
      return mexicoCities();
    },
  });

  // Fetch jobs
  const { data, isLoading } = useQuery({
    queryKey: ['jobs', city, category, page],
    queryFn: async () => {
      const needsClientCityFilter = Boolean(city);
      let query = supabase
        .from('jobs')
        .select('*', { count: needsClientCityFilter ? undefined : 'exact' })
        .eq('is_active', true)
        .gte('created_at', cutoffIso)
        .order('created_at', { ascending: false })
        .range(
          needsClientCityFilter ? 0 : (page - 1) * ITEMS_PER_PAGE,
          needsClientCityFilter ? CITY_FILTER_MAX - 1 : page * ITEMS_PER_PAGE - 1,
        );

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!needsClientCityFilter) return { jobs: rows, count: count || 0 };

      const filtered = rows.filter((j) => displayCityForJob(j as { id: string; location?: string | null }) === city);
      const total = filtered.length;
      const start = (page - 1) * ITEMS_PER_PAGE;
      return { jobs: filtered.slice(start, start + ITEMS_PER_PAGE), count: total };
    },
  });

  const totalPages = data ? Math.ceil(data.count / ITEMS_PER_PAGE) : 0;
  const pageTitle = city
    ? `${t('joblist.title')} ${city}`
    : t('joblist.allJobs');
  const pageItems = buildPagination(page, totalPages);

  const jobsCanonicalUrl = useMemo(() => {
    const origin = getSiteOrigin();
    const q = searchParams.toString();
    return q ? `${origin}/empleos?${q}` : `${origin}/empleos`;
  }, [searchParams]);

  const handleCategoryChange = (value: string) => {
    if (value === '__all__') {
      searchParams.delete('categoria');
    } else {
      searchParams.set('categoria', value);
    }
    searchParams.set('page', '1');
    setSearchParams(searchParams);
  };

  const handleCityChange = (value: string) => {
    if (value === '__all__') {
      searchParams.delete('ciudad');
    } else {
      searchParams.set('ciudad', value);
    }
    searchParams.set('page', '1');
    setSearchParams(searchParams);
  };

  const handlePageChange = (p: number) => {
    searchParams.set('page', String(p));
    setSearchParams(searchParams);
    window.scrollTo(0, 0);
  };

  return (
    <PublicLayout>
      <Helmet>
        <title>Vagas de Emprego no México | MyJob</title>
        <meta name="description" content="Encontre vagas no México e candidate-se pelo WhatsApp. Filtre por cidade e categoria e fale direto com as empresas." />
        <link rel="canonical" href={jobsCanonicalUrl} />
      </Helmet>
      
      <div className="container mx-auto px-4 py-10">
        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <h1 className="text-3xl font-extrabold text-foreground">{pageTitle}</h1>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Select value={category || '__all__'} onValueChange={handleCategoryChange}>
              <SelectTrigger className="w-full sm:w-[260px] rounded-xl">
                <SelectValue placeholder="Filtrar por categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as categorias</SelectItem>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={city || '__all__'} onValueChange={handleCityChange}>
              <SelectTrigger className="w-full sm:w-[220px] rounded-xl">
                <SelectValue placeholder={t('joblist.filterCity')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('joblist.allCities')}</SelectItem>
                {cities?.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Job Feed */}
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card rounded-3xl h-72 animate-pulse border border-border/50" />
            ))}
          </div>
        ) : data && data.jobs.length > 0 ? (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {data.jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-12">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                  className="rounded-xl"
                >
                  {t('pagination.prev')}
                </Button>
                {pageItems.map((item, idx) =>
                  item === '...' ? (
                    <Button key={`e-${idx}`} variant="outline" size="sm" disabled className="rounded-xl w-10">
                      …
                    </Button>
                  ) : (
                    <Button
                      key={item}
                      variant={item === page ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handlePageChange(item)}
                      className="rounded-xl w-10"
                    >
                      {item}
                    </Button>
                  ),
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === totalPages}
                  className="rounded-xl"
                >
                  {t('pagination.next')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted-foreground text-lg">{t('joblist.noJobs')}</p>
          </div>
        )}
      </div>
    </PublicLayout>
  );
};

export default JobList;
