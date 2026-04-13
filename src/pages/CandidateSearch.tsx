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
import { getSiteOrigin } from '@/lib/siteUrl';

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

type ResumeRow = Record<string, unknown>;

const pickStr = (row: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
};

const parseYear = (value: unknown): number | null => {
  const s = String(value || '');
  const m = s.match(/(19|20)\d{2}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
};

const getEducationYears = (education: unknown[] | null | undefined): number | null => {
  const arr = Array.isArray(education) ? education : [];
  let sum = 0;
  for (const item of arr) {
    const obj = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const start = parseYear(obj.startDate ?? obj.start_date ?? obj.start_year);
    const end = parseYear(obj.endDate ?? obj.end_date ?? obj.end_year);
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

const mapResumeToCandidate = (r: ResumeRow): CandidateRow | null => {
  const id = String(r.id ?? '').trim();
  if (!id) return null;
  const first = pickStr(r, 'first_name', 'firstname', 'given_name');
  const last = pickStr(r, 'last_name', 'lastname', 'family_name');
  const fullName =
    pickStr(r, 'name', 'full_name', 'nombre', 'display_name', 'candidate_name') ||
    [first, last].filter(Boolean).join(' ') ||
    null;
  const jobDirection =
    pickStr(
      r,
      'job_direction',
      'job_title',
      'desired_position',
      'headline',
      'position',
      'cargo',
      'puesto',
      'role',
    ) || null;
  const summary =
    pickStr(
      r,
      'profile_summary',
      'summary',
      'bio',
      'about',
      'about_me',
      'description',
      'resumen',
    ) || null;
  const roleSlug = normalizeRoleSlug(jobDirection || '');
  const hasContact = typeof r.has_contact === 'boolean' ? r.has_contact : null;
  const educationYears = getEducationYears(Array.isArray(r.education) ? r.education : null);
  const workYears = typeof r.work_years === 'number' ? r.work_years : null;
  const country = pickStr(r, 'country', 'pais', 'país') || 'México';
  const city = pickStr(r, 'city', 'ciudad', 'location', 'ubicacion', 'ubicación');
  const created =
    (typeof r.updated_at === 'string' && r.updated_at.trim()) ||
    (typeof r.created_at === 'string' && r.created_at.trim()) ||
    new Date().toISOString();

  return {
    id,
    role_slug: roleSlug || null,
    first_name: first,
    last_name: last,
    full_name: fullName,
    job_title: jobDirection,
    country,
    city,
    summary,
    has_contact: hasContact,
    work_years: workYears,
    education_years: educationYears,
    created_at: created,
  };
};

/** List only rows we can render meaningfully (name + target role). Summary is optional on cards. */
const isCandidateEligible = (c: CandidateRow) => {
  const titleOk = Boolean(String(c.job_title || c.role_slug || '').trim());
  const nameOk = Boolean(String(c.full_name || c.first_name || '').trim());
  return titleOk && nameOk;
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
          const mapped = (Array.isArray(raw) ? raw : [])
            .map((r) => mapResumeToCandidate(r as ResumeRow))
            .filter((c): c is CandidateRow => c !== null)
            .filter(isCandidateEligible);
          return { candidates: mapped, count: count || 0 };
        };

        const colsWithEducation =
          'id,name,first_name,last_name,job_direction,work_years,country,city,education,profile_summary,created_at,updated_at';
        const colsWithoutEducation =
          'id,name,first_name,last_name,job_direction,work_years,country,city,profile_summary,created_at,updated_at';

        try {
          return await runQuery(colsWithEducation);
        } catch (err: unknown) {
          const msg = String((err as { message?: unknown })?.message || err || '').toLowerCase();
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
      const candidates = (Array.isArray(data) ? data : []).map((row) => {
        const r = row as Record<string, unknown>;
        const full = String(r.full_name || '').trim();
        const parts = full.split(/\s+/).filter(Boolean);
        const first = parts[0] || null;
        const last = parts.length >= 2 ? parts[parts.length - 1] : null;
        return {
          id: String(r.id),
          role_slug: typeof r.role_slug === 'string' ? r.role_slug : null,
          first_name: first,
          last_name: last,
          full_name: typeof r.full_name === 'string' ? r.full_name : null,
          job_title: (typeof r.headline === 'string' && r.headline) || (typeof r.role_slug === 'string' && r.role_slug) || null,
          country: null,
          city: typeof r.location === 'string' ? r.location : null,
          summary: typeof r.summary === 'string' ? r.summary : null,
          has_contact: false,
          work_years: null,
          education_years: null,
          created_at: String(r.created_at),
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
        <title>{roleTitle ? `Buscar candidatos: ${roleTitle} | MyJob` : 'Buscar candidatos | MyJob'}</title>
        <meta
          name="description"
          content="Encuentra candidatos. Busca por nombre, resumen, experiencia o puesto y habla con MyJob por WhatsApp para contratar."
        />
        <link
          rel="canonical"
          href={`${getSiteOrigin()}${role ? `/buscar-candidatos/${encodeURIComponent(role)}` : '/buscar-candidatos'}`}
        />
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
              placeholder="Buscar por nombre, resumen, experiencia..."
              className="rounded-xl w-full sm:w-[320px]"
            />
          </div>
        </div>

        {error ? (
          <div className="bg-card border border-border/50 rounded-3xl p-6">
            <p className="text-lg font-bold text-foreground mb-1">No se pudieron cargar los candidatos</p>
            <p className="text-sm text-muted-foreground break-words">
              {String((error as { message?: unknown })?.message || error)}
            </p>
            <div className="mt-4 text-sm text-muted-foreground space-y-1">
              <p>
                Origen: {usingExternalResumes ? 'Supabase (currículos externos)' : 'Tabla candidates de este proyecto'}
              </p>
              <p>Rol: {roleSlug}</p>
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
                  Siguiente
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted-foreground text-lg">No se encontraron candidatos.</p>
            <div className="mt-3 text-sm text-muted-foreground space-y-1">
              <p>
                Origen: {usingExternalResumes ? 'Supabase (currículos externos)' : 'Tabla candidates de este proyecto'}
              </p>
              <p>
                Reglas de publicación: cada fila debe tener nombre (o nombre completo) y puesto / dirección laboral de
                búsqueda para mostrarse. El resumen es opcional.
              </p>
              <p>
                Si ves este mensaje pero crees que hay datos: revisa que la vista pública exponga columnas reconocibles
                (por ejemplo job_direction, profile_summary, name) o equivalentes en español / inglés.
              </p>
              <p>
                Nota: la vista externa puede no incluir contacto; no exigimos contacto para listar el perfil.
              </p>
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
};

export default CandidateSearch;
