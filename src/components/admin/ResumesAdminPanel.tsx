import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResumesSource, resumesSupabase } from '@/integrations/resumes/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { listResumes } from '@/modules/resumes/service';
import { buildResumeImportDraft } from '@/modules/resumes/importer';
import { runResumeDryRun } from '@/modules/resumes/dryRun';
import type { ResumeListItem } from '@/modules/resumes/types';

const PAGE_SIZE = 20;

const ResumesAdminPanel = () => {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parserInput, setParserInput] = useState('');
  const [parserResult, setParserResult] = useState<string>('');
  const [dryRunInput, setDryRunInput] = useState('');
  const [dryRunResult, setDryRunResult] = useState<string>('');

  const source = useMemo(() => getResumesSource(), []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['adminExternalResumesV2', source.tableOrView, query, page],
    queryFn: async () => listResumes({ query, page, pageSize: PAGE_SIZE }),
    enabled: true,
  });

  const rows = data?.rows || [];
  const count = data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const selected = rows.find((r) => String(r.id) === selectedId) || null;

  const handleParsePreview = () => {
    const source = parserInput.trim();
    if (!source) {
      setParserResult('请先输入或粘贴简历文本。');
      return;
    }
    const draft = buildResumeImportDraft(source);
    setParserResult(JSON.stringify(draft, null, 2));
  };

  const handleBatchDryRun = () => {
    const source = dryRunInput.trim();
    if (!source) {
      setDryRunResult('请先输入批量文本（可用 --- 分隔多份简历）。');
      return;
    }
    const result = runResumeDryRun(source);
    setDryRunResult(JSON.stringify(result, null, 2));
  };

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
                rows.map((r: ResumeListItem) => {
                  const id = String(r.id);
                  const updated = String(r.updatedAt || '').trim();
                  return (
                    <tr
                      key={id}
                      className={`border-t border-border cursor-pointer ${selectedId === id ? 'bg-secondary/40' : ''}`}
                      onClick={() => setSelectedId(id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{id}</td>
                      <td className="px-4 py-3 font-medium">{r.name || '-'}</td>
                      <td className="px-4 py-3">{r.jobDirection || '-'}</td>
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
              <span className="text-muted-foreground">ID:</span> {selected.id}
            </p>
            <p>
              <span className="text-muted-foreground">Nombre:</span> {selected.name || '-'}
            </p>
            <p>
              <span className="text-muted-foreground">Job Direction:</span> {selected.jobDirection || '-'}
            </p>
            <p>
              <span className="text-muted-foreground">Resumen:</span> {selected.profileSummary || '-'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">点击上面的某一行查看详情。</p>
        )}
      </div>

      <div className="bg-card rounded-2xl shadow-sm p-4 space-y-3">
        <h3 className="font-semibold">解析预览（只读，不写库）</h3>
        <p className="text-sm text-muted-foreground">
          用于预览 RMC 解析逻辑在 `myjob` 下的输出，确保后续切流前格式稳定。
        </p>
        <textarea
          className="w-full min-h-40 rounded-xl border border-border bg-background px-3 py-2 text-sm"
          placeholder="粘贴一段简历文本（英文/中文/结构化行）..."
          value={parserInput}
          onChange={(e) => setParserInput(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" className="rounded-xl" onClick={handleParsePreview}>
            解析预览
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              setParserInput('');
              setParserResult('');
            }}
          >
            清空
          </Button>
        </div>
        <pre className="text-xs whitespace-pre-wrap break-words bg-secondary/40 rounded-xl p-3 border border-border">
          {parserResult || '解析结果会显示在这里。'}
        </pre>
      </div>

      <div className="bg-card rounded-2xl shadow-sm p-4 space-y-3">
        <h3 className="font-semibold">批量 Dry-Run（只读，不写库）</h3>
        <p className="text-sm text-muted-foreground">
          粘贴多份简历文本并用 `---`（或 `===` / `###`）分隔，快速检查可提取率与缺失字段。
        </p>
        <textarea
          className="w-full min-h-40 rounded-xl border border-border bg-background px-3 py-2 text-sm"
          placeholder="Resume A...
---
Resume B..."
          value={dryRunInput}
          onChange={(e) => setDryRunInput(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" className="rounded-xl" onClick={handleBatchDryRun}>
            执行 Dry-Run
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              setDryRunInput('');
              setDryRunResult('');
            }}
          >
            清空
          </Button>
        </div>
        <pre className="text-xs whitespace-pre-wrap break-words bg-secondary/40 rounded-xl p-3 border border-border">
          {dryRunResult || 'Dry-Run 结果会显示在这里。'}
        </pre>
      </div>
    </div>
  );
};

export default ResumesAdminPanel;

