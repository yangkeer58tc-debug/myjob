import { useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { decodeCsvFile } from '@/lib/csvFileDecode';
import { jobImportUpsertOnlyConcurrency, runPool } from '@/lib/jobImportPool';
import { enrichMxRowsWithGeocodedLocations } from '@/lib/mxLocationGeo';
import { hasOpenAiCompatibleKeyForMxTranslate, translateMxJobPostToEsMx } from '@/lib/jobSummaryAi';
import { supabase } from '@/integrations/supabase/client';
import type { MxCategoryInfo } from '@/lib/okMxJobImport';
import {
  OK_MX_EMPLOYER_NAME,
  OK_MX_EXTERNAL_SOURCE,
  OK_MX_LEGACY_EMPLOYER_NAMES,
  buildOkMxJobRows,
  isMxRealPostsCsvHeader,
  parseMxCategoryCsvText,
} from '@/lib/okMxJobImport';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const csvEscape = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

type MxImportProgress = {
  isRunning: boolean;
  total: number;
  saved: number;
  failed: number;
  lastTitle?: string;
  lastError?: string;
};

export default function OkComMxPanel() {
  const queryClient = useQueryClient();
  const postsInputRef = useRef<HTMLInputElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const [mxImportProgress, setMxImportProgress] = useState<MxImportProgress | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleMxImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const postsFile = e.target.files?.[0];
    if (!postsFile) return;
    if (mxImportProgress?.isRunning) return;

    let categoryFile: File | null = null;
    try {
      categoryFile = categoryInputRef.current?.files?.[0] ?? null;
    } catch {
      categoryFile = null;
    }

    (async () => {
      try {
        const postsText = await decodeCsvFile(postsFile);
        const postsParsed = Papa.parse<Record<string, string>>(postsText, {
          header: true,
          skipEmptyLines: true,
          delimiter: ',',
        });
        const fields = postsParsed.meta?.fields || [];
        if (!isMxRealPostsCsvHeader(fields)) {
          throw new Error(
            'CSV 表头不符合 MX 真实帖子格式（需要列：info_id, cate_code, content 等）。请确认选对了「MX真实帖子」导出文件。',
          );
        }

        const rows = (postsParsed.data || []).filter((r) =>
          Object.values(r || {}).some((v) => String(v ?? '').trim() !== ''),
        );

        let categoryMap = new Map<string, MxCategoryInfo>();
        try {
          const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
          const res = await fetch(`${base}data/mx-job-categories.csv`, { cache: 'no-store' });
          if (res.ok) {
            categoryMap = parseMxCategoryCsvText(await res.text());
          }
        } catch {
          // ignore — optional bundled taxonomy
        }

        if (categoryFile) {
          const catText = await decodeCsvFile(categoryFile);
          const uploaded = parseMxCategoryCsvText(catText);
          uploaded.forEach((v, k) => categoryMap.set(k, v));
        }

        const normalizedRows = rows.map((r) => ({ ...r }));
        const needTranslate = normalizedRows
          .map((r, i) => ({ i, lang: String(r.language ?? '').trim().toLowerCase() }))
          .filter((x) => x.lang && x.lang !== 'es');

        if (needTranslate.length > 0) {
          if (!hasOpenAiCompatibleKeyForMxTranslate()) {
            toast.warning(
              `有 ${needTranslate.length} 条语言不是 es，但未配置 OpenAI 兼容密钥（VITE_OPENAI_API_KEY 或 LLM_API_KEY），无法自动译为西语。`,
              { duration: 9000 },
            );
          } else {
            toast.message(`正在将 ${needTranslate.length} 条非西语职位译为 es-MX…`, { duration: 5000 });
            const trConc = Math.min(6, Math.max(1, needTranslate.length));
            await runPool(needTranslate.length, trConc, async (k) => {
              const { i } = needTranslate[k];
              const r = normalizedRows[i];
              const tr = await translateMxJobPostToEsMx(String(r.title ?? ''), String(r.content ?? ''));
              normalizedRows[i] = { ...r, title: tr.title, content: tr.description };
            });
          }
        }

        if (normalizedRows.length > 0) {
          toast.message('正在根据 para 坐标解析地点（Nominatim / 最近大城市）…', { duration: 4000 });
          await enrichMxRowsWithGeocodedLocations(normalizedRows);
        }

        let payload = buildOkMxJobRows(normalizedRows, categoryMap);
        const totalInput = payload.length;
        if (totalInput === 0) {
          toast.message('没有可导入的数据行。');
          return;
        }

        const incomingIds = Array.from(new Set(payload.map((row) => String(row.id ?? '').trim()).filter(Boolean)));
        const existingIds = new Set<string>();
        for (const part of chunk(incomingIds, 200)) {
          const { data, error } = await supabase.from('jobs').select('id').in('id', part);
          if (error) throw error;
          for (const row of data || []) {
            if (row?.id) existingIds.add(String(row.id));
          }
        }
        if (existingIds.size > 0) {
          const before = payload.length;
          payload = payload.filter((row) => !existingIds.has(String(row.id)));
          const skipped = before - payload.length;
          if (skipped > 0) {
            toast.message(`已跳过 ${skipped} 条：jobs 表中已存在相同 info_id。`);
          }
        }

        const total = payload.length;
        if (total === 0) {
          toast.message('没有新行可导入（ID 均已存在）。');
          return;
        }

        const concurrency = jobImportUpsertOnlyConcurrency();
        setMxImportProgress({ isRunning: true, total, saved: 0, failed: 0 });

        const outcomes: boolean[] = [];
        await runPool(total, concurrency, async (i) => {
          let lastError: string | undefined;
          try {
            const { error } = await supabase.from('jobs').upsert([payload[i]]);
            if (error) throw new Error(error.message || String(error));
            outcomes.push(true);
          } catch (err: unknown) {
            outcomes.push(false);
            lastError = String((err as { message?: unknown })?.message || err);
          }
          const okN = outcomes.filter(Boolean).length;
          const badN = outcomes.filter((x) => !x).length;
          setMxImportProgress((prev) =>
            prev?.isRunning
              ? {
                  isRunning: true,
                  total,
                  saved: okN,
                  failed: badN,
                  lastTitle: payload[i]?.title,
                  ...(lastError ? { lastError: lastError.slice(0, 160) } : {}),
                }
              : prev,
          );
        });

        const saved = outcomes.filter(Boolean).length;
        const failed = outcomes.length - saved;
        setMxImportProgress({ isRunning: false, total, saved, failed });

        queryClient.invalidateQueries({ queryKey: ['adminJobs'] });

        if (failed === 0) toast.success(`已导入 ${saved} 条 OK.com Jobs（MX 真实帖子）。`);
        else toast.error(`导入结束：成功 ${saved}，失败 ${failed}。`);

        window.setTimeout(() => setMxImportProgress(null), 3200);
      } catch (err: unknown) {
        setMxImportProgress(null);
        toast.error(String((err as { message?: unknown })?.message || err));
      } finally {
        if (postsInputRef.current) postsInputRef.current.value = '';
      }
    })();
  };

  const handleExportApplications = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const selectCols = 'id,conversation_id,wa_user_id,job_id,job_title,job_company,created_at';
      type AppRow = {
        id: string;
        conversation_id: string | null;
        wa_user_id: string;
        job_id: string | null;
        job_title: string | null;
        job_company: string | null;
        created_at: string;
      };
      const appMap = new Map<string, AppRow>();
      const companyFilter = [OK_MX_EMPLOYER_NAME, ...OK_MX_LEGACY_EMPLOYER_NAMES];

      let from = 0;
      const pageSize = 1000;
      for (;;) {
        const { data, error } = await supabase
          .from('whatsapp_applications')
          .select(selectCols)
          .in('job_company', companyFilter)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as AppRow[];
        for (const a of batch) appMap.set(a.id, a);
        if (batch.length < pageSize) break;
        from += pageSize;
        if (from > 50_000) break;
      }

      const { data: mxJobs, error: mxErr } = await supabase
        .from('jobs')
        .select('id')
        .eq('external_source', OK_MX_EXTERNAL_SOURCE);
      if (mxErr) throw mxErr;
      const mxJobIds = (mxJobs ?? []).map((j) => j.id).filter(Boolean);

      for (const idPart of chunk(mxJobIds, 120)) {
        if (idPart.length === 0) continue;
        let from2 = 0;
        for (;;) {
          const { data, error } = await supabase
            .from('whatsapp_applications')
            .select(selectCols)
            .in('job_id', idPart)
            .order('created_at', { ascending: false })
            .range(from2, from2 + pageSize - 1);
          if (error) throw error;
          const batch = (data ?? []) as AppRow[];
          for (const a of batch) appMap.set(a.id, a);
          if (batch.length < pageSize) break;
          from2 += pageSize;
          if (from2 > 50_000) break;
        }
      }

      const apps = [...appMap.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

      const convIds = [...new Set(apps.map((a) => a.conversation_id).filter(Boolean))] as string[];
      const convById = new Map<
        string,
        { last_resume_storage_path: string | null; resume_storage_path: string | null }
      >();
      for (const part of chunk(convIds, 200)) {
        const { data, error } = await supabase
          .from('whatsapp_conversations')
          .select('id,last_resume_storage_path,resume_storage_path')
          .in('id', part);
        if (error) throw error;
        for (const c of data || []) {
          if (c?.id) convById.set(String(c.id), c);
        }
      }

      const header = [
        'application_id',
        'created_at',
        'job_id',
        'job_title',
        'job_company',
        'whatsapp_from_id',
        'resume_storage_path',
        'resume_signed_url_24h',
      ];
      const lines = [header.join(',')];

      for (const a of apps) {
        const conv = a.conversation_id ? convById.get(a.conversation_id) : undefined;
        const path = conv?.last_resume_storage_path || conv?.resume_storage_path || '';
        let signed = '';
        if (path) {
          const { data: signedData, error: signErr } = await supabase.storage
            .from('whatsapp-resumes')
            .createSignedUrl(path, 60 * 60 * 24);
          if (!signErr && signedData?.signedUrl) signed = signedData.signedUrl;
        }
        lines.push(
          [
            a.id,
            a.created_at,
            a.job_id ?? '',
            a.job_title ?? '',
            a.job_company ?? '',
            a.wa_user_id,
            path,
            signed,
          ]
            .map(csvEscape)
            .join(','),
        );
      }

      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ok-com-mx-applications-${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(`已导出 ${apps.length} 条投递（OK.com Jobs / 旧名 ok.com招聘 / external_source 职位）。`);
    } catch (err: unknown) {
      toast.error(String((err as { message?: unknown })?.message || err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="mb-4 border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">OK.com Jobs · MX 真实帖子</CardTitle>
        <CardDescription>
          使用「MX真实帖子」CSV（含 info_id / cate_code / content）。品类名称会合并内置的{' '}
          <code className="text-xs">public/data/mx-job-categories.csv</code>；可选再上传品类表覆盖同名 code。
          职位写入公司「{OK_MX_EMPLOYER_NAME}」，站点分类按 MX 品类 path 的第二段映射到现有 5 类；Logo 为{' '}
          <code className="text-xs">/employers/okcom-recruitment-logo.jpg</code>。非 es 语言在配置了 OpenAI 兼容密钥时会译为 es-MX。
          地点：从 <code className="text-xs">para</code> 的坐标做 OSM 逆地理（失败则用最近大城市锚点）；可用{' '}
          <code className="text-xs">VITE_MX_IMPORT_NOMINATIM=0</code> 关闭外网请求、仅用锚点。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input ref={categoryInputRef} type="file" accept=".csv" className="hidden" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => categoryInputRef.current?.click()}
          >
            选择品类 CSV（可选）
          </Button>
          <input
            ref={postsInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleMxImport}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-xl"
            disabled={Boolean(mxImportProgress?.isRunning)}
            onClick={() => postsInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-1" />
            导入 MX 真实帖子 CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={exporting}
            onClick={() => void handleExportApplications()}
          >
            {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            导出该公司投递（含简历链接）
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          数据库字段 <code className="text-xs">external_source</code> = <code className="text-xs">{OK_MX_EXTERNAL_SOURCE}</code>
          ，<code className="text-xs">mx_category_code</code> 存 cate_code。请先在 Supabase 执行迁移{' '}
          <code className="text-xs">20260513190000_ok_mx_jobs_and_resume_export.sql</code>。
        </p>
        {mxImportProgress?.isRunning || (!mxImportProgress?.isRunning && mxImportProgress && mxImportProgress.total > 0) ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span>{mxImportProgress.isRunning ? '正在写入…' : '完成'}</span>
              <span>
                {mxImportProgress.saved + mxImportProgress.failed} / {mxImportProgress.total}
              </span>
            </div>
            <Progress
              value={
                mxImportProgress.total > 0
                  ? Math.min(
                      100,
                      Math.round(
                        ((mxImportProgress.saved + mxImportProgress.failed) / mxImportProgress.total) * 100,
                      ),
                    )
                  : 0
              }
            />
            {mxImportProgress.lastTitle ? (
              <p className="text-xs text-muted-foreground truncate">最近：{mxImportProgress.lastTitle}</p>
            ) : null}
            {mxImportProgress.lastError ? (
              <p className="text-xs text-destructive truncate">{mxImportProgress.lastError}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
