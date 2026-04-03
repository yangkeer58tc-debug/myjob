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
  role_slug: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  country: string | null;
  city: string | null;
  summary: string | null;
  has_contact: boolean | null;
  work_years: number | null;
  education_years: number | null;
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
  education?: any[] | null;
  profile_summary: string | null;
  created_at: string;
  updated_at?: string | null;
  has_contact?: boolean | null;
};

const parseYear = (value: unknown): number | null => {
  const s = String(value || '');
  const m = s.match(/(19|20)\d{2}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
};

const getEducationYears = (education: any[] | null | undefined): number | null => {
  const arr = Array.isArray(education) ? education : [];
  let sum = 0;
  for (const item of arr) {
    const start = parseYear(item?.startDate ?? item?.start_date ?? item?.start_year);
    const end = parseYear(item?.endDate ?? item?.end_date ?? item?.end_year);
    if (!start && !end) continue;
    const s = start || end || 0;
    const e = end || start || 0;
    if (!s || !e) continue;
    const dur = Math.max(0, e - s) + 1;
    if (Number.isFinite(dur)) sum += dur;
  }
  return sum > 0 ? sum : null;
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
  const hasContact = typeof r.has_contact === 'boolean' ? r.has_contact : null;
  const educationYears = getEducationYears(r.education);

  return {
    id: r.id,
    role_slug: roleSlug || null,
    first_name: r.first_name || null,
    last_name: r.last_name || null,
    full_name: fullName,
    job_title: r.job_direction || null,
    country: r.country || 'Brasil',
    city: r.city || null,
    summary: r.profile_summary || null,
    has_contact: hasContact,
    work_years: typeof r.work_years === 'number' ? r.work_years : null,
    education_years: educationYears,
    created_at: r.updated_at || r.created_at,
  };
};

const isCandidateEligible = (c: CandidateRow) => {
  const titleOk = Boolean(String(c.job_title || c.role_slug || '').trim());
  const nameOk = Boolean(String(c.full_name || c.first_name || '').trim());
  const summaryOk = Boolean(String(c.summary || '').trim());
  return titleOk && nameOk && summaryOk;
};

const CandidateSearch = () => {
  const { role } = useParams<{ role?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ['candidates', role, q, page],
    queryFn: async () => {
      const roleSlug = role ? normalizeRoleSlug(role) : '';

      if (resumesSupabase) {
        const { tableOrView } = getResumesSource();
        const roleNeedle = roleSlug ? roleSlug.replaceAll('-', ' ') : '';

        const runQuery = async (selectCols: string) => {
          let query = resumesSupabase
            .from(tableOrView)
            .select(selectCols, { count: 'exact' })
            .order('updated_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1);

          if (roleNeedle) query = query.ilike('job_direction', `%${roleNeedle}%`);
          if (q) {
            const escaped = q.replaceAll(',', ' ');
            query = query.or(
              `name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,profile_summary.ilike.%${escaped}%,job_direction.ilike.%${escaped}%`,
            );
          }

          const { data: raw, error: resumesError, count } = await query;
          if (resumesError) throw resumesError;
          const mapped = ((raw as any[]) || []).map((r) => mapResumeToCandidate(r as ResumeRow)).filter(isCandidateEligible);
          return { candidates: mapped, count: count || 0 };
        };

        const colsWithEducation =
          'id,name,first_name,last_name,job_direction,work_years,country,city,education,profile_summary,created_at,updated_at';
        const colsWithoutEducation =
          'id,name,first_name,last_name,job_direction,work_years,country,city,profile_summary,created_at,updated_at';

        try {
          return await runQuery(colsWithEducation);
        } catch (err: any) {
          const msg = String(err?.message || err || '').toLowerCase();
          if (msg.includes('education') && (msg.includes('does not exist') || msg.includes('column'))) {
            return await runQuery(colsWithoutEducation);
          }
          throw err;
        }
      }

      let query = supabase
        .from('candidates')
        .select('*', { count: 'exact' })
        .eq('is_active', true)
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1);

      if (roleSlug) query = query.eq('role_slug', roleSlug);
      if (q) {
        query = query.or(
          `full_name.ilike.%${q}%,headline.ilike.%${q}%,summary.ilike.%${q}%,experience.ilike.%${q}%,role_slug.ilike.%${q}%`,
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const candidates = ((data as any[]) || []).map((row) => {
        const full = String(row.full_name || '').trim();
        const parts = full.split(/\s+/).filter(Boolean);
        const first = parts[0] || null;
        const last = parts.length >= 2 ? parts[parts.length - 1] : null;
        return {
          id: row.id,
          role_slug: row.role_slug || null,
          first_name: first,
          last_name: last,
          full_name: row.full_name || null,
          job_title: row.headline || row.role_slug || null,
          country: null,
          city: row.location || null,
          summary: row.summary || null,
          has_contact: false,
          work_years: null,
          education_years: null,
          created_at: row.created_at,
        } as CandidateRow;
      });
      return { candidates: candidates.filter(isCandidateEligible), count: count || 0 };
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

  const roleTitle = role ? fixJobTextArtifacts(role) : '';
  const roleSlug = role ? normalizeRoleSlug(role) : '';
  const usingExternalResumes = Boolean(resumesSupabase);

  return (
    <PublicLayout>
      <Helmet>
        <title>{roleTitle ? `Buscar candidatos ${roleTitle} | MyJob` : 'Buscar candidatos | MyJob'}</title>
        <meta
          name="description"
          content="Encontre candidatos. Busque por nome, resumo, experiência ou função e fale com o MyJob pelo WhatsApp para contratar."
        />
        <link rel="canonical" href={`${window.location.origin}${role ? `/buscar-candidatos/${role}` : '/buscar-candidatos'}`} />
      </Helmet>

      <div className="container mx-auto px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold text-foreground">
              {roleTitle ? `Buscar candidatos: ${roleTitle}` : 'Buscar candidatos'}
            </h1>
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
                <CandidateCard key={c.id} candidate={c} query={q} />
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
              <p>展示规则：必须有 title、name 和 profile_summary。</p>
              <p>注：当前外部 view 不包含联系方式字段，因此不强制校验联系方式。</p>
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
};

export default CandidateSearch;
