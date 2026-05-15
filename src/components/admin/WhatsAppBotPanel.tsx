import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
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

const CONV_PAGE_SIZE = 25;
const APP_PAGE_SIZE = 25;

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

type FunnelStats = {
  total: number;
  awaitingResume: number;
  awaitingReturningCv: number;
  awaitingOptIn: number;
  completedNoCv: number;
  resumeReceived: number;
  optedIn: number;
  declined: number;
  rmcSuccess: number;
  rmcFailed: number;
  rmcSkipped: number;
};

type PvUvBucket = { pv: number; uv: number };

type DashboardRpcPayload = {
  funnel: FunnelStats;
  inbound_pv_uv: {
    range: PvUvBucket;
    h24: PvUvBucket;
    d7: PvUvBucket;
    d30: PvUvBucket;
    all: PvUvBucket;
  };
};

function parseDashboardPayload(raw: unknown): DashboardRpcPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const funnel = o.funnel;
  const inbound = o.inbound_pv_uv;
  if (!funnel || typeof funnel !== 'object' || !inbound || typeof inbound !== 'object') return null;
  const f = funnel as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  const bucket = (b: unknown): PvUvBucket | null => {
    if (!b || typeof b !== 'object') return null;
    const x = b as Record<string, unknown>;
    return { pv: num(x.pv), uv: num(x.uv) };
  };
  const inboundObj = inbound as Record<string, unknown>;
  const range = bucket(inboundObj.range);
  const h24 = bucket(inboundObj.h24);
  const d7 = bucket(inboundObj.d7);
  const d30 = bucket(inboundObj.d30);
  const all = bucket(inboundObj.all);
  if (!h24 || !d7 || !d30 || !all) return null;
  const rangeFinal = range ?? all;
  return {
    funnel: {
      total: num(f.total),
      awaitingResume: num(f.awaiting_resume),
      awaitingReturningCv: num(f.awaiting_returning_cv),
      awaitingOptIn: num(f.awaiting_opt_in),
      completedNoCv: num(f.completed_no_cv),
      resumeReceived: num(f.resume_received),
      optedIn: num(f.opted_in),
      declined: num(f.declined),
      rmcSuccess: num(f.rmc_success),
      rmcFailed: num(f.rmc_failed),
      rmcSkipped: num(f.rmc_skipped),
    },
    inbound_pv_uv: { range: rangeFinal, h24, d7, d30, all },
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar day → yyyy-mm-dd (for input type="date"). */
function formatDateInputLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateInputLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const da = Number(m[3]);
  const d = new Date(y, mo, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
  return d;
}

function startOfLocalDayFromInput(ymd: string): Date | null {
  const d = parseDateInputLocal(ymd);
  if (!d) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDayFromInput(ymd: string): Date | null {
  const d = parseDateInputLocal(ymd);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Inclusive last N calendar days ending today (local). */
function defaultLastNDaysInclusive(n: number): { start: string; end: string } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));
  return { start: formatDateInputLocal(start), end: formatDateInputLocal(end) };
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

const OPT_IN_LABEL: Record<string, string> = {
  opted_in: 'Opted in',
  declined: 'Declined',
  pending: 'Pending',
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
    return d.toLocaleString('en-US', {
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

// CSV escape shared by the messages exporter.
const csvEscape = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

// Page through a Supabase table to bypass PostgREST's default 1000-row cap.
// We don't accept a `query` callback; pass the table name and the SELECT
// projection, plus an ORDER BY pair to keep paging deterministic.
async function fetchAllPaged<T>(
  table: string,
  selectCols: string,
  orderBy: { column: string; ascending: boolean }[],
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // 50k cap is a safety net so a bad query can't blow up the browser.
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

// Pull every whatsapp_messages row (paged) + minimal conversation context,
// then emit a CSV with one row per message.
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

const EMPTY_FUNNEL: FunnelStats = {
  total: 0,
  awaitingResume: 0,
  awaitingReturningCv: 0,
  awaitingOptIn: 0,
  completedNoCv: 0,
  resumeReceived: 0,
  optedIn: 0,
  declined: 0,
  rmcSuccess: 0,
  rmcFailed: 0,
  rmcSkipped: 0,
};

const TRAFFIC_PERIOD_LABEL: Record<'h24' | 'd7' | 'd30' | 'all', string> = {
  h24: '近 24 小时',
  d7: '近 7 天',
  d30: '近 30 天',
  all: '全部时间',
};

export default function WhatsAppBotPanel() {
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [rangePreset, setRangePreset] = useState<WaRangePreset>('d30');
  const [rangeStartInput, setRangeStartInput] = useState(() => defaultLastNDaysInclusive(30).start);
  const [rangeEndInput, setRangeEndInput] = useState(() => defaultLastNDaysInclusive(30).end);
  const [convPage, setConvPage] = useState(1);
  const [appPage, setAppPage] = useState(1);
  const [selected, setSelected] = useState<ConversationRow | null>(null);
  const [messagesExporting, setMessagesExporting] = useState(false);
  const [messagesExportError, setMessagesExportError] = useState<string | null>(null);
  const [messagesExportInfo, setMessagesExportInfo] = useState<string | null>(null);
  const [convCsvExporting, setConvCsvExporting] = useState(false);
  const [appCsvExporting, setAppCsvExporting] = useState(false);

  const rangeAllTime = rangePreset === 'all';

  const dashboardRpcBounds = useMemo(() => {
    if (rangeAllTime) return { p_from: null as string | null, p_to: null as string | null };
    const s = startOfLocalDayFromInput(rangeStartInput);
    const e = endOfLocalDayFromInput(rangeEndInput);
    if (!s || !e) return { p_from: null as string | null, p_to: null as string | null };
    if (s.getTime() > e.getTime()) {
      const a = startOfLocalDayFromInput(rangeEndInput);
      const b = endOfLocalDayFromInput(rangeStartInput);
      if (!a || !b) return { p_from: null, p_to: null };
      return { p_from: a.toISOString(), p_to: b.toISOString() };
    }
    return { p_from: s.toISOString(), p_to: e.toISOString() };
  }, [rangeAllTime, rangeStartInput, rangeEndInput]);

  const listDateOpts = useMemo(
    () =>
      rangeAllTime
        ? { allTime: true as const, fromIso: null as string | null, toIso: null as string | null }
        : { allTime: false as const, fromIso: dashboardRpcBounds.p_from, toIso: dashboardRpcBounds.p_to },
    [rangeAllTime, dashboardRpcBounds.p_from, dashboardRpcBounds.p_to],
  );

  const applyRangePreset = (preset: WaRangePreset) => {
    setRangePreset(preset);
    if (preset === 'all') return;
    if (preset === 'today') {
      const t = formatDateInputLocal(new Date());
      setRangeStartInput(t);
      setRangeEndInput(t);
      return;
    }
    if (preset === 'd7') {
      const r = defaultLastNDaysInclusive(7);
      setRangeStartInput(r.start);
      setRangeEndInput(r.end);
      return;
    }
    if (preset === 'd30') {
      const r = defaultLastNDaysInclusive(30);
      setRangeStartInput(r.start);
      setRangeEndInput(r.end);
    }
  };

  const rangeSummaryLabel = useMemo(() => {
    if (rangeAllTime) return '全部时间';
    if (rangePreset === 'today') return '今天';
    return `${rangeStartInput} ~ ${rangeEndInput}`;
  }, [rangeAllTime, rangePreset, rangeStartInput, rangeEndInput]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setConvPage(1);
    setAppPage(1);
  }, [searchDebounced, listDateOpts.allTime, listDateOpts.fromIso, listDateOpts.toIso]);

  const handleExportAllMessages = async () => {
    setMessagesExporting(true);
    setMessagesExportError(null);
    setMessagesExportInfo(null);
    try {
      const r = await downloadAllMessagesCsv();
      setMessagesExportInfo(
        `Exported ${r.messages.toLocaleString('en-US')} messages across ${r.conversations.toLocaleString('en-US')} conversations.`,
      );
    } catch (e) {
      setMessagesExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setMessagesExporting(false);
    }
  };

  const dashboardQuery = useQuery({
    queryKey: ['waDashboardStats', rangeAllTime, dashboardRpcBounds.p_from, dashboardRpcBounds.p_to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('whatsapp_admin_dashboard_stats', {
        p_from: dashboardRpcBounds.p_from,
        p_to: dashboardRpcBounds.p_to,
      });
      if (error) throw error;
      const parsed = parseDashboardPayload(data);
      if (!parsed) throw new Error('Invalid dashboard stats payload');
      return parsed;
    },
    refetchInterval: 30_000,
  });

  const conversationsQuery = useQuery({
    queryKey: [
      'waConversations',
      convPage,
      searchDebounced,
      listDateOpts.allTime,
      listDateOpts.fromIso,
      listDateOpts.toIso,
    ],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: ConversationRow[]; total: number }> => {
      const from = (convPage - 1) * CONV_PAGE_SIZE;
      const to = from + CONV_PAGE_SIZE - 1;
      let q = supabase
        .from('whatsapp_conversations')
        .select(WA_CONV_SELECT, { count: 'exact' })
        .order('last_message_at', { ascending: false });
      const orf = buildConversationSearchOr(searchDebounced);
      if (orf) q = q.or(orf);
      if (!listDateOpts.allTime && listDateOpts.fromIso) q = q.gte('last_message_at', listDateOpts.fromIso);
      if (!listDateOpts.allTime && listDateOpts.toIso) q = q.lte('last_message_at', listDateOpts.toIso);
      const { data, error, count } = await q.range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as ConversationRow[], total: count ?? 0 };
    },
    refetchInterval: 30_000,
  });

  const applicationsQuery = useQuery({
    queryKey: ['waApplications', appPage, listDateOpts.allTime, listDateOpts.fromIso, listDateOpts.toIso],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: ApplicationRow[]; total: number }> => {
      const from = (appPage - 1) * APP_PAGE_SIZE;
      const to = from + APP_PAGE_SIZE - 1;
      let q = supabase
        .from('whatsapp_applications')
        .select(
          'id, conversation_id, wa_user_id, rmc_resume_id, job_id, job_title, job_company, reused_existing_cv, opt_in_status, created_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false });
      if (!listDateOpts.allTime && listDateOpts.fromIso) q = q.gte('created_at', listDateOpts.fromIso);
      if (!listDateOpts.allTime && listDateOpts.toIso) q = q.lte('created_at', listDateOpts.toIso);
      const { data, error, count } = await q.range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as ApplicationRow[], total: count ?? 0 };
    },
    refetchInterval: 30_000,
  });

  const messagesQuery = useQuery<MessageRow[]>({
    queryKey: ['waMessages', selected?.id ?? null],
    enabled: !!selected?.id,
    queryFn: async () => {
      if (!selected?.id) return [] as MessageRow[];
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('id, conversation_id, wa_user_id, direction, message_type, body, media_mime, created_at')
        .eq('conversation_id', selected.id)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
  });

  const stats: FunnelStats = dashboardQuery.data?.funnel ?? EMPTY_FUNNEL;
  const traffic = dashboardQuery.data?.inbound_pv_uv;
  const dashboardNeverSucceeded = Boolean(dashboardQuery.isError) && !dashboardQuery.data;

  const convRows = conversationsQuery.data?.rows ?? [];
  const convTotal = conversationsQuery.data?.total ?? 0;
  const convMaxPage = Math.max(1, Math.ceil(convTotal / CONV_PAGE_SIZE));

  const appRows = applicationsQuery.data?.rows ?? [];
  const appTotal = applicationsQuery.data?.total ?? 0;
  const appMaxPage = Math.max(1, Math.ceil(appTotal / APP_PAGE_SIZE));

  useEffect(() => {
    setConvPage((p) => Math.min(Math.max(1, p), convMaxPage));
  }, [convMaxPage]);

  useEffect(() => {
    setAppPage((p) => Math.min(Math.max(1, p), appMaxPage));
  }, [appMaxPage]);

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

  const dashboardErr = dashboardQuery.error ? (dashboardQuery.error as Error).message : null;
  const conversationsErr = conversationsQuery.error ? (conversationsQuery.error as Error).message : null;
  const applicationsErr = applicationsQuery.error ? (applicationsQuery.error as Error).message : null;
  const rpcMissingHint =
    dashboardErr &&
    /whatsapp_admin_dashboard_stats|schema cache|Could not find the function/i.test(dashboardErr);

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
              void dashboardQuery.refetch();
              void conversationsQuery.refetch();
              void applicationsQuery.refetch();
            }}
            disabled={
              dashboardQuery.isFetching ||
              conversationsQuery.isFetching ||
              applicationsQuery.isFetching
            }
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => void handleExportConversationsCsv()}
            disabled={convCsvExporting}
            title="按当前搜索条件导出全部匹配会话（分页拉取，最多约 5 万条）。"
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
            disabled={appCsvExporting || appTotal === 0}
            title="导出全部申请记录（分页拉取，最多约 5 万条）。"
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
            title="Export every WhatsApp message (inbound + outbound) with conversation context."
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
        <div className="bg-card rounded-2xl shadow-sm p-3 text-xs text-muted-foreground">
          {messagesExportInfo}
        </div>
      )}
      {messagesExportError && (
        <div className="bg-card rounded-2xl shadow-sm p-3 text-xs text-destructive">
          Messages export failed: {messagesExportError}
        </div>
      )}

      {dashboardErr && (
        <Alert variant="destructive">
          <AlertTitle>统计接口不可用</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{dashboardErr}</p>
            {rpcMissingHint ? (
              <p className="text-xs opacity-90">
                请在 Supabase 执行仓库内迁移 SQL（含{' '}
                <code className="rounded bg-background/80 px-1 py-0.5">20260516120000_whatsapp_admin_dashboard_stats.sql</code>{' '}
                与{' '}
                <code className="rounded bg-background/80 px-1 py-0.5">20260516140000_whatsapp_admin_dashboard_stats_args.sql</code>
                ），或通过 CLI <code className="rounded bg-background/80 px-1 py-0.5">supabase db push</code> 同步后再刷新。下方列表与导出在多数情况下仍可使用。
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      )}

      {conversationsErr && (
        <Alert variant="destructive">
          <AlertTitle>会话列表加载失败</AlertTitle>
          <AlertDescription>{conversationsErr}</AlertDescription>
        </Alert>
      )}

      {applicationsErr && (
        <Alert variant="destructive">
          <AlertTitle>申请列表加载失败</AlertTitle>
          <AlertDescription>{applicationsErr}</AlertDescription>
        </Alert>
      )}

      <Card className="border-primary/15 shadow-sm">
        <CardHeader className="pb-3 space-y-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <CalendarRange className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <CardTitle className="text-base">时间与范围</CardTitle>
                <CardDescription className="mt-1">
                  上方 PV/UV 按所选日期过滤用户 inbound 消息；会话列表按<strong>最后消息时间</strong>、申请列表按<strong>创建时间</strong>过滤。漏斗卡片为<strong>全库当前快照</strong>。
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

          <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10 p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  所选范围内 · 用户 inbound
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                  PV = 消息条数；UV = 号码去重（wa_user_id 去掉非数字后 DISTINCT）。
                </p>
              </div>
              {dashboardQuery.isFetching && !traffic ? (
                <p className="text-sm text-muted-foreground">加载中…</p>
              ) : traffic && !dashboardErr ? (
                <div className="flex flex-wrap gap-8 lg:gap-12">
                  <div>
                    <div className="text-xs text-muted-foreground">PV</div>
                    <div className="text-4xl sm:text-5xl font-bold tabular-nums tracking-tight text-foreground">
                      {traffic.range.pv.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">UV</div>
                    <div className="text-4xl sm:text-5xl font-bold tabular-nums tracking-tight text-primary">
                      {traffic.range.uv.toLocaleString()}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">部署统计 RPC 后可显示 PV/UV。</p>
              )}
            </div>
            {traffic && !dashboardErr ? (
              <div className="mt-5 pt-4 border-t border-border/80">
                <p className="text-xs font-medium text-muted-foreground mb-2">滚动窗口对比（与上方日期无关）</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['h24', 'd7', 'd30', 'all'] as const).map((key) => {
                    const b = traffic[key];
                    return (
                      <div
                        key={key}
                        className="rounded-xl border border-border/80 bg-card/80 px-3 py-2.5 text-sm"
                      >
                        <div className="text-[11px] font-medium text-muted-foreground">{TRAFFIC_PERIOD_LABEL[key]}</div>
                        <div className="mt-1 flex gap-3 tabular-nums">
                          <span>
                            <span className="text-muted-foreground text-xs">PV </span>
                            <span className="font-semibold">{b.pv.toLocaleString()}</span>
                          </span>
                          <span>
                            <span className="text-muted-foreground text-xs">UV </span>
                            <span className="font-semibold">{b.uv.toLocaleString()}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {dashboardNeverSucceeded ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          漏斗与上方 PV/UV 依赖数据库函数；部署迁移成功后将自动显示。下方会话与申请列表可照常使用。
        </div>
      ) : (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            漏斗快照（全库）
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
            <StatCard label="Conversations" value={stats.total} subtitle="库内全部" />
            <StatCard label="Awaiting Resume" value={stats.awaitingResume} />
            <StatCard label="Existing / New Resume" value={stats.awaitingReturningCv} />
            <StatCard label="Awaiting Highlights Opt-In" value={stats.awaitingOptIn} />
            <StatCard label="Resume Received" value={stats.resumeReceived} subtitle="有简历路径" />
            <StatCard label="Accepted Highlights" value={stats.optedIn} />
            <StatCard label="Declined" value={stats.declined} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mt-2 sm:mt-3">
            <StatCard label="No Resume (Closed)" value={stats.completedNoCv} />
            <StatCard label="RMC OK" value={stats.rmcSuccess} />
            <StatCard label="RMC Error" value={stats.rmcFailed} />
            <StatCard label="RMC Skipped" value={stats.rmcSkipped} subtitle="no config / staging" />
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conversations</CardTitle>
          <CardDescription>
            按最后消息时间倒序；服务端分页（每页 {CONV_PAGE_SIZE} 条）
            {rangeAllTime ? '；未按日期筛选。' : '；仅显示所选日期范围内最后一条消息落在区间内的会话。'}
            点击行查看消息。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-sm w-full">
              <Input
                placeholder="号码、姓名、状态、职位关键词…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-xl"
              />
              {search !== searchDebounced ? (
                <p className="text-xs text-muted-foreground mt-1">正在更新搜索…</p>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              共 {convTotal.toLocaleString()} 条匹配
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">RMC</th>
                  <th className="py-2 pr-3">Last Message</th>
                  <th className="py-2 pr-3">Archived</th>
                </tr>
              </thead>
              <tbody>
                {conversationsQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      Loading...
                    </td>
                  </tr>
                ) : convRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      没有匹配的会话。
                    </td>
                  </tr>
                ) : (
                  convRows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className={`border-b cursor-pointer hover:bg-secondary/60 ${
                        selected?.id === r.id ? 'bg-secondary/80' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{r.wa_user_id}</td>
                      <td className="py-2 pr-3">{r.candidate_name ?? '—'}</td>
                      <td className="py-2 pr-3 max-w-[140px] truncate" title={r.applying_job_title ?? ''}>
                        {r.applying_job_title
                          ? `${r.applying_job_title}${r.applying_job_company ? ` · ${r.applying_job_company}` : ''}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3">{STATE_LABEL[r.state] ?? r.state}</td>
                      <td className="py-2 pr-3">{RMC_LABEL[r.rmc_sync_status ?? 'none'] ?? r.rmc_sync_status}</td>
                      <td className="py-2 pr-3">{formatDate(r.last_message_at)}</td>
                      <td className="py-2 pr-3">{r.archived_at ? 'Yes' : 'No'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
            <span>
              第 {convPage} / {convMaxPage} 页 · 每页 {CONV_PAGE_SIZE} 条
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={convPage <= 1 || conversationsQuery.isFetching}
                onClick={() => setConvPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={convPage >= convMaxPage || conversationsQuery.isFetching || convTotal === 0}
                onClick={() => setConvPage((p) => Math.min(convMaxPage, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Applications (whatsapp_applications)</CardTitle>
          <CardDescription>
            按创建时间倒序；服务端分页（每页 {APP_PAGE_SIZE} 条），共 {appTotal.toLocaleString()} 条。
            {rangeAllTime ? ' 未按日期筛选。' : ' 仅所选日期范围内创建的申请。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">Opt-in</th>
                  <th className="py-2 pr-3">Existing Resume</th>
                </tr>
              </thead>
              <tbody>
                {applicationsQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      Loading...
                    </td>
                  </tr>
                ) : appRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      No applications yet.
                    </td>
                  </tr>
                ) : (
                  appRows.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(a.created_at)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{a.wa_user_id}</td>
                      <td className="py-2 pr-3 max-w-[200px]">
                        {a.job_title || a.job_id || '—'}
                        {a.job_company ? (
                          <span className="text-muted-foreground"> · {a.job_company}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{OPT_IN_LABEL[a.opt_in_status] ?? a.opt_in_status}</td>
                      <td className="py-2 pr-3">{a.reused_existing_cv ? 'Yes' : 'No'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
            <span>
              第 {appPage} / {appMaxPage} 页 · 每页 {APP_PAGE_SIZE} 条
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={appPage <= 1 || applicationsQuery.isFetching}
                onClick={() => setAppPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={appPage >= appMaxPage || applicationsQuery.isFetching || appTotal === 0}
                onClick={() => setAppPage((p) => Math.min(appMaxPage, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Messages — {selected.candidate_name ?? selected.wa_user_id}
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Status: {STATE_LABEL[selected.state] ?? selected.state}</span>
              <span>RMC: {RMC_LABEL[selected.rmc_sync_status ?? 'none']}</span>
              {selected.applying_job_id && (
                <span>
                  Job: {selected.applying_job_title ?? selected.applying_job_id}
                  {selected.applying_job_company ? ` (${selected.applying_job_company})` : ''}
                </span>
              )}
              {selected.rmc_sync_error && (
                <span className="text-destructive">Error: {selected.rmc_sync_error}</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {messagesQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading messages...</div>
            ) : (messagesQuery.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">No messages.</div>
            ) : (
              <div className="space-y-2">
                {messagesQuery.data!.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-xl p-3 text-sm border ${
                      m.direction === 'inbound'
                        ? 'bg-secondary/40'
                        : 'bg-primary/5 border-primary/30'
                    }`}
                  >
                    <div className="text-xs text-muted-foreground mb-1">
                      <span className="font-medium">
                        {m.direction === 'inbound' ? 'User' : 'Bot'}
                      </span>
                      {' · '}
                      <span>{m.message_type}</span>
                      {' · '}
                      <span>{formatDate(m.created_at)}</span>
                    </div>
                    {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                    {!m.body && m.media_mime && (
                      <div className="text-muted-foreground italic">
                        [attachment: {m.media_mime}]
                      </div>
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

function StatCard({
  label,
  value,
  subtitle,
  className,
}: {
  label: string;
  value: number;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn('bg-card rounded-2xl shadow-sm p-4 border border-border', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value.toLocaleString('en-US')}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}
