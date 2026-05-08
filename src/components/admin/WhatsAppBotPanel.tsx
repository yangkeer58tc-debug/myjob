import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, RefreshCw } from 'lucide-react';

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
  awaitingName: number;
  awaitingResume: number;
  awaitingOptIn: number;
  resumeReceived: number;
  optedIn: number;
  declined: number;
  rmcSuccess: number;
  rmcFailed: number;
  rmcSkipped: number;
};

const STATE_LABEL: Record<string, string> = {
  new: 'Nueva',
  awaiting_name: 'Esperando nombre',
  awaiting_resume: 'Esperando CV',
  awaiting_opt_in: 'Esperando Si/No',
  completed_opt_in: 'Aceptado destacados',
  completed_declined: 'Rechazado / sin Si',
};

const RMC_LABEL: Record<string, string> = {
  none: '—',
  pending: 'Pendiente',
  success: 'OK',
  failed: 'Error',
  skipped_no_config: 'Saltado (sin RMC)',
  skipped_staging: 'Saltado (staging)',
};

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-MX', {
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

export default function WhatsAppBotPanel() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ConversationRow | null>(null);

  const conversationsQuery = useQuery<ConversationRow[]>({
    queryKey: ['waConversations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select(
          'id, wa_user_id, state, candidate_name, rmc_sync_status, rmc_sync_error, opt_in_clarify_count, last_resume_storage_path, resume_storage_path, last_resume_received_at, completed_at, archived_at, created_at, last_message_at',
        )
        .order('last_message_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
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
      awaitingName: 0,
      awaitingResume: 0,
      awaitingOptIn: 0,
      resumeReceived: 0,
      optedIn: 0,
      declined: 0,
      rmcSuccess: 0,
      rmcFailed: 0,
      rmcSkipped: 0,
    };
    for (const r of rows) {
      if (r.state === 'awaiting_name') stats.awaitingName += 1;
      if (r.state === 'awaiting_resume') stats.awaitingResume += 1;
      if (r.state === 'awaiting_opt_in') stats.awaitingOptIn += 1;
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
      const fields = [r.wa_user_id, r.candidate_name ?? '', r.state, r.rmc_sync_status ?? '']
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
        <h2 className="text-lg font-semibold">Bot de WhatsApp</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => conversationsQuery.refetch()}
            disabled={conversationsQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refrescar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => downloadCsv(filteredRows)}
            disabled={filteredRows.length === 0}
          >
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-card rounded-2xl shadow-sm p-4 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Conversaciones" value={stats.total} subtitle="últimas 500" />
        <StatCard label="Esperando nombre" value={stats.awaitingName} />
        <StatCard label="Esperando CV" value={stats.awaitingResume} />
        <StatCard label="CV recibido" value={stats.resumeReceived} subtitle="acumulado" />
        <StatCard label="Aceptaron destacados" value={stats.optedIn} />
        <StatCard label="Rechazaron" value={stats.declined} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="RMC OK" value={stats.rmcSuccess} />
        <StatCard label="RMC Error" value={stats.rmcFailed} />
        <StatCard label="RMC Saltado" value={stats.rmcSkipped} subtitle="sin config / staging" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conversaciones</CardTitle>
          <CardDescription>
            Las más recientes primero. Toca una fila para ver los mensajes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Input
              placeholder="Buscar por número, nombre, estado…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                  <th className="py-2 pr-3">Número</th>
                  <th className="py-2 pr-3">Nombre</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">RMC</th>
                  <th className="py-2 pr-3">Último mensaje</th>
                  <th className="py-2 pr-3">Archivada</th>
                </tr>
              </thead>
              <tbody>
                {conversationsQuery.isLoading ? (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Cargando…</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Sin conversaciones todavía.</td></tr>
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
                      <td className="py-2 pr-3">{STATE_LABEL[r.state] ?? r.state}</td>
                      <td className="py-2 pr-3">{RMC_LABEL[r.rmc_sync_status ?? 'none'] ?? r.rmc_sync_status}</td>
                      <td className="py-2 pr-3">{formatDate(r.last_message_at)}</td>
                      <td className="py-2 pr-3">{r.archived_at ? 'Sí' : 'No'}</td>
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
              Mensajes — {selected.candidate_name ?? selected.wa_user_id}
            </CardTitle>
            <CardDescription className="space-x-3">
              <span>Estado: {STATE_LABEL[selected.state] ?? selected.state}</span>
              <span>RMC: {RMC_LABEL[selected.rmc_sync_status ?? 'none']}</span>
              {selected.rmc_sync_error && (
                <span className="text-destructive">Error: {selected.rmc_sync_error}</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {messagesQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Cargando mensajes…</div>
            ) : (messagesQuery.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">Sin mensajes.</div>
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
                        {m.direction === 'inbound' ? 'Usuario' : 'Bot'}
                      </span>
                      {' · '}
                      <span>{m.message_type}</span>
                      {' · '}
                      <span>{formatDate(m.created_at)}</span>
                    </div>
                    {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                    {!m.body && m.media_mime && (
                      <div className="text-muted-foreground italic">
                        [adjunto: {m.media_mime}]
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
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString('es-MX')}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}
