import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Loader2, RefreshCw, CalendarRange } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';

type ConversationRow = {
  id: string;
  wa_user_id: string;
  state: string;
  candidate_name: string | null;
  rmc_sync_status: string | null;
  rmc_sync_error: string | null;
  opt_in_clarify_count: number | null;
  last_resume_storage_path: string | null;
  resume_storage_path: string | null;
  last_resume_received_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  last_message_at: string;
  applying_job_id: string | null;
  applying_job_title: string | null;
  applying_job_company: string | null;
};

type ApplicationRow = {
  id: string;
  conversation_id: string | null;
  wa_user_id: string;
  rmc_resume_id: string | null;
  job_id: string | null;
  job_title: string | null;
  job_company: string | null;
  reused_existing_cv: boolean;
  opt_in_status: string;
  created_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  wa_user_id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  body: string | null;
  media_mime: string | null;
  created_at: string;
};

/** One logical WhatsApp account (digit-normalized), from `whatsapp_admin_wa_directory_cn`. */
type WaDirectoryRow = {
  latest_conversation_id: string;
  phone_key: string;
  wa_display: string;
  candidate_name: string | null;
  last_state: string;
  last_message_at: string;
  applying_job_title: string | null;
  applying_job_company: string | null;
  conversation_row_count: number;
  resume_send_count: number;
  application_count: number;
  has_opted_in_exposure: boolean;
};

type FunnelDailyRow = {
  day_cn: string;
  session_uv: number;
  resume_pv: number;
  application_pv: number;
  exposure_opt_in_pv: number;
  exposure_opt_in_uv: number;
};

const DIR_PAGE_SIZE = 25;

const WA_CONV_SELECT =
  'id, wa_user_id, state, candidate_name, rmc_sync_status, rmc_sync_error, opt_in_clarify_count, last_resume_storage_path, resume_storage_path, last_resume_received_at, completed_at, archived_at, created_at, last_message_at, applying_job_id, applying_job_title, applying_job_company';

/** PostgREST `.or()` filter for conversation search (ilike on common fields). */
function buildConversationSearchOr(searchRaw: string): string | null {
  const t = searchRaw.trim();
  if (!t) return null;
  const escaped = t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const p = `%${escaped}%`;
  return [
    `wa_user_id.ilike.${p}`,
    `candidate_name.ilike.${p}`,
    `state.ilike.${p}`,
    `applying_job_id.ilike.${p}`,
    `applying_job_title.ilike.${p}`,
    `applying_job_company.ilike.${p}`,
  ].join(',');
}

/** Calendar day in Asia/Shanghai as `YYYY-MM-DD` (for `<input type="date">` and funnel RPC). */
function shanghaiYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function shanghaiAddCalendarDays(ymd: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const da = Number(m[3]);
  const noonUtcMs = Date.UTC(y, mo, da, 4, 0, 0);
  const t = noonUtcMs + deltaDays * 86400000;
  return shanghaiYmd(new Date(t));
}

/** Inclusive last N calendar days ending today (Shanghai). */
function defaultLastNDaysInclusiveShanghai(n: number): { start: string; end: string } {
  const end = shanghaiYmd(new Date());
  if (n <= 1) return { start: end, end };
  const start = shanghaiAddCalendarDays(end, -(n - 1));
  return { start, end };
}

