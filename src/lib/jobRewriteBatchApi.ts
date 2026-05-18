import {
  buildJobRewriteInputFromRow,
  prepareRowForRewriteImport,
} from '@/lib/jobContentRewriteBuild';
import { jobRewriteMaxRows } from '@/lib/jobRewriteLimits';
import type { Json } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';

export type JobRewriteBatchRow = {
  id: string;
  created_at: string;
  status: string;
  total_count: number;
  pending_count: number;
  saved_count: number;
  failed_count: number;
  source_filename: string | null;
  llm_model: string | null;
  error_summary: string | null;
};

const TASK_INSERT_CHUNK = 80;

export async function createJobRewriteBatchFromRows(
  rows: Record<string, string>[],
  imcShape: boolean,
  filename: string,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('请先登录 Admin。');

  const prepared = rows.map((r) => prepareRowForRewriteImport(r, imcShape));
  const maxRows = jobRewriteMaxRows();
  const capped = prepared.slice(0, maxRows);
  if (prepared.length > maxRows) {
    throw new Error(`CSV 共 ${prepared.length} 行，仅创建前 ${maxRows} 条任务。`);
  }
  if (capped.length === 0) throw new Error('CSV 中没有有效行。');

  const { data: batch, error: batchErr } = await supabase
    .from('job_rewrite_batches')
    .insert({
      created_by: user.id,
      status: 'queued',
      total_count: capped.length,
      pending_count: capped.length,
      saved_count: 0,
      failed_count: 0,
      source_filename: filename || null,
      llm_model: 'gemini-2.0-flash',
    })
    .select('id')
    .single();

  if (batchErr || !batch?.id) {
    throw new Error(batchErr?.message || '创建批次失败');
  }

  const batchId = batch.id as string;
  const taskRows = capped.map((row, row_index) => {
    const input = buildJobRewriteInputFromRow(row);
    return {
      batch_id: batchId,
      row_index,
      job_id: input.job_id,
      status: 'pending' as const,
      input: input as unknown as Json,
      row_snapshot: row as unknown as Json,
    };
  });

  for (let i = 0; i < taskRows.length; i += TASK_INSERT_CHUNK) {
    const chunk = taskRows.slice(i, i + TASK_INSERT_CHUNK);
    const { error } = await supabase.from('job_rewrite_tasks').insert(chunk);
    if (error) throw new Error(`写入任务失败：${error.message}`);
  }

  await triggerJobRewriteWorker();

  return batchId;
}

export type WorkerInvokeResult =
  | { ok: true; processed: number; worker?: string }
  | { ok: false; error: string };

export async function triggerJobRewriteWorker(): Promise<WorkerInvokeResult> {
  const { data, error } = await supabase.functions.invoke('job-rewrite-worker', { body: {} });

  if (error) {
    return { ok: false, error: error.message };
  }

  const body = (data ?? {}) as { ok?: boolean; error?: string; processed?: number; worker?: string };
  if (body.error) {
    return { ok: false, error: body.error };
  }
  if (body.ok === false) {
    return { ok: false, error: 'Worker 返回失败' };
  }
  if (body.ok === true) {
    return { ok: true, processed: Number(body.processed ?? 0), worker: body.worker };
  }

  return { ok: false, error: 'Worker 无有效响应（请检查 Supabase 是否已部署 job-rewrite-worker）' };
}

async function liveTaskCounts(batchId: string) {
  const { data, error } = await supabase.from('job_rewrite_tasks').select('status').eq('batch_id', batchId);
  if (error) throw new Error(error.message);
  const rows = data || [];
  let pending = 0;
  let saved = 0;
  let failed = 0;
  let processing = 0;
  for (const r of rows) {
    const s = String(r.status);
    if (s === 'pending') pending += 1;
    else if (s === 'done') saved += 1;
    else if (s === 'failed') failed += 1;
    else if (s === 'processing') processing += 1;
  }
  return { pending, saved, failed, processing, total: rows.length };
}

export async function fetchJobRewriteBatch(batchId: string): Promise<JobRewriteBatchRow | null> {
  const { data, error } = await supabase
    .from('job_rewrite_batches')
    .select(
      'id, created_at, status, total_count, pending_count, saved_count, failed_count, source_filename, llm_model, error_summary',
    )
    .eq('id', batchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const live = await liveTaskCounts(batchId);
  let status = data.status as string;
  if (status !== 'cancelled') {
    if (live.pending === 0 && live.processing === 0 && live.total > 0) {
      status = live.failed > 0 && live.saved === 0 ? 'failed' : 'completed';
    } else if (live.saved > 0 || live.failed > 0 || live.processing > 0) {
      status = 'running';
    }
  }

  return {
    ...(data as JobRewriteBatchRow),
    status,
    total_count: live.total || data.total_count,
    pending_count: live.pending,
    saved_count: live.saved,
    failed_count: live.failed,
  };
}

export async function fetchFailedRewriteTasks(batchId: string, limit = 15) {
  const { data, error } = await supabase
    .from('job_rewrite_tasks')
    .select('job_id, error, row_index')
    .eq('batch_id', batchId)
    .eq('status', 'failed')
    .order('row_index')
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function cancelJobRewriteBatch(batchId: string): Promise<void> {
  const { error: batchErr } = await supabase
    .from('job_rewrite_batches')
    .update({ status: 'cancelled' })
    .eq('id', batchId);
  if (batchErr) throw new Error(batchErr.message);

  const { error: taskErr } = await supabase
    .from('job_rewrite_tasks')
    .update({ status: 'skipped', updated_at: new Date().toISOString() })
    .eq('batch_id', batchId)
    .eq('status', 'pending');
  if (taskErr) throw new Error(taskErr.message);
}
