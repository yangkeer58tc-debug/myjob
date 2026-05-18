import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { decodeCsvFile } from '@/lib/csvFileDecode';
import { isImcExportCsv } from '@/lib/imcCsvImport';
import {
  cancelJobRewriteBatch,
  createJobRewriteBatchFromRows,
  fetchFailedRewriteTasks,
  fetchJobRewriteBatch,
  triggerJobRewriteWorker,
  type JobRewriteBatchRow,
} from '@/lib/jobRewriteBatchApi';
import { fatalPapaParseErrors, parseJobCsvText } from '@/lib/jobRewriteCsvParse';
import { fetchJobRewriteStatus } from '@/lib/jobContentRewriteClient';
import { jobRewriteMaxRows } from '@/lib/jobRewriteLimits';
import { supabase } from '@/integrations/supabase/client';

type JobRewriteBatchPanelProps = {
  importBusy?: boolean;
};

export default function JobRewriteBatchPanel({ importBusy = false }: JobRewriteBatchPanelProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<JobRewriteBatchRow | null>(null);
  const [failedPreview, setFailedPreview] = useState<Array<{ job_id: string; error: string | null }>>([]);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [workerHint, setWorkerHint] = useState<string | null>(null);
  const maxRows = jobRewriteMaxRows();

  const refreshBatch = useCallback(async (id: string) => {
    const row = await fetchJobRewriteBatch(id);
    setBatch(row);
    if (row && row.failed_count > 0) {
      const failed = await fetchFailedRewriteTasks(id, 12);
      setFailedPreview(failed as Array<{ job_id: string; error: string | null }>);
    } else {
      setFailedPreview([]);
    }
    return row;
  }, []);

  useEffect(() => {
    fetchJobRewriteStatus().then((s) => setLlmConfigured(s.configured));
  }, []);

  const runWorker = useCallback(async (silent: boolean) => {
    const res = await triggerJobRewriteWorker();
    if (res.ok) {
      setWorkerHint(
        res.processed > 0
          ? `Worker 已处理 ${res.processed} 条`
          : 'Worker 已响应（当前无待领取任务或本批已满）',
      );
      if (!silent && res.processed > 0) {
        toast.message(`Worker 已处理 ${res.processed} 条`);
      }
    } else {
      setWorkerHint(`Worker 调用失败：${res.error}`);
      if (!silent) toast.error(res.error);
    }
    return res;
  }, []);

  useEffect(() => {
    if (!batchId) return;
    const tick = () => {
      refreshBatch(batchId).catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 5000);
    return () => window.clearInterval(t);
  }, [batchId, refreshBatch]);

  /** Cron 未配置时：有待处理任务则每 60s 自动触发 Worker */
  useEffect(() => {
    if (!batchId || !batch) return;
    if (!['queued', 'running'].includes(batch.status)) return;
    if (batch.pending_count <= 0) return;

    void runWorker(true);
    const t = window.setInterval(() => {
      void runWorker(true).then(() => refreshBatch(batchId).catch(() => {}));
    }, 60_000);
    return () => window.clearInterval(t);
  }, [batchId, batch?.status, batch?.pending_count, runWorker, refreshBatch]);

  useEffect(() => {
    if (!batch) return;
    if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'cancelled') {
      void queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    }
  }, [batch?.status, queryClient]);

  const busy = importBusy || uploading;
  const progressPct =
    batch && batch.total_count > 0
      ? Math.round(((batch.saved_count + batch.failed_count) / batch.total_count) * 100)
      : 0;
  const isActive = batch && ['queued', 'running'].includes(batch.status);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || busy) return;

    (async () => {
      setUploading(true);
      try {
        const { data: authData } = await supabase.auth.getSession();
        if (!authData.session) {
          toast.error('请先登录 Admin。');
          return;
        }

        const text = await decodeCsvFile(file);
        const results = parseJobCsvText(text);
        const fatal = fatalPapaParseErrors(results.errors);
        if (fatal.length) throw new Error(fatal[0]?.message || 'CSV inválido');

        const rows = (results.data || []).filter((r) =>
          Object.values(r || {}).some((v) => String(v ?? '').trim() !== ''),
        );
        const fieldNames = results.meta?.fields || [];
        const imcShape = isImcExportCsv(fieldNames);

        const id = await createJobRewriteBatchFromRows(rows, imcShape, file.name);
        setBatchId(id);
        await runWorker(false);
        const row = await refreshBatch(id);
        toast.success(`已创建后台改写任务（${row?.total_count ?? 0} 条），可关闭本页。`);
      } catch (err: unknown) {
        toast.error(String((err as { message?: unknown })?.message || err));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    })();
  };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          AI 改写导入（后台队列）
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          上传 CSV 后由 Supabase 后台逐条改写，无需保持本页打开。LLM 密钥仅保存在 Edge Secrets。
          {llmConfigured === false
            ? ' 未检测到服务端 LLM：请在 Supabase 为 job-rewrite-worker 配置 LLM_*。'
            : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button
          type="button"
          variant="secondary"
          className="rounded-xl"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          上传 CSV（后台改写）
        </Button>
        <span className="text-xs text-muted-foreground">单次最多 {maxRows} 条 · 后台慢速处理（保护 Gemini）</span>
      </div>

      <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleUpload} />

      {batch ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              批次 <code className="text-xs">{batch.id.slice(0, 8)}…</code> · {batch.status}
            </span>
            <span className="text-muted-foreground">
              成功 {batch.saved_count} · 失败 {batch.failed_count} · 待处理 {batch.pending_count} /{' '}
              {batch.total_count}
            </span>
          </div>
          <Progress value={progressPct} />
          {isActive ? (
            <p className="text-xs text-muted-foreground">
              后台处理中（约每分钟自动触发 Worker，无 Cron 也能跑）。可关页面；也可点「立即触发 Worker」。
            </p>
          ) : null}
          {workerHint ? <p className="text-xs text-amber-700 dark:text-amber-400">{workerHint}</p> : null}
          <div className="flex flex-wrap gap-2">
            {batchId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={async () => {
                  await runWorker(false);
                  await refreshBatch(batchId).catch((err) => toast.error(String(err)));
                }}
              >
                立即触发 Worker
              </Button>
            ) : null}
            {isActive && batchId ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-lg text-destructive"
                onClick={async () => {
                  try {
                    await cancelJobRewriteBatch(batchId);
                    await refreshBatch(batchId);
                    toast.message('已取消剩余待处理任务');
                  } catch (err: unknown) {
                    toast.error(String((err as { message?: unknown })?.message || err));
                  }
                }}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                取消剩余
              </Button>
            ) : null}
          </div>
          {failedPreview.length > 0 ? (
            <ul className="text-xs text-muted-foreground max-h-28 overflow-auto space-y-1">
              {failedPreview.map((f) => (
                <li key={f.job_id}>
                  <span className="text-foreground">{f.job_id}</span>
                  {f.error ? ` — ${f.error.slice(0, 120)}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}