import { Helmet } from 'react-helmet-async';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ITEMS_PER_PAGE = 8;

const JobList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const city = searchParams.get('ciudad') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Fetch unique cities
  const { data: cities } = useQuery({
    queryKey: ['cities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('location')
        .eq('is_active', true);
      if (error) throw error;
      const unique = [...new Set(data.map((j) => j.location))].sort();
      return unique;
    },
  });

  // Fetch jobs
  const { data, isLoading } = useQuery({
    queryKey: ['jobs', city, page],
    queryFn: async () => {
      let query = supabase
        .from('jobs')
        .select('*', { count: 'exact' })
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1);

      if (city) {
        query = query.eq('location', city);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { jobs: data, count: count || 0 };
    },
  });

  const totalPages = data ? Math.ceil(data.count / ITEMS_PER_PAGE) : 0;
  const pageTitle = city
    ? `${t('joblist.title')} ${city}`
    : t('joblist.allJobs');

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
        <title>Buscar Empleos y Vacantes en México | MyJob</title>
        <meta name="description" content="Explora miles de vacantes de trabajo en México. Filtra por ciudad, salario y categoría. Aplica fácil y rápido enviando un WhatsApp al reclutador." />
      </Helmet>
      
      <div className="container mx-auto px-4 py-10">
        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <h1 className="text-3xl font-extrabold text-foreground">{pageTitle}</h1>
          <Select value={city || '__all__'} onValueChange={handleCityChange}>
            <SelectTrigger className="w-[220px] rounded-xl">
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
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePageChange(p)}
                    className="rounded-xl w-10"
                  >
                    {p}
                  </Button>
                ))}
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
