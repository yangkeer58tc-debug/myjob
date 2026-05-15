import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { decodeCsvFile } from '@/lib/csvFileDecode';
import { isImcExportCsv, normalizeCsvRecordKeys } from '@/lib/imcCsvImport';
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

export default function JobRewriteUploadPanel() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [progress, setProgress] = useState<RewriteProgress | null>(null);
  const [previews, setPreviews] = useState<RewritePreview[]>([]);

  useEffect(() => {
    fetchJobRewriteStatus().then((s) => {
      setLlmConfigured(s.configured);
      setLlmModel(s.model ?? null);
    });
  }, []);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (progress?.isRunning) return;

    (async () => {
      try {
        const { data: authData } = await supabase.auth.getSession();
        if (!authData.session) {
          toast.error('请先登录 Admin 后再上传。');
          return;
        }
        if (!llmConfigured) {
          toast.error('测试环境未配置 LLM_API_KEY / LLM_BASE_URL（Cloudflare Pages 变量）。');
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

            if (!dryRun) {
              const payload = buildJobUpsertAfterRewrite(row, data);
              const { error } = await supabase.from('jobs').upsert([payload]);
              if (error) throw new Error(error.message);
              saved += 1;
            } else {
              saved += 1;
            }
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

        if (dryRun) {
          toast.success(`试跑完成：${saved} 条改写成功，${failed} 条失败（未写入数据库）。`);
        } else if (failed === 0) {
          await queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
          toast.success(`已导入 ${saved} 条 AI 改写职位。`);
        } else {
          await queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
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
    <Card className="rounded-2xl border-primary/20 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-primary" />
          AI 改写上传（测试）
        </CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          使用 Cloudflare 上的 <code className="text-xs">LLM_*</code>（当前
          {llmConfigured === null ? ' 检测中…' : llmConfigured ? ` 已配置${llmModel ? ` · ${llmModel}` : ''}` : ' 未配置'}
          ）按{' '}
          <code className="text-xs">docs/job-content-rewrite-plan-zh.md</code> 改写正文与 SEO 标题，再写入{' '}
          <code className="text-xs">jobs</code>。格式与「导入主 CSV」相同（标准模板或 IMC 导出）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
          <Switch id="rewrite-dry-run" checked={dryRun} onCheckedChange={setDryRun} />
          <Label htmlFor="rewrite-dry-run" className="text-sm cursor-pointer">
            仅试跑（不改库）— 建议先开着看改写效果，确认后再关闭并重新上传
          </Label>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            type="button"
            className="rounded-xl"
            disabled={!llmConfigured || Boolean(progress?.isRunning)}
            onClick={() => fileInputRef.current?.click()}
          >
            {progress?.isRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            选择 CSV 并开始 AI 改写
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
              <span>{progress.isRunning ? '改写中…' : '已完成'}</span>
              <span className="text-muted-foreground">
                {progress.done}/{progress.total} · 成功 {progress.saved} · 失败 {progress.failed}
              </span>
            </div>
            <Progress value={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0} />
            {progress.lastTitle ? (
              <p className="text-xs text-muted-foreground truncate">最近：{progress.lastTitle}</p>
            ) : null}
            {progress.lastError ? (
              <p className="text-xs text-destructive truncate">{progress.lastError}</p>
            ) : null}
          </div>
        ) : null}

        {previews.length > 0 ? (
          <div className="rounded-xl border border-border p-3 bg-card max-h-48 overflow-auto">
            <p className="text-xs font-medium mb-2">改写预览（标题）</p>
            <ul className="text-xs space-y-1 text-muted-foreground">
              {previews.map((p) => (
                <li key={p.id}>
                  <span className="text-foreground font-medium">{p.title}</span>
                  {p.duplicateRatio != null ? (
                    <span> · 重复率约 {Math.round(p.duplicateRatio * 100)}%</span>
                  ) : null}
                  {p.warnings.length > 0 ? <span className="text-amber-600"> · {p.warnings[0]}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