/** Shanghai calendar bounds → UTC ISO for filtering `timestamptz` columns on exports / legacy lists. */
function shanghaiYmdRangeToIsoUtc(ymdStart: string, ymdEnd: string): { fromIso: string; toIso: string } | null {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStart.trim());
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdEnd.trim());
  if (!m1 || !m2) return null;
  const from = new Date(`${m1[0]}T00:00:00+08:00`);
  const to = new Date(`${m2[0]}T23:59:59.999+08:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

type WaRangePreset = 'today' | 'd7' | 'd30' | 'all' | 'custom';

const STATE_LABEL: Record<string, string> = {
  new: 'New',
  awaiting_name: 'Awaiting name (legacy)',
  awaiting_resume: 'Awaiting resume',
  awaiting_returning_cv_choice: 'Existing CV / new CV',
  awaiting_opt_in: 'Awaiting Yes/No',
  completed_opt_in: 'Accepted highlights',
  completed_declined: 'Declined / no opt-in',
  completed_no_cv: 'No resume (closed)',
};

const RMC_LABEL: Record<string, string> = {
  none: '—',
  pending: 'Pending',
  success: 'OK',
  failed: 'Error',
  skipped_no_config: 'Skipped (no RMC)',
  skipped_staging: 'Skipped (staging)',
};

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const downloadCsv = (rows: ConversationRow[]) => {
  const header = [
    'wa_user_id',
    'candidate_name',
    'state',
    'applying_job_id',
    'applying_job_title',
    'applying_job_company',
    'rmc_sync_status',
    'rmc_sync_error',
    'opt_in_clarify_count',
    'last_resume_storage_path',
    'last_resume_received_at',
    'completed_at',
    'archived_at',
    'created_at',
    'last_message_at',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.wa_user_id,
        r.candidate_name ?? '',
        r.state,
        r.applying_job_id ?? '',
        r.applying_job_title ?? '',
        r.applying_job_company ?? '',
        r.rmc_sync_status ?? '',
        r.rmc_sync_error ?? '',
        r.opt_in_clarify_count ?? 0,
        r.last_resume_storage_path ?? r.resume_storage_path ?? '',
        r.last_resume_received_at ?? '',
        r.completed_at ?? '',
        r.archived_at ?? '',
        r.created_at,
        r.last_message_at,
      ]
        .map(escape)
        .join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whatsapp-conversations-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const csvEscape = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

async function fetchAllPaged<T>(
  table: string,
  selectCols: string,
  orderBy: { column: string; ascending: boolean }[],
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const HARD_CAP = 50_000;
  while (all.length < HARD_CAP) {
    let q = supabase.from(table).select(selectCols);
    for (const o of orderBy) q = q.order(o.column, { ascending: o.ascending });
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchAllConversationsMatchingSearch(
  searchRaw: string,
  dateOpts?: { allTime: boolean; fromIso: string | null; toIso: string | null },
): Promise<ConversationRow[]> {
  const orf = buildConversationSearchOr(searchRaw);
  const all: ConversationRow[] = [];
  let from = 0;
  const pageSize = 1000;
  const HARD_CAP = 50_000;
  while (all.length < HARD_CAP) {
    let q = supabase
      .from('whatsapp_conversations')
      .select(WA_CONV_SELECT)
      .order('last_message_at', { ascending: false });
    if (orf) q = q.or(orf);
    if (dateOpts && !dateOpts.allTime && dateOpts.fromIso) q = q.gte('last_message_at', dateOpts.fromIso);
    if (dateOpts && !dateOpts.allTime && dateOpts.toIso) q = q.lte('last_message_at', dateOpts.toIso);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as ConversationRow[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

type MessageExportRow = {
  id: string;
  conversation_id: string | null;
  wa_user_id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  body: string | null;
  media_mime: string | null;
  media_url: string | null;
  infobip_message_id: string | null;
  created_at: string;
};

type ConvExportLite = {
  id: string;
  state: string;
  candidate_name: string | null;
  applying_job_id: string | null;
  applying_job_title: string | null;
  applying_job_company: string | null;
};

const downloadAllMessagesCsv = async (): Promise<{ messages: number; conversations: number }> => {
  const [messages, conversations] = await Promise.all([
    fetchAllPaged<MessageExportRow>(
      'whatsapp_messages',
      'id, conversation_id, wa_user_id, direction, message_type, body, media_mime, media_url, infobip_message_id, created_at',
      [
        { column: 'wa_user_id', ascending: true },
        { column: 'created_at', ascending: true },
      ],
    ),
    fetchAllPaged<ConvExportLite>(
      'whatsapp_conversations',
      'id, state, candidate_name, applying_job_id, applying_job_title, applying_job_company',
      [{ column: 'id', ascending: true }],
    ),
  ]);

  const convById = new Map<string, ConvExportLite>();
  for (const c of conversations) convById.set(c.id, c);

  const header = [
    'created_at',
    'wa_user_id',
    'candidate_name',
    'direction',
    'message_type',
    'body',
    'media_mime',
    'media_url',
    'infobip_message_id',
    'conversation_state',
    'applying_job_id',
    'applying_job_title',
    'applying_job_company',
    'conversation_id',
    'message_id',
  ];
  const lines = [header.join(',')];
  for (const m of messages) {
    const conv = m.conversation_id ? convById.get(m.conversation_id) : undefined;
    lines.push(
      [
        m.created_at,
        m.wa_user_id,
        conv?.candidate_name ?? '',
        m.direction,
        m.message_type,
        m.body ?? '',
        m.media_mime ?? '',
        m.media_url ?? '',
        m.infobip_message_id ?? '',
        conv?.state ?? '',
        conv?.applying_job_id ?? '',
        conv?.applying_job_title ?? '',
        conv?.applying_job_company ?? '',
        m.conversation_id ?? '',
        m.id,
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whatsapp-messages-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  return { messages: messages.length, conversations: conversations.length };
};

const downloadApplicationsCsv = (rows: ApplicationRow[]) => {
  const header = [
    'wa_user_id',
    'job_id',
    'job_title',
    'job_company',
    'opt_in_status',
    'reused_existing_cv',
    'rmc_resume_id',
    'conversation_id',
    'created_at',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.wa_user_id,
        r.job_id ?? '',
        r.job_title ?? '',
        r.job_company ?? '',
        r.opt_in_status,
        r.reused_existing_cv ? 'true' : 'false',
        r.rmc_resume_id ?? '',
        r.conversation_id ?? '',
        r.created_at,
      ]
        .map(escape)
        .join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whatsapp-applications-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseWaDirectoryPayload(raw: unknown): { total: number; rows: WaDirectoryRow[] } {
  if (!raw || typeof raw !== 'object') return { total: 0, rows: [] };
  const o = raw as Record<string, unknown>;
  const total = num(o.total);
  const rowsRaw = o.rows;
  if (!Array.isArray(rowsRaw)) return { total, rows: [] };
  const rows: WaDirectoryRow[] = [];
  for (const item of rowsRaw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const latest_conversation_id = String(r.latest_conversation_id ?? '');
    const phone_key = String(r.phone_key ?? '');
    if (!latest_conversation_id || !phone_key) continue;
    rows.push({
      latest_conversation_id,
      phone_key,
      wa_display: String(r.wa_display ?? ''),
      candidate_name: (r.candidate_name as string | null) ?? null,
      last_state: String(r.last_state ?? ''),
      last_message_at: String(r.last_message_at ?? ''),
      applying_job_title: (r.applying_job_title as string | null) ?? null,
      applying_job_company: (r.applying_job_company as string | null) ?? null,
      conversation_row_count: num(r.conversation_row_count),
      resume_send_count: num(r.resume_send_count),
      application_count: num(r.application_count),
      has_opted_in_exposure: Boolean(r.has_opted_in_exposure),
    });
  }
  return { total, rows };
}

function parseFunnelDailyRows(raw: unknown): FunnelDailyRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FunnelDailyRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const day_cn = String(r.day_cn ?? '').slice(0, 10);
    if (!day_cn) continue;
    out.push({
      day_cn,
      session_uv: num(r.session_uv),
      resume_pv: num(r.resume_pv),
      application_pv: num(r.application_pv),
      exposure_opt_in_pv: num(r.exposure_opt_in_pv),
      exposure_opt_in_uv: num(r.exposure_opt_in_uv),
    });
  }
  return out;
}

export default function WhatsAppBotPanel() {
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [rangePreset, setRangePreset] = useState<WaRangePreset>('d30');
  const [rangeStartInput, setRangeStartInput] = useState(() => defaultLastNDaysInclusiveShanghai(30).start);
  const [rangeEndInput, setRangeEndInput] = useState(() => defaultLastNDaysInclusiveShanghai(30).end);
  const [dirPage, setDirPage] = useState(1);
  const [selectedPhoneKey, setSelectedPhoneKey] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messagesExporting, setMessagesExporting] = useState(false);
  const [messagesExportError, setMessagesExportError] = useState<string | null>(null);
  const [messagesExportInfo, setMessagesExportInfo] = useState<string | null>(null);
  const [convCsvExporting, setConvCsvExporting] = useState(false);
  const [appCsvExporting, setAppCsvExporting] = useState(false);

  const rangeAllTime = rangePreset === 'all';

  const funnelDateBounds = useMemo(() => {
    if (rangeAllTime) {
      const end = shanghaiYmd(new Date());
      return { p_from: '2020-01-01', p_to: end };
    }
    let a = rangeStartInput.trim();
    let b = rangeEndInput.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
      const d = defaultLastNDaysInclusiveShanghai(30);
      return { p_from: d.start, p_to: d.end };
    }
    if (a > b) [a, b] = [b, a];
    return { p_from: a, p_to: b };
  }, [rangeAllTime, rangeStartInput, rangeEndInput]);

  const listDateOpts = useMemo(() => {
    if (rangeAllTime) return { allTime: true as const, fromIso: null as string | null, toIso: null as string | null };
    const iso = shanghaiYmdRangeToIsoUtc(funnelDateBounds.p_from, funnelDateBounds.p_to);
    if (!iso) return { allTime: true as const, fromIso: null, toIso: null };
    return { allTime: false as const, fromIso: iso.fromIso, toIso: iso.toIso };
  }, [rangeAllTime, funnelDateBounds.p_from, funnelDateBounds.p_to]);

  const applyRangePreset = (preset: WaRangePreset) => {
    setRangePreset(preset);
    if (preset === 'all') return;
    if (preset === 'today') {
      const t = shanghaiYmd(new Date());
      setRangeStartInput(t);
      setRangeEndInput(t);
      return;
    }
    if (preset === 'd7') {
      const r = defaultLastNDaysInclusiveShanghai(7);
      setRangeStartInput(r.start);
      setRangeEndInput(r.end);
      return;
    }
    if (preset === 'd30') {
      const r = defaultLastNDaysInclusiveShanghai(30);
      setRangeStartInput(r.start);
      setRangeEndInput(r.end);
    }
  };

  const rangeSummaryLabel = useMemo(() => {
    if (rangeAllTime) return '全部（漏斗：2020-01-01 起至今日 · 中国日）';
    if (rangePreset === 'today') return '今天（中国）';
    return `${funnelDateBounds.p_from} ~ ${funnelDateBounds.p_to}（中国日历日）`;
  }, [rangeAllTime, rangePreset, funnelDateBounds.p_from, funnelDateBounds.p_to]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setDirPage(1);
  }, [searchDebounced]);

  const handleExportAllMessages = async () => {
    setMessagesExporting(true);
    setMessagesExportError(null);
    setMessagesExportInfo(null);
    try {
      const r = await downloadAllMessagesCsv();
      setMessagesExportInfo(
        `已导出 ${r.messages.toLocaleString('zh-CN')} 条消息，覆盖 ${r.conversations.toLocaleString('zh-CN')} 个会话 ID。`,
      );
    } catch (e) {
      setMessagesExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setMessagesExporting(false);
    }
  };

  const funnelQuery = useQuery({
    queryKey: ['waFunnelDailyCn', funnelDateBounds.p_from, funnelDateBounds.p_to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('whatsapp_admin_funnel_daily_cn', {
        p_from: funnelDateBounds.p_from,
        p_to: funnelDateBounds.p_to,
      });
      if (error) throw error;
      return parseFunnelDailyRows(data);
    },
    refetchInterval: 30_000,
  });

  const dirOffset = (dirPage - 1) * DIR_PAGE_SIZE;

  const directoryQuery = useQuery({
    queryKey: ['waWaDirectoryCn', searchDebounced, dirOffset],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('whatsapp_admin_wa_directory_cn', {
        p_search: searchDebounced,
        p_limit: DIR_PAGE_SIZE,
        p_offset: dirOffset,
      });
      if (error) throw error;
      return parseWaDirectoryPayload(data);
    },
    refetchInterval: 30_000,
  });

  const selectedConvQuery = useQuery({
    queryKey: ['waConvDetail', selectedConversationId],
    enabled: !!selectedConversationId,
    queryFn: async (): Promise<ConversationRow | null> => {
      if (!selectedConversationId) return null;
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select(WA_CONV_SELECT)
        .eq('id', selectedConversationId)
        .maybeSingle();
      if (error) throw error;
      return (data as ConversationRow | null) ?? null;
    },
  });

  const messagesQuery = useQuery<MessageRow[]>({
    queryKey: ['waMessages', selectedConversationId],
    enabled: !!selectedConversationId,
    queryFn: async () => {
      if (!selectedConversationId) return [] as MessageRow[];
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('id, conversation_id, wa_user_id, direction, message_type, body, media_mime, created_at')
        .eq('conversation_id', selectedConversationId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
  });

  const funnelRows = funnelQuery.data ?? [];
  const dirPayload = directoryQuery.data ?? { total: 0, rows: [] };
  const dirRows = dirPayload.rows;
  const dirTotal = dirPayload.total;
  const dirMaxPage = Math.max(1, Math.ceil(dirTotal / DIR_PAGE_SIZE));

  const selectedConv = selectedConvQuery.data;

  useEffect(() => {
    setDirPage((p) => Math.min(Math.max(1, p), dirMaxPage));
  }, [dirMaxPage]);

  const handleExportConversationsCsv = async () => {
    setConvCsvExporting(true);
    try {
      const rows = await fetchAllConversationsMatchingSearch(searchDebounced, listDateOpts);
      downloadCsv(rows);
    } finally {
      setConvCsvExporting(false);
    }
  };

  const handleExportApplicationsCsv = async () => {
    setAppCsvExporting(true);
    try {
      const all: ApplicationRow[] = [];
      let from = 0;
      const pageSize = 1000;
      const HARD_CAP = 50_000;
      while (all.length < HARD_CAP) {
        let q = supabase
          .from('whatsapp_applications')
          .select(
            'id, conversation_id, wa_user_id, rmc_resume_id, job_id, job_title, job_company, reused_existing_cv, opt_in_status, created_at',
          )
          .order('created_at', { ascending: false });
        if (!listDateOpts.allTime && listDateOpts.fromIso) q = q.gte('created_at', listDateOpts.fromIso);
        if (!listDateOpts.allTime && listDateOpts.toIso) q = q.lte('created_at', listDateOpts.toIso);
        const { data, error } = await q.range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as ApplicationRow[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      downloadApplicationsCsv(all);
    } finally {
      setAppCsvExporting(false);
    }
  };

  const funnelErr = funnelQuery.error ? (funnelQuery.error as Error).message : null;
  const directoryErr = directoryQuery.error ? (directoryQuery.error as Error).message : null;

  const onSelectDirectoryRow = (r: WaDirectoryRow) => {
    setSelectedPhoneKey(r.phone_key);
    setSelectedConversationId(r.latest_conversation_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">WhatsApp Bot</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => {
              void funnelQuery.refetch();
              void directoryQuery.refetch();
              void selectedConvQuery.refetch();
              void messagesQuery.refetch();
            }}
            disabled={funnelQuery.isFetching || directoryQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => void handleExportConversationsCsv()}
            disabled={convCsvExporting}
            title="按当前搜索与日期范围导出匹配会话（原始表，多会话不合并）。"
          >
            {convCsvExporting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            CSV 会话
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => void handleExportApplicationsCsv()}
            disabled={appCsvExporting}
            title="导出申请记录（按创建时间过滤；与上方日期范围一致）。"
          >
            {appCsvExporting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            CSV 申请
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => void handleExportAllMessages()}
            disabled={messagesExporting}
            title="导出全库消息（含会话上下文）。"
          >
            {messagesExporting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            Messages CSV (all)
          </Button>
        </div>
      </div>

      {messagesExportInfo && (
        <div className="bg-card rounded-2xl shadow-sm p-3 text-xs text-muted-foreground">{messagesExportInfo}</div>
      )}
      {messagesExportError && (
        <div className="bg-card rounded-2xl shadow-sm p-3 text-xs text-destructive">
          消息导出失败：{messagesExportError}
        </div>
      )}

      {funnelErr && (
        <Alert variant="destructive">
          <AlertTitle>漏斗数据加载失败</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{funnelErr}</p>
            <p className="text-xs opacity-90">
              请确认已在 Supabase 执行迁移{' '}
              <code className="rounded bg-background/80 px-1 py-0.5">20260517100000_whatsapp_admin_funnel_and_directory.sql</code>
              ，并对 <code className="rounded bg-background/80 px-1 py-0.5">authenticated</code> 授予{' '}
              <code className="rounded bg-background/80 px-1 py-0.5">EXECUTE</code>；必要时刷新 PostgREST schema cache。
            </p>
          </AlertDescription>
        </Alert>
      )}

      {directoryErr && (
        <Alert variant="destructive">
          <AlertTitle>账号目录加载失败</AlertTitle>
          <AlertDescription>{directoryErr}</AlertDescription>
        </Alert>
      )}

      <Card className="border-primary/15 shadow-sm">
        <CardHeader className="pb-3 space-y-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <CalendarRange className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <CardTitle className="text-base">日期范围（中国）</CardTitle>
                <CardDescription className="mt-1">
                  漏斗按 <strong>Asia/Shanghai</strong> 自然日汇总；导出会话/申请时，用同一范围的 UTC 边界过滤时间戳。
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'today' as const, label: '今天' },
                  { id: 'd7' as const, label: '近 7 天' },
                  { id: 'd30' as const, label: '近 30 天' },
                  { id: 'all' as const, label: '全部' },
                ] as const
              ).map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={rangePreset === p.id ? 'default' : 'outline'}
                  className="rounded-xl"
                  onClick={() => applyRangePreset(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="wa-range-start" className="text-xs text-muted-foreground">
                开始日期
              </Label>
              <Input
                id="wa-range-start"
                type="date"
                className="rounded-xl w-full sm:w-auto min-w-[10.5rem]"
                value={rangeStartInput}
                disabled={rangeAllTime}
                onChange={(e) => {
                  setRangeStartInput(e.target.value);
                  setRangePreset('custom');
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-range-end" className="text-xs text-muted-foreground">
                结束日期
              </Label>
              <Input
                id="wa-range-end"
                type="date"
                className="rounded-xl w-full sm:w-auto min-w-[10.5rem]"
                value={rangeEndInput}
                disabled={rangeAllTime}
                onChange={(e) => {
                  setRangeEndInput(e.target.value);
                  setRangePreset('custom');
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:ml-auto sm:pb-2">
              当前：{rangeSummaryLabel}
              {rangePreset === 'custom' ? '（自定义）' : null}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">漏斗看板（按日 · 中国）</CardTitle>
          <CardDescription>
            列含义：会话数 = 当日有消息的 WhatsApp 号码去重；简历数 = 当日用户发送的带附件简历类消息条数；申请数 ={' '}
            <code className="text-xs rounded bg-muted px-1">whatsapp_applications</code> 中带{' '}
            <code className="text-xs rounded bg-muted px-1">job_id</code> 的创建条数；同意曝光 ={' '}
            <code className="text-xs rounded bg-muted px-1">opt_in_status = opted_in</code> 的 PV / 号码 UV。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnelQuery.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">加载中…</p>
          ) : funnelRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">暂无数据或 RPC 未返回行。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3 whitespace-nowrap" title="timezone(Asia/Shanghai, created_at)::date">
                      日期
                    </th>
                    <th className="py-2 pr-3 whitespace-nowrap" title="当日任意消息的 wa 号码（去非数字后 DISTINCT）">
                      会话数（号码 UV）
                    </th>
                    <th className="py-2 pr-3 whitespace-nowrap" title="Inbound + media + document/image/video">
                      简历数（PV）
                    </th>
                    <th className="py-2 pr-3 whitespace-nowrap" title="申请记录条数，每条对应一个岗位">
                      申请数
                    </th>
                    <th className="py-2 pr-3 whitespace-nowrap" title="opted_in 记录条数">
                      同意曝光 PV
                    </th>
                    <th className="py-2 pr-3 whitespace-nowrap" title="opted_in 的号码去重">
                      同意曝光 UV
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {funnelRows.map((row) => (
                    <tr key={row.day_cn} className="border-b tabular-nums">
                      <td className="py-2 pr-3 whitespace-nowrap">{row.day_cn}</td>
                      <td className="py-2 pr-3">{row.session_uv.toLocaleString('zh-CN')}</td>
                      <td className="py-2 pr-3">{row.resume_pv.toLocaleString('zh-CN')}</td>
                      <td className="py-2 pr-3">{row.application_pv.toLocaleString('zh-CN')}</td>
                      <td className="py-2 pr-3">{row.exposure_opt_in_pv.toLocaleString('zh-CN')}</td>
                      <td className="py-2 pr-3">{row.exposure_opt_in_uv.toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">WhatsApp 账号（一行一号）</CardTitle>
          <CardDescription>
            同一号码下多段会话合并为一行；累计简历/申请为<strong>全库至今</strong>口径。点击行在下方加载<strong>最近活跃会话</strong>的消息。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-sm w-full">
              <Input
                placeholder="号码、显示名、候选人、职位关键词…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-xl"
              />
              {search !== searchDebounced ? (
                <p className="text-xs text-muted-foreground mt-1">正在更新搜索…</p>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">共 {dirTotal.toLocaleString('zh-CN')} 个号码</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3 min-w-[7rem]" title="原始 wa_user_id 或号码展示">
                    WhatsApp
                  </th>
                  <th className="py-2 pr-3">候选人</th>
                  <th className="py-2 pr-3 whitespace-nowrap" title="该号码在库中的会话行数">
                    会话段数
                  </th>
                  <th className="py-2 pr-3 whitespace-nowrap" title="累计发送简历类附件消息条数">
                    累计简历
                  </th>
                  <th className="py-2 pr-3 whitespace-nowrap" title="累计带 job_id 的申请条数">
                    累计申请
                  </th>
                  <th className="py-2 pr-3 whitespace-nowrap" title="是否曾有过 opted_in">
                    同意曝光
                  </th>
                  <th className="py-2 pr-3">最新状态</th>
                  <th className="py-2 pr-3 min-w-[8rem]" title="最近一条会话上的在投职位">
                    最近在投职位
                  </th>
                  <th className="py-2 pr-3 whitespace-nowrap" title="最近活跃会话的最后消息时间（中国）">
                    最近活跃
                  </th>
                </tr>
              </thead>
              <tbody>
                {directoryQuery.isLoading ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted-foreground">
                      加载中…
                    </td>
                  </tr>
                ) : dirRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted-foreground">
                      没有匹配的号码。
                    </td>
                  </tr>
                ) : (
                  dirRows.map((r) => (
                    <tr
                      key={r.phone_key}
                      onClick={() => onSelectDirectoryRow(r)}
                      className={`border-b cursor-pointer hover:bg-secondary/60 ${
                        selectedPhoneKey === r.phone_key ? 'bg-secondary/80' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{r.wa_display || r.phone_key}</td>
                      <td className="py-2 pr-3">{r.candidate_name ?? '—'}</td>
                      <td className="py-2 pr-3">{r.conversation_row_count.toLocaleString('zh-CN')}</td>
                      <td className="py-2 pr-3">{r.resume_send_count.toLocaleString('zh-CN')}</td>
                      <td className="py-2 pr-3">{r.application_count.toLocaleString('zh-CN')}</td>
                      <td className="py-2 pr-3">{r.has_opted_in_exposure ? '是' : '否'}</td>
                      <td className="py-2 pr-3">{STATE_LABEL[r.last_state] ?? r.last_state}</td>
                      <td className="py-2 pr-3 max-w-[160px] truncate" title={r.applying_job_title ?? ''}>
                        {r.applying_job_title
                          ? `${r.applying_job_title}${r.applying_job_company ? ` · ${r.applying_job_company}` : ''}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.last_message_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
            <span>
              第 {dirPage} / {dirMaxPage} 页 · 每页 {DIR_PAGE_SIZE} 条
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={dirPage <= 1 || directoryQuery.isFetching}
                onClick={() => setDirPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={dirPage >= dirMaxPage || directoryQuery.isFetching || dirTotal === 0}
                onClick={() => setDirPage((p) => Math.min(dirMaxPage, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedConversationId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              消息 —{' '}
              {selectedConv?.candidate_name ??
                selectedConv?.wa_user_id ??
                dirRows.find((x) => x.phone_key === selectedPhoneKey)?.wa_display ??
                selectedPhoneKey}
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-x-3 gap-y-1">
              {selectedConvQuery.isLoading ? (
                <span>正在加载会话详情…</span>
              ) : selectedConv ? (
                <>
                  <span>状态：{STATE_LABEL[selectedConv.state] ?? selectedConv.state}</span>
                  <span>RMC：{RMC_LABEL[selectedConv.rmc_sync_status ?? 'none']}</span>
                  {selectedConv.applying_job_id && (
                    <span>
                      职位：{selectedConv.applying_job_title ?? selectedConv.applying_job_id}
                      {selectedConv.applying_job_company ? `（${selectedConv.applying_job_company}）` : ''}
                    </span>
                  )}
                  {selectedConv.rmc_sync_error && (
                    <span className="text-destructive">错误：{selectedConv.rmc_sync_error}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    conversation_id: {selectedConversationId}
                  </span>
                </>
              ) : (
                <span className="text-destructive">未找到会话行（可能已被删除）。</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {messagesQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">加载消息…</div>
            ) : (messagesQuery.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">暂无消息。</div>
            ) : (
              <div className="space-y-2">
                {messagesQuery.data!.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-xl p-3 text-sm border ${
                      m.direction === 'inbound' ? 'bg-secondary/40' : 'bg-primary/5 border-primary/30'
                    }`}
                  >
                    <div className="text-xs text-muted-foreground mb-1">
                      <span className="font-medium">{m.direction === 'inbound' ? '用户' : 'Bot'}</span>
                      {' · '}
                      <span>{m.message_type}</span>
                      {' · '}
                      <span>{formatDate(m.created_at)}</span>
                    </div>
                    {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                    {!m.body && m.media_mime && (
                      <div className="text-muted-foreground italic">[附件：{m.media_mime}]</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
