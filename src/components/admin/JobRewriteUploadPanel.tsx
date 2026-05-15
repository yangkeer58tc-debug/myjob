import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { decodeCsvFile } from '@/lib/csvFileDecode';
import { isImcExportCsv } from '@/lib/imcCsvImport';
import { buildJobUpsertAfterRewrite } from '@/lib/jobContentRewriteApply';
import {
  buildJobRewriteInputFromRow,
  prepareRowForRewriteImport,
} from '@/lib/jobContentRewriteBuild';
import { fetchJobRewriteStatus, rewriteJobContent } from '@/lib/jobContentRewriteClient';
import { jobImportUpsertOnlyConcurrency, runPool } from '@/lib/jobImportPool';
import { supabase } from '@/integrations/supabase/client';

const JOB_CSV_PARSE_BASE = { skipEmptyLines: true as const };
const JOB_CSV_DELIMITERS = [',', '\t', ';', '|'] as const;

function fatalPapaParseErrors(errors: Array<{ message?: string; code?: string }> | undefined) {
  if (!errors?.length) return [];
  return errors.filter((e) => {
    const code = String(e.code ?? '');
    const msg = String(e.message ?? '');
    if (code === 'UndetectableDelimiter') return false;
    if (msg.includes('Unable to auto-detect delimiting character')) return false;
    return true;
  });
}

function parseRecordsWithBestDelimiter(text: string): Papa.ParseResult<Record<string, string>> {
  let best: Papa.ParseResult<Record<string, string>> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const delimiter of JOB_CSV_DELIMITERS) {
    const parsed = Papa.parse<Record<string, string>>(text, { ...JOB_CSV_PARSE_BASE, header: true, delimiter });
    const fatal = fatalPapaParseErrors(parsed.errors);
    const fields = (parsed.meta?.fields || []).filter((f) => String(f ?? '').trim() !== '');
    const nonEmptyRows = (parsed.data || []).filter((r) =>
      Object.values(r || {}).some((v) => String(v ?? '').trim() !== ''),
    );
    const score = fields.length * 100 + nonEmptyRows.length - fatal.length * 10000;
    if (score > bestScore) {
      best = parsed;
      bestScore = score;
    }
  }

  return best || Papa.parse<Record<string, string>>(text, { ...JOB_CSV_PARSE_BASE, header: true, delimiter: ',' });
}

type RewriteProgress = {
  isRunning: boolean;
  total: number;
  done: number;
  saved: number;
  failed: number;
  lastTitle?: string;
  lastError?: string;
};

type RewritePreview = {
  id: string;
  title: string;
  duplicateRatio: number | null;
  warnings: string[];
};

const DEFAULT_MAX_ROWS = 15;

type JobRewriteUploadPanelProps = {
  /** Disable while main CSV import is running */
  importBusy?: boolean;
};

