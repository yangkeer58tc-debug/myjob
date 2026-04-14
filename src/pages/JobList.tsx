import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, ChevronDown, Clock, MapPin, Search, SlidersHorizontal, Wallet, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CATEGORY_OPTIONS,
  JOB_TYPE_OPTIONS,
  PAYMENT_FREQUENCY_OPTIONS,
  WORKPLACE_TYPE_OPTIONS,
  optionLabel,
} from '@/lib/jobOptions';
import { jobsTextSearchOrFilter } from '@/lib/jobSearchQuery';
import { displayCityForJob, mexicoCities } from '@/lib/mexicoLocation';
import { getSiteOrigin } from '@/lib/siteUrl';
import { cn } from '@/lib/utils';

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

type LucideIcon = ComponentType<{ className?: string }>;

function FilterField({
  id,
  label,
  hint,
  icon: Icon,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.07] text-primary shadow-sm"
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1 pt-0.5">
          <Label htmlFor={id} className="text-sm font-semibold leading-none text-foreground cursor-pointer">
            {label}
          </Label>
          {hint ? (
            <p id={`${id}-hint`} className="text-xs text-muted-foreground leading-snug">
              {hint}
            </p>
          ) : null}
        </div>
      </div>
      <div className="pl-0 sm:pl-[52px]">{children}</div>
    </div>
  );
}

