import { Helmet } from 'react-helmet-async';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resumesSupabase, getResumesSource } from '@/integrations/resumes/client';
import PublicLayout from '@/components/PublicLayout';
import CandidateCard from '@/components/CandidateCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fixJobTextArtifacts } from '@/lib/jobTextUtils';

const ITEMS_PER_PAGE = 12;

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

type CandidateRow = {
  id: string;
  role_slug: string;
  full_name: string | null;
  age: number | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  experience: string | null;
  employment_type: string | null;
  salary_expectation: string | null;
  availability: string | null;
  created_at: string;
};

type ResumeRow = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_direction: string | null;
  work_years: number | null;
  country: string | null;
  city: string | null;
  profile_summary: string | null;
  profile_summary_language: string | null;
  intro_language: string | null;
  created_at: string;
  updated_at?: string | null;
  is_public?: boolean | null;
  parse_status?: string | null;
};

const normalizeRoleSlug = (value: string) =>
  fixJobTextArtifacts(String(value || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

const mapResumeToCandidate = (r: ResumeRow): CandidateRow => {
  const roleSlug = normalizeRoleSlug(r.job_direction || '');
  const fullName = r.name || [r.first_name, r.last_name].filter(Boolean).join(' ') || null;
  const location = r.city || r.country || null;
  const headline = r.job_direction ? `Profissional de ${r.job_direction}` : null;
  const workYears = typeof r.work_years === 'number' && Number.isFinite(r.work_years) ? r.work_years : null;
  const experience = workYears !== null ? `Experiência: ${workYears} anos` : null;

  return {
    id: r.id,
    role_slug: roleSlug || 'driver',
    full_name: fullName,
    age: null,
    location,
    headline,
    summary: r.profile_summary || null,
    experience,
    employment_type: null,
    salary_expectation: null,
    availability: null,
    created_at: r.updated_at || r.created_at,
  };
};

const CandidateSearch = () => {
  const { role = 'driver' } = useParams<{ role: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ['candidates', role, q, page],
    queryFn: async () => {
      const roleSlug = normalizeRoleSlug(role);

      if (resumesSupabase) {
        const { tableOrView } = getResumesSource();

        const roleNeedle = roleSlug.replaceAll('-', ' ');

        const selectCols = 'id,name,first_name,last_name,job_direction,work_years,country,city,profile_summary,created_at,updated_at';

        let query = resumesSupabase
          .from(tableOrView)
          .select(selectCols, { count: 'exact' })
          .order('updated_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .ilike('job_direction', `%${roleNeedle}%`)
          .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1);

        if (q) {
          const escaped = q.replaceAll(',', ' ');
          query = query.or(
            `name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,profile_summary.ilike.%${escaped}%`,
          );
        }

        const { data: raw, error: resumesError, count } = await query;
        if (resumesError) throw resumesError;
        const mapped = ((raw as any[]) || []).map((r) => mapResumeToCandidate(r as ResumeRow));
        return { candidates: mapped, count: count || 0 };
      }

      let query = supabase
        .from('candidates')
        .select('*', { count: 'exact' })
        .eq('is_active', true)
        .eq('is_public', true)
        .eq('role_slug', roleSlug)
        .order('created_at', { ascending: false })
        .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1);

      if (q) query = query.or(`full_name.ilike.%${q}%,headline.ilike.%${q}%,summary.ilike.%${q}%,experience.ilike.%${q}%`);

      const { data, error, count } = await query;
      if (error) throw error;
      return { candidates: (data as CandidateRow[]) || [], count: count || 0 };
    },
  });

  const totalPages = data ? Math.ceil(data.count / ITEMS_PER_PAGE) : 0;
  const pages = buildPagination(page, totalPages);

  const handleSearchChange = (value: string) => {
    if (!value) searchParams.delete('q');
    else searchParams.set('q', value);
    searchParams.set('page', '1');
    setSearchParams(searchParams);
  };

  const handlePageChange = (p: number) => {
    searchParams.set('page', String(p));
    setSearchParams(searchParams);
    window.scrollTo(0, 0);
  };

  const roleTitle = role === 'driver' ? 'Driver' : fixJobTextArtifacts(role);
  const roleSlug = normalizeRoleSlug(role);
  const usingExternalResumes = Boolean(resumesSupabase);

  return (
    <PublicLayout>
      <Helmet>
        <title>Buscar candidatos {roleTitle} | MyJob</title>
        <meta
          name="description"
          content={`Encontre candidatos para ${roleTitle}. Busque por nome, resumo e experiência e fale com o MyJob pelo WhatsApp para contratar.`}
        />
        <link rel="canonical" href={`${window.location.origin}/buscar-candidatos/${role}`} />
      </Helmet>

      <div className="container mx-auto px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold text-foreground">Buscar candidatos: {roleTitle}</h1>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Input
              value={q}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar por nome, resumo, experiência..."
              className="rounded-xl w-full sm:w-[320px]"
            />
          </div>
        </div>

        {error ? (
          <div className="bg-card border border-border/50 rounded-3xl p-6">
            <p className="text-lg font-bold text-foreground mb-1">Falha ao carregar candidatos</p>
            <p className="text-sm text-muted-foreground break-words">{String((error as any)?.message || error)}</p>
            <div className="mt-4 text-sm text-muted-foreground space-y-1">
              <p>源：{usingExternalResumes ? '简历库 Supabase' : '本项目 candidates 表'}</p>
              <p>role：{roleSlug}</p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="grid lg:grid-cols-2 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card rounded-3xl h-56 animate-pulse border border-border/50" />
            ))}
          </div>
        ) : data && data.candidates.length > 0 ? (
          <>
            <div className="grid lg:grid-cols-2 gap-6">
              {data.candidates.map((c) => (
                <CandidateCard key={c.id} candidate={c} />
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
                  Anterior
                </Button>
                {pages.map((item, idx) =>
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
                  Próxima
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted-foreground text-lg">Nenhum candidato encontrado.</p>
            <div className="mt-3 text-sm text-muted-foreground space-y-1">
              <p>源：{usingExternalResumes ? '简历库 Supabase' : '本项目 candidates 表'}</p>
              <p>可能原因：简历库还没创建 public_candidates view/开放读取权限，或还没有匹配 {roleTitle} 的简历。</p>
              <p>备用方案：去 /admin → Candidatos 导入 CSV 先跑通。</p>
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
};

export default CandidateSearch;