export default function JobRewriteUploadPanel({ importBusy = false }: JobRewriteUploadPanelProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState<string | null>(null);
  const [progress, setProgress] = useState<RewriteProgress | null>(null);
  const [previews, setPreviews] = useState<RewritePreview[]>([]);

  const busy = importBusy || Boolean(progress?.isRunning);

  useEffect(() => {
    fetchJobRewriteStatus().then((s) => {
      setLlmConfigured(s.configured);
      setLlmModel(s.model ?? null);
    });
  }, []);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (busy) return;

    (async () => {
      try {
        const { data: authData } = await supabase.auth.getSession();
        if (!authData.session) {
          toast.error('请先登录 Admin 后再上传。');
          return;
        }
        if (!llmConfigured) {
          toast.error('未配置 LLM_API_KEY / LLM_BASE_URL（请在 Cloudflare Pages 环境变量中设置）。');
          return;
        }

        const text = await decodeCsvFile(file);
        const results = parseRecordsWithBestDelimiter(text);
        const fatal = fatalPapaParseErrors(results.errors);
        if (fatal.length) throw new Error(fatal[0]?.message || 'CSV inválido');

        const rows = (results.data || []).filter((r) =>
          Object.values(r || {}).some((v) => String(v ?? '').trim() !== ''),
        );
        const fieldNames = results.meta?.fields || [];
        const imcShape = isImcExportCsv(fieldNames);
        const prepared = rows.map((r) => prepareRowForRewriteImport(r as Record<string, string>, imcShape));
        const capped = prepared.slice(0, DEFAULT_MAX_ROWS);
        if (prepared.length > DEFAULT_MAX_ROWS) {
          toast.message(`仅处理前 ${DEFAULT_MAX_ROWS} 条（共 ${prepared.length} 条），避免一次打满 API 配额。`);
        }

        const total = capped.length;
        if (total === 0) {
          toast.message('CSV 中没有有效行。');
          return;
        }

        setPreviews([]);
        setProgress({ isRunning: true, total, done: 0, saved: 0, failed: 0 });

        const concurrency = Math.min(2, jobImportUpsertOnlyConcurrency());
        const previewAcc: RewritePreview[] = [];
        let saved = 0;
        let failed = 0;

        await runPool(total, concurrency, async (i) => {
          const row = capped[i];
          const input = buildJobRewriteInputFromRow(row);
          let lastTitle = input.structured.title;
          let lastError: string | undefined;

          try {
            const res = await rewriteJobContent(input);
            if (!res.success) {
              throw new Error(res.error);
            }

            const { data, qa } = res;
            lastTitle = data.title_rewritten;
            previewAcc.push({
              id: data.job_id,
              title: data.title_rewritten,
              duplicateRatio: qa.duplicateRatio,
              warnings: qa.warnings,
            });

            const payload = buildJobUpsertAfterRewrite(row, data);
            const { error } = await supabase.from('jobs').upsert([payload]);
            if (error) throw new Error(error.message);
            saved += 1;
          } catch (err: unknown) {
            failed += 1;
            lastError = String((err as { message?: unknown })?.message || err).slice(0, 160);
          }

          setProgress((prev) => {
            if (!prev) return prev;
            const done = i + 1;
            return {
              isRunning: done < total,
              total,
              done,
              saved,
              failed,
              lastTitle,
              lastError,
            };
          });
        });

        setPreviews(previewAcc.slice(0, 20));
        setProgress((prev) => (prev ? { ...prev, isRunning: false } : null));
        await queryClient.invalidateQueries({ queryKey: ['adminJobs'] });

        if (failed === 0) {
          toast.success(`已导入 ${saved} 条 AI 改写职位。`);
        } else {
          toast.error(`完成：成功 ${saved}，失败 ${failed}。`);
        }
      } catch (err: unknown) {
        setProgress(null);
        toast.error(String((err as { message?: unknown })?.message || err));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    })();
  };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          AI 改写导入
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          上传后由 Cloudflare <code className="text-[11px]">LLM_*</code>
          {llmConfigured === null ? '（检测中…）' : llmConfigured ? `（已配置${llmModel ? ` · ${llmModel}` : ''}）` : '（未配置）'}
          按改写方案生成 SEO 标题与正文，并直接写入 <code className="text-[11px]">jobs</code>。CSV 格式同「导入主 CSV」。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button
          type="button"
          variant="secondary"
          className="rounded-xl"
          disabled={!llmConfigured || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {progress?.isRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          导入 CSV（AI 改写）
        </Button>
        <span className="text-xs text-muted-foreground">单次最多 {DEFAULT_MAX_ROWS} 条 · 并发 2</span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={handleUpload}
      />

      {progress ? (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>{progress.isRunning ? '改写并保存中…' : '已完成'}</span>
            <span className="text-muted-foreground">
              {progress.done}/{progress.total} · 成功 {progress.saved} · 失败 {progress.failed}
            </span>
          </div>
          <Progress value={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0} />
          {progress.lastTitle ? (
            <p className="text-xs text-muted-foreground truncate">最近：{progress.lastTitle}</p>
          ) : null}
          {progress.lastError ? <p className="text-xs text-destructive truncate">{progress.lastError}</p> : null}
        </div>
      ) : null}

      {previews.length > 0 ? (
        <div className="rounded-lg border border-border p-2 bg-card max-h-40 overflow-auto">
          <p className="text-xs font-medium mb-1">最近改写标题</p>
          <ul className="text-xs space-y-0.5 text-muted-foreground">
            {previews.map((p) => (
              <li key={p.id}>
                <span className="text-foreground">{p.title}</span>
                {p.duplicateRatio != null ? (
                  <span> · 重复率约 {Math.round(p.duplicateRatio * 100)}%</span>
                ) : null}
                {p.warnings.length > 0 ? <span className="text-amber-600"> · {p.warnings[0]}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