const JobList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();

  const city = searchParams.get('ciudad') || '';
  const category = searchParams.get('categoria') || '';
  const qUrl = searchParams.get('q') || '';
  const salarioUrl = searchParams.get('salario') || '';
  const jobType = searchParams.get('tipo') || '';
  const workplace = searchParams.get('modalidad') || '';
  const payment = searchParams.get('pago') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [qDraft, setQDraft] = useState(qUrl);
  const [salarioDraft, setSalarioDraft] = useState(salarioUrl);

  useEffect(() => {
    setQDraft(qUrl);
  }, [qUrl]);

  useEffect(() => {
    setSalarioDraft(salarioUrl);
  }, [salarioUrl]);

  const cutoffIso = useMemo(() => new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), []);

  const { data: cities } = useQuery({
    queryKey: ['cities'],
    queryFn: async () => mexicoCities(),
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['jobs', city, category, page, qUrl, salarioUrl, jobType, workplace, payment, cutoffIso],
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

      if (category) query = query.eq('category', category);
      if (jobType) query = query.eq('job_type', jobType);
      if (workplace) query = query.eq('workplace_type', workplace);
      if (payment) query = query.eq('payment_frequency', payment);

      const salTrim = salarioUrl.trim();
      if (salTrim) {
        const esc = salTrim.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        query = query.ilike('salary_amount', `%${esc}%`);
      }

      const searchOr = jobsTextSearchOrFilter(qUrl);
      if (searchOr) query = query.or(searchOr);

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
  const pageTitle = city ? `${t('joblist.title')} ${city}` : t('joblist.allJobs');
  const pageItems = buildPagination(page, totalPages);

  const listHighlightQuery = [qUrl, salarioUrl].map((s) => String(s || '').trim()).filter(Boolean).join(' ');

  const jobsCanonicalUrl = useMemo(() => {
    const origin = getSiteOrigin();
    const q = searchParams.toString();
    return q ? `${origin}/empleos?${q}` : `${origin}/empleos`;
  }, [searchParams]);

  const hasActiveFilters = Boolean(
    qUrl || category || city || jobType || workplace || payment || salarioUrl.trim(),
  );

  const activeFilterCount = [
    qUrl.trim(),
    category,
    city,
    jobType,
    workplace,
    payment,
    salarioUrl.trim(),
  ].filter(Boolean).length;

  const activeChips = useMemo(() => {
    const chips: { param: string; text: string }[] = [];
    const qTrim = qUrl.trim();
    if (qTrim) {
      const short = qTrim.length > 42 ? `${qTrim.slice(0, 42)}…` : qTrim;
      chips.push({ param: 'q', text: `${t('joblist.chipSearch')}: “${short}”` });
    }
    if (category) {
      chips.push({
        param: 'categoria',
        text: `${t('joblist.labelCategory')}: ${optionLabel(category, CATEGORY_OPTIONS)}`,
      });
    }
    if (city) {
      chips.push({ param: 'ciudad', text: `${t('joblist.labelCity')}: ${city}` });
    }
    if (jobType) {
      chips.push({
        param: 'tipo',
        text: `${t('joblist.jobTypeFilter')}: ${optionLabel(jobType, JOB_TYPE_OPTIONS)}`,
      });
    }
    if (workplace) {
      chips.push({
        param: 'modalidad',
        text: `${t('joblist.workplaceFilter')}: ${optionLabel(workplace, WORKPLACE_TYPE_OPTIONS)}`,
      });
    }
    if (payment) {
      chips.push({
        param: 'pago',
        text: `${t('joblist.compensationPeriod')}: ${optionLabel(payment, PAYMENT_FREQUENCY_OPTIONS)}`,
      });
    }
    if (salarioUrl.trim()) {
      const s = salarioUrl.trim();
      const short = s.length > 28 ? `${s.slice(0, 28)}…` : s;
      chips.push({ param: 'salario', text: `${t('joblist.salaryChip')}: “${short}”` });
    }
    return chips;
  }, [qUrl, category, city, jobType, workplace, payment, salarioUrl, t]);

  const setParam = (key: string, value: string, clearValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === clearValue) next.delete(key);
    else next.set(key, value);
    next.set('page', '1');
    setSearchParams(next);
  };

  const removeFilter = (param: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete(param);
    if (param === 'q') setQDraft('');
    if (param === 'salario') setSalarioDraft('');
    next.set('page', '1');
    setSearchParams(next);
  };

  const applySearch = () => {
    const next = new URLSearchParams(searchParams);
    const trimmed = qDraft.trim();
    if (trimmed) next.set('q', trimmed);
    else next.delete('q');
    next.set('page', '1');
    setSearchParams(next);
  };

  const applySalario = () => {
    const next = new URLSearchParams(searchParams);
    const trimmed = salarioDraft.trim();
    if (trimmed) next.set('salario', trimmed);
    else next.delete('salario');
    next.set('page', '1');
    setSearchParams(next);
  };

  const clearAllFilters = () => {
    setQDraft('');
    setSalarioDraft('');
    setSearchParams(new URLSearchParams());
  };

  const handlePageChange = (p: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
    window.scrollTo(0, 0);
  };

  const selectTriggerClass =
    'h-11 w-full rounded-xl border-border/90 bg-muted/30 text-left font-medium shadow-sm transition hover:bg-muted/45 hover:border-border focus:ring-2 focus:ring-primary/20';

  const resultCountText =
    data !== undefined && !isLoading
      ? city
        ? t('joblist.resultsLineApprox', { n: data.count })
        : t('joblist.resultsLine', { n: data.count })
      : null;

  return (
    <PublicLayout>
      <Helmet>
        <title>Empleos en México | MyJob</title>
        <meta
          name="description"
          content="Encuentra vacantes en México y postúlate por WhatsApp. Busca por palabras clave y filtra por ciudad, categoría, modalidad y más."
        />
        <link rel="canonical" href={jobsCanonicalUrl} />
      </Helmet>

      <div className="container mx-auto px-4 py-8 sm:py-10">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{pageTitle}</h1>
          {resultCountText ? (
            <p
              className={cn(
                'text-sm font-semibold tabular-nums text-primary sm:text-right',
                isFetching && 'opacity-60',
              )}
            >
              {resultCountText}
            </p>
          ) : null}
        </div>

        <div className="mb-5 rounded-2xl border border-border/80 bg-card/90 p-4 shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.05] sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
            <div className="relative min-h-[3rem] flex-1 rounded-xl border border-border/90 bg-muted/15 transition focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/15">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="job-search-input"
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySearch();
                }}
                placeholder={t('joblist.searchPlaceholder')}
                className="h-12 border-0 bg-transparent pl-10 pr-3 text-base shadow-none focus-visible:ring-0 sm:h-[3rem]"
                aria-label={t('joblist.searchPlaceholder')}
              />
            </div>
            <Button type="button" className="h-12 shrink-0 rounded-xl px-8 font-bold shadow-sm sm:h-[3rem]" onClick={applySearch}>
              {t('joblist.search')}
            </Button>
          </div>
        </div>

        {activeChips.length > 0 ? (
          <div className="mb-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('joblist.activeFiltersTitle')}
              </p>
              <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-xs" onClick={clearAllFilters}>
                {t('joblist.clearFilters')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeChips.map((chip) => (
                <Badge
                  key={chip.param}
                  variant="secondary"
                  className="h-auto max-w-full gap-1.5 py-1.5 pl-2.5 pr-1 font-normal shadow-sm"
                >
                  <span className="truncate">{chip.text}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-1 text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
                    aria-label={`${t('joblist.removeFilter')}: ${chip.text}`}
                    onClick={() => removeFilter(chip.param)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="mb-10">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="mb-3 flex h-auto min-h-[3rem] w-full items-center justify-between gap-3 rounded-2xl border-dashed px-4 py-3 text-left font-semibold shadow-sm transition hover:bg-muted/40"
              aria-expanded={filtersOpen}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                  <SlidersHorizontal className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-foreground">{t('joblist.filtersPanelTitle')}</span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {filtersOpen ? t('joblist.filtersPanelOpenHint') : t('joblist.filtersPanelClosedHint')}
                  </span>
                </span>
                {activeFilterCount > 0 ? (
                  <Badge variant="default" className="shrink-0 rounded-full px-2.5">
                    {activeFilterCount}
                  </Badge>
                ) : null}
              </span>
              <ChevronDown
                className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200', filtersOpen && 'rotate-180')}
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200">
            <div className="rounded-2xl border border-border/70 bg-muted/10 p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                <FilterField id="filter-categoria" label={t('joblist.labelCategory')} icon={Briefcase}>
                  <Select value={category || '__all__'} onValueChange={(v) => setParam('categoria', v, '__all__')}>
                    <SelectTrigger id="filter-categoria" className={selectTriggerClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="rounded-xl">
                      <SelectItem value="__all__">{t('joblist.anyCategory')}</SelectItem>
                      {CATEGORY_OPTIONS.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                <FilterField id="filter-ciudad" label={t('joblist.labelCity')} icon={MapPin}>
                  <Select value={city || '__all__'} onValueChange={(v) => setParam('ciudad', v, '__all__')}>
                    <SelectTrigger id="filter-ciudad" className={selectTriggerClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-72 rounded-xl">
                      <SelectItem value="__all__">{t('joblist.anyCity')}</SelectItem>
                      {cities?.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                <FilterField id="filter-tipo" label={t('joblist.jobTypeFilter')} icon={Clock}>
                  <Select value={jobType || '__all__'} onValueChange={(v) => setParam('tipo', v, '__all__')}>
                    <SelectTrigger id="filter-tipo" className={selectTriggerClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="rounded-xl">
                      <SelectItem value="__all__">{t('joblist.anyJobType')}</SelectItem>
                      {JOB_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                <FilterField id="filter-modalidad" label={t('joblist.workplaceFilter')} icon={Building2}>
                  <Select value={workplace || '__all__'} onValueChange={(v) => setParam('modalidad', v, '__all__')}>
                    <SelectTrigger id="filter-modalidad" className={selectTriggerClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="rounded-xl">
                      <SelectItem value="__all__">{t('joblist.anyWorkplace')}</SelectItem>
                      {WORKPLACE_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                <div className="sm:col-span-2 xl:col-span-2">
                  <FilterField id="filter-compensacion" label={t('joblist.compensationLabel')} icon={Wallet}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <span className="text-xs font-medium text-muted-foreground">{t('joblist.compensationPeriod')}</span>
                        <Select value={payment || '__all__'} onValueChange={(v) => setParam('pago', v, '__all__')}>
                          <SelectTrigger id="filter-pago" className={selectTriggerClass}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" className="rounded-xl">
                            <SelectItem value="__all__">{t('joblist.anyPayment')}</SelectItem>
                            {PAYMENT_FREQUENCY_OPTIONS.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <span className="text-xs font-medium text-muted-foreground">{t('joblist.salaryMatchLabel')}</span>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                          <Input
                            id="filter-salario-input"
                            value={salarioDraft}
                            onChange={(e) => setSalarioDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') applySalario();
                            }}
                            placeholder={t('joblist.salaryPlaceholder')}
                            className="h-11 rounded-xl border-border/90 bg-background font-medium shadow-sm sm:flex-1"
                            aria-label={t('joblist.salaryMatchLabel')}
                          />
                          <Button type="button" variant="secondary" className="h-11 shrink-0 rounded-xl px-4 font-semibold" onClick={applySalario}>
                            {t('joblist.applySalaryBtn')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </FilterField>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

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
                <JobCard key={job.id} job={job} searchQuery={listHighlightQuery} />
              ))}
            </div>

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
