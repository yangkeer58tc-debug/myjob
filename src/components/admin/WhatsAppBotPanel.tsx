import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Loader2, RefreshCw } from 'lucide-react';

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

export default function WhatsAppBotPanel() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ConversationRow | null>(null);
  const [messagesExporting, setMessagesExporting] = useState(false);
  const [messagesExportError, setMessagesExportError] = useState<string | null>(null);
  const [messagesExportInfo, setMessagesExportInfo] = useState<string | null>(null);

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

  const conversationsQuery = useQuery<ConversationRow[]>({
    queryKey: ['waConversations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select(
          'id, wa_user_id, state, candidate_name, rmc_sync_status, rmc_sync_error, opt_in_clarify_count, last_resume_storage_path, resume_storage_path, last_resume_received_at, completed_at, archived_at, created_at, last_message_at, applying_job_id, applying_job_title, applying_job_company',
        )
        .order('last_message_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
    },
    refetchInterval: 30_000,
  });

  const applicationsQuery = useQuery<ApplicationRow[]>({
    queryKey: ['waApplications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_applications')
        .select(
          'id, conversation_id, wa_user_id, rmc_resume_id, job_id, job_title, job_company, reused_existing_cv, opt_in_status, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
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

  const stats: FunnelStats = useMemo(() => {
    const rows = conversationsQuery.data ?? [];
    const stats: FunnelStats = {
      total: rows.length,
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
    for (const r of rows) {
      if (r.state === 'awaiting_resume' || r.state === 'awaiting_name') stats.awaitingResume += 1;
      if (r.state === 'awaiting_returning_cv_choice') stats.awaitingReturningCv += 1;
      if (r.state === 'awaiting_opt_in') stats.awaitingOptIn += 1;
      if (r.state === 'completed_no_cv') stats.completedNoCv += 1;
      if (r.last_resume_storage_path || r.resume_storage_path) stats.resumeReceived += 1;
      if (r.state === 'completed_opt_in') stats.optedIn += 1;
      if (r.state === 'completed_declined') stats.declined += 1;
      if (r.rmc_sync_status === 'success') stats.rmcSuccess += 1;
      if (r.rmc_sync_status === 'failed') stats.rmcFailed += 1;
      if (r.rmc_sync_status === 'skipped_no_config' || r.rmc_sync_status === 'skipped_staging') {
        stats.rmcSkipped += 1;
      }
    }
    return stats;
  }, [conversationsQuery.data]);

  const filteredRows = useMemo(() => {
    const rows = conversationsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const fields = [
        r.wa_user_id,
        r.candidate_name ?? '',
        r.state,
        r.rmc_sync_status ?? '',
        r.applying_job_id ?? '',
        r.applying_job_title ?? '',
        r.applying_job_company ?? '',
      ]
        .map((s) => String(s).toLowerCase());
      return fields.some((f) => f.includes(q));
    });
  }, [conversationsQuery.data, search]);

  const errorMsg = conversationsQuery.error
    ? (conversationsQuery.error as Error).message
    : null;

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
              void conversationsQuery.refetch();
              void applicationsQuery.refetch();
            }}
            disabled={conversationsQuery.isFetching || applicationsQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => downloadCsv(filteredRows)}
            disabled={filteredRows.length === 0}
          >
            <Download className="h-4 w-4 mr-1" /> CSV conv.
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => downloadApplicationsCsv(applicationsQuery.data ?? [])}
            disabled={(applicationsQuery.data?.length ?? 0) === 0}
          >
            <Download className="h-4 w-4 mr-1" /> Applications CSV
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

      {errorMsg && (
        <div className="bg-card rounded-2xl shadow-sm p-4 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Conversations" value={stats.total} subtitle="latest 500" />
        <StatCard label="Awaiting Resume" value={stats.awaitingResume} />
        <StatCard label="Existing / New Resume" value={stats.awaitingReturningCv} />
        <StatCard label="Awaiting Highlights Opt-In" value={stats.awaitingOptIn} />
        <StatCard label="Resume Received" value={stats.resumeReceived} subtitle="cumulative" />
        <StatCard label="Accepted Highlights" value={stats.optedIn} />
        <StatCard label="Declined" value={stats.declined} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="No Resume (Closed)" value={stats.completedNoCv} />
        <StatCard label="RMC OK" value={stats.rmcSuccess} />
        <StatCard label="RMC Error" value={stats.rmcFailed} />
        <StatCard label="RMC Skipped" value={stats.rmcSkipped} subtitle="no config / staging" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conversations</CardTitle>
          <CardDescription>
            Most recent first. Click a row to view messages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Input
              placeholder="Search by number, name, or status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
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
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No conversations yet.</td></tr>
                ) : (
                  filteredRows.map((r) => (
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Applications (whatsapp_applications)</CardTitle>
          <CardDescription>Latest 300 applications recorded by the bot.</CardDescription>
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
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : (applicationsQuery.data?.length ?? 0) === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No applications yet.</td></tr>
                ) : (
                  applicationsQuery.data!.map((a) => (
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
}: {
  label: string;
  value: number;
  subtitle?: string;
}) {
  return (
    <div className="bg-card rounded-2xl shadow-sm p-4 border border-border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString('en-US')}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}
