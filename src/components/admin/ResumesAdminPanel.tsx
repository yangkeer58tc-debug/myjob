import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResumesSource, resumesSupabase } from '@/integrations/resumes/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type ResumeRow = Record<string, unknown>;

const PAGE_SIZE = 20;

const asText = (value: unknown): string => String(value ?? '').trim();

const buildDisplayName = (row: ResumeRow): string => {
  const name = asText(row.name);
  if (name) return name;
  const first = asText(row.first_name);
  const last = asText(row.last_name);
  return [first, last].filter(Boolean).join(' ') || '-';
};

const ResumesAdminPanel = () => {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const source = useMemo(() => getResumesSource(), []);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, isLoading, error } = useQuery({
    queryKey: ['adminExternalResumesV2', source.tableOrView, query, page],
    queryFn: async () => {
      if (!resumesSupabase) return { rows: [], count: 0 };

      let req = resumesSupabase
        .from(source.tableOrView)
        .select('id,name,first_name,last_name,job_direction,profile_summary,updated_at,created_at', {
          count: 'exact',
        })
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to);

      const needle = query.trim();
      if (needle) {
        const escaped = needle.replaceAll(',', ' ');
        req = req.or(
          `name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,job_direction.ilike.%${escaped}%,profile_summary.ilike.%${escaped}%`,
        );
      }

      const { data: rows, error: reqErr, count } = await req;
      if (reqErr) throw reqErr;
      return { rows: rows || [], count: count || 0 };
    },
    enabled: true,
  });

  const rows = data?.rows || [];
  const count = data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const selected = rows.find((r) => asText(r.id) === selectedId) || null;

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl shadow-sm p-4 text-sm text-muted-foreground space-y-1">
        <p>RMC 并入阶段 1.5：支持搜索、分页与基础详情（仍为只读）。</p>
        <p>数据来源：{resumesSupabase ? `外部 Supabase 视图 ${source.tableOrView}` : '未配置 VITE_RESUMES_*'}</p>
        {!resumesSupabase ? (
          <p className="text-destructive">
            请在最后统一配置阶段补上 `VITE_RESUMES_SUPABASE_URL` 与 `VITE_RESUMES_SUPABASE_ANON_KEY`。
          </p>
        ) : null}
      </div>

      <div className="bg-card rounded-2xl shadow-sm p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre, job direction o resumen..."
            className="rounded-xl w-full sm:w-[420px]"
          />
          <div className="text-sm text-muted-foreground">
            Total: {count} · Página {page}/{totalPages}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Nombre</th>
                <th className="text-left px-4 py-3 font-medium">Job Direction</th>
                <th className="text-left px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-destructive">
                    {String((error as { message?: unknown })?.message || error)}
                  </td>
                </tr>
              )}
              {!isLoading &&
                !error &&
                rows.map((r) => {
                  const id = asText(r.id);
                  const updated = asText(r.updated_at) || asText(r.created_at);
                  return (
                    <tr
                      key={id}
                      className={`border-t border-border cursor-pointer ${selectedId === id ? 'bg-secondary/40' : ''}`}
                      onClick={() => setSelectedId(id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{id}</td>
                      <td className="px-4 py-3 font-medium">{buildDisplayName(r)}</td>
                      <td className="px-4 py-3">{asText(r.job_direction) || '-'}</td>
                      <td className="px-4 py-3">{updated ? new Date(updated).toLocaleString() : '-'}</td>
                    </tr>
                  );
                })}
              {!isLoading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-muted-foreground">
                    No hay resumes para mostrar
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 mt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Siguiente
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl shadow-sm p-4">
        <h3 className="font-semibold mb-2">Detalle rápido</h3>
        {selected ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">ID:</span> {asText(selected.id)}
            </p>
            <p>
              <span className="text-muted-foreground">Nombre:</span> {buildDisplayName(selected)}
            </p>
            <p>
              <span className="text-muted-foreground">Job Direction:</span> {asText(selected.job_direction) || '-'}
            </p>
            <p>
              <span className="text-muted-foreground">Resumen:</span> {asText(selected.profile_summary) || '-'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">点击上面的某一行查看详情。</p>
        )}
      </div>
    </div>
  );
};

export default ResumesAdminPanel;

