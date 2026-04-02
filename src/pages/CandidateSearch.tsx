import { Helmet } from 'react-helmet-async';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import PublicLayout from '@/components/PublicLayout';
import CandidateCard from '@/components/CandidateCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

const CandidateSearch = () => {
  const { role = 'driver' } = useParams<{ role: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const city = searchParams.get('cidade') || '';
  const q = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const { data: cities } = useQuery({
    queryKey: ['candidateCities', role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('location')
        .eq('is_active', true)
        .eq('is_public', true)
        .eq('role_slug', role);
      if (error) throw error;
      const unique = [...new Set((data || []).map((r: any) => r.location).filter(Boolean))].sort();
      return unique as string[];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['candidates', role, city, q, page],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('*', { count: 'exact' })
        .eq('is_active', true)
        .eq('is_public', true)
        .eq('role_slug', role)
        .order('created_at', { ascending: false })
        .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1);

      if (city) query = query.eq('location', city);
      if (q) query = query.or(`full_name.ilike.%${q}%,headline.ilike.%${q}%,summary.ilike.%${q}%,experience.ilike.%${q}%`);

      const { data, error, count } = await query;
      if (error) throw error;
      return { candidates: (data as CandidateRow[]) || [], count: count || 0 };
    },
  });

  const totalPages = data ? Math.ceil(data.count / ITEMS_PER_PAGE) : 0;
  const pages = buildPagination(page, totalPages);

  const handleCityChange = (value: string) => {
    if (value === '__all__') searchParams.delete('cidade');
    else searchParams.set('cidade', value);
    searchParams.set('page', '1');
    setSearchParams(searchParams);
  };

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

  return (
    <PublicLayout>
      <Helmet>
        <title>Buscar candidatos {roleTitle} | MyJob</title>
        <meta
          name="description"
          content={`Encontre candidatos para ${roleTitle}. Filtre por cidade e fale com o MyJob pelo WhatsApp para contratar.`}
        />
        <link rel="canonical" href={`${window.location.origin}/buscar-candidatos/${role}`} />
      </Helmet>

      <div className="container mx-auto px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold text-foreground">Buscar candidatos</h1>
            <p className="text-muted-foreground">
              Perfil: <span className="font-semibold text-foreground">{roleTitle}</span>
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Input
              value={q}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar por nome, resumo, experiência..."
              className="rounded-xl w-full sm:w-[320px]"
            />
            <Select value={city || '__all__'} onValueChange={handleCityChange}>
              <SelectTrigger className="w-full sm:w-[220px] rounded-xl">
                <SelectValue placeholder="Filtrar por cidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as cidades</SelectItem>
                {cities?.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
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
          </div>
        )}
      </div>
    </PublicLayout>
  );
};

export default CandidateSearch;

