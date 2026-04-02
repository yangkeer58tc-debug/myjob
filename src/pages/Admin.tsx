import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { LogOut, Plus, Pencil, Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { Session } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { parseHighlights } from '@/lib/highlightUtils';
import { normalizeJobTextFields } from '@/lib/jobTextUtils';
import {
  CATEGORY_OPTIONS,
  CITY_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  EXPERIENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  PAYMENT_FREQUENCY_OPTIONS,
  WORKPLACE_TYPE_OPTIONS,
  normalizeOptionId,
} from '@/lib/jobOptions';

interface JobForm {
  id: string;
  b_name: string;
  b_logo_url: string;
  title: string;
  category: string;
  salary_amount: string;
  payment_frequency: string;
  location: string;
  job_type: string;
  workplace_type: string;
  summary: string;
  description: string;
  requirements: string;
  highlights: string;
  education_level?: string;
  industry?: string;
  language_req?: string;
  experience?: string;
  is_active: boolean;
}

const simplifyText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const levenshteinDistance = (a: string, b: string) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
};

const normalizeCity = (value: string) => {
  const s = simplifyText(value);
  const exact = CITY_OPTIONS.find((m) => simplifyText(m.label) === s || simplifyText(m.id) === s);
  if (exact) return exact.label;

  let best: { label: string; dist: number } | null = null;
  for (const m of CITY_OPTIONS) {
    const dist = levenshteinDistance(s, simplifyText(m.label));
    if (!best || dist < best.dist) best = { label: m.label, dist };
  }
  if (best && best.dist <= 2) return best.label;
  return value;
};

const parseBoolean = (value: unknown, defaultValue: boolean) => {
  if (value === null || value === undefined) return defaultValue;
  const raw = String(value).trim();
  if (!raw) return defaultValue;
  const s = raw.toLowerCase();
  if (['true', '1', 'yes', 'y', 'sim'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'nao', 'não'].includes(s)) return false;
  return defaultValue;
};

const normalizeSalaryInput = (value: string) => {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;
  const numeric = raw.replace(/\s/g, '').replace(/,/g, '.');
  if (/^-?\d+(\.\d+)?$/.test(numeric)) return numeric;
  return raw;
};

const decodeCsvFile = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const decode = (encoding: string) => new TextDecoder(encoding, { fatal: false }).decode(buffer);
  const hasManyNulls = (text: string) => {
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0) n++;
    return n > 10;
  };

  const hasBomUtf8 = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const hasBomUtf16le = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  const hasBomUtf16be = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;

  if (hasBomUtf16le) return decode('utf-16le');
  if (hasBomUtf16be) return decode('utf-16be');
  if (hasBomUtf8) return decode('utf-8');

  const utf8 = decode('utf-8');
  if (!utf8.includes('\uFFFD') && !hasManyNulls(utf8)) return utf8;

  const utf16le = decode('utf-16le');
  if (!utf16le.includes('\uFFFD') && !hasManyNulls(utf16le)) return utf16le;

  const win1252 = decode('windows-1252');
  if (!win1252.includes('\uFFFD')) return win1252;

  try {
    const latin1 = decode('iso-8859-1');
    if (!latin1.includes('\uFFFD')) return latin1;
    return latin1;
  } catch {
    return win1252;
  }
};

const emptyForm: JobForm = {
  id: '',
  b_name: '',
  b_logo_url: '',
  title: '',
  category: '',
  salary_amount: '',
  payment_frequency: 'Mensal',
  location: '',
  job_type: 'Tempo Integral',
  workplace_type: 'Presencial',
  summary: '',
  description: '',
  requirements: '',
  highlights: '',
  education_level: '',
  industry: '',
  language_req: '',
  experience: '',
  is_active: true,
};

const LOGO_URL = 'https://i.postimg.cc/VLyx9gfK/Gemini-Generated-Image-eiv43beiv43beiv4-(2).png';

const Admin = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState<JobForm | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
  };

  const handleLogout = () => supabase.auth.signOut();

  const { data: jobs, isLoading, error: jobsError } = useQuery({
    queryKey: ['adminJobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  const saveMutation = useMutation({
    mutationFn: async (form: JobForm) => {
      const normalizedText = normalizeJobTextFields({
        summary: form.summary,
        description: form.description,
        requirements: form.requirements,
      });
      const payload = {
        id: form.id,
        b_name: form.b_name,
        b_logo_url: form.b_logo_url || null,
        title: form.title,
        category: normalizeOptionId(form.category, CATEGORY_OPTIONS) || null,
        salary_amount: form.salary_amount,
        payment_frequency: normalizeOptionId(form.payment_frequency, PAYMENT_FREQUENCY_OPTIONS) || form.payment_frequency,
        location: normalizeCity(form.location),
        job_type: normalizeOptionId(form.job_type, JOB_TYPE_OPTIONS) || form.job_type,
        workplace_type: normalizeOptionId(form.workplace_type, WORKPLACE_TYPE_OPTIONS) || form.workplace_type,
        summary: normalizedText.summary,
        description: normalizedText.description,
        requirements: normalizedText.requirements,
        highlights: form.highlights ? parseHighlights(form.highlights) : null,
        education_level: normalizeOptionId(form.education_level, EDUCATION_LEVEL_OPTIONS) || null,
        industry: form.industry || null,
        language_req: form.language_req || null,
        experience: normalizeOptionId(form.experience, EXPERIENCE_OPTIONS) || null,
        is_active: form.is_active,
      };

      const { error } = await supabase.from('jobs').upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      setShowForm(false);
      setEditing(null);
      toast.success('Guardado');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('jobs').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminJobs'] }),
  });

  const activateAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('jobs').update({ is_active: true }).neq('is_active', true);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      toast.success('Todas as vagas foram ativadas');
    },
    onError: (err: any) => toast.error(err.message),
  });

  useEffect(() => {
    if (!session) return;
    const key = 'myjob_auto_activated_v1';
    if (localStorage.getItem(key) === '1') return;
    activateAllMutation.mutate();
    localStorage.setItem(key, '1');
  }, [session, activateAllMutation]);

  useEffect(() => {
    if (!session) return;
    const key = 'myjob_fixed_locations_v2';
    if (localStorage.getItem(key) === '1') return;

    (async () => {
      try {
        const { data, error } = await supabase.from('jobs').select('id, location');
        if (error) throw error;
        const changed = (data || [])
          .map((row) => ({
            id: row.id,
            before: row.location || '',
            after: normalizeCity(row.location || ''),
          }))
          .filter((row) => row.after && row.after !== row.before)
          .map((row) => ({ id: row.id, location: row.after }));
        if (changed.length > 0) {
          const { error: upsertError } = await supabase.from('jobs').upsert(changed);
          if (upsertError) throw upsertError;
          queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
        }
      } catch {}
      localStorage.setItem(key, '1');
    })();
  }, [session, queryClient]);

  useEffect(() => {
    if (!session) return;
    const key = 'myjob_fixed_text_fields_v5';
    if (localStorage.getItem(key) === '1') return;

    (async () => {
      try {
        const { data, error } = await supabase.from('jobs').select('id, summary, description, requirements');
        if (error) throw error;
        const changed = (data || [])
          .map((row) => {
            const normalized = normalizeJobTextFields({
              summary: row.summary,
              description: row.description,
              requirements: row.requirements,
            });
            return {
              id: row.id,
              before: {
                summary: row.summary || null,
                description: row.description || null,
                requirements: row.requirements || null,
              },
              after: normalized,
            };
          })
          .filter(
            (row) =>
              row.after.summary !== row.before.summary ||
              row.after.description !== row.before.description ||
              row.after.requirements !== row.before.requirements,
          )
          .map((row) => ({ id: row.id, ...row.after }));

        if (changed.length > 0) {
          const { error: upsertError } = await supabase.from('jobs').upsert(changed);
          if (upsertError) throw upsertError;
          queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
        }
      } catch {}

      localStorage.setItem(key, '1');
    })();
  }, [session, queryClient]);

  const deleteAllJobsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('jobs').delete().neq('id', '');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      toast.success('Todas as vagas foram excluídas');
    },
    onError: (err: any) => {
      const msg = String(err?.message || err || '');
      if (msg.toLowerCase().includes('row level security') || msg.toLowerCase().includes('row-level security')) {
        toast.error('权限不足：需要在 Supabase 给 authenticated 增加 jobs 的 DELETE policy');
        return;
      }
      toast.error(msg);
    },
  });

  if (!session) {
    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center">
        <form onSubmit={handleLogin} className="bg-card rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-foreground text-center">{t('admin.login')}</h1>
          <div>
            <Label>{t('admin.email')}</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="rounded-xl mt-1" />
          </div>
          <div>
            <Label>{t('admin.password')}</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="rounded-xl mt-1" />
          </div>
          <Button type="submit" className="w-full rounded-xl">{t('admin.login')}</Button>
        </form>
      </div>
    );
  }

  const openEdit = (job: typeof jobs extends (infer T)[] ? T : never) => {
    setEditing({
      id: job.id,
      b_name: job.b_name,
      b_logo_url: job.b_logo_url || '',
      title: job.title,
      category: job.category || '',
      salary_amount: job.salary_amount,
      payment_frequency: job.payment_frequency,
      location: job.location,
      job_type: job.job_type,
      workplace_type: job.workplace_type,
      summary: job.summary || '',
      description: job.description || '',
      requirements: job.requirements || '',
      highlights: job.highlights?.join(', ') || '',
      education_level: job.education_level || '',
      industry: job.industry || '',
      language_req: job.language_req || '',
      experience: job.experience || '',
      is_active: Boolean(job.is_active),
    });
    setShowForm(true);
  };

  const openNew = () => {
    setEditing({ ...emptyForm, id: `job-${Date.now()}` });
    setShowForm(true);
  };

  const downloadTemplate = () => {
    const template = [
      ['id', 'b_name', 'b_logo_url', 'title', 'category', 'location', 'salary_amount', 'payment_frequency', 'job_type', 'workplace_type', 'summary', 'description', 'requirements', 'highlights', 'education_level', 'experience', 'industry', 'language_req', 'is_active'],
      ['job-exemplo', 'MyJob', LOGO_URL, 'Atendente de Call Center', 'call-center-customer-service', 'sao-paulo', '2200', 'mensal', 'tempo-integral', 'presencial', 'Atendimento ao cliente via telefone e WhatsApp.', 'Descreva a vaga em texto puro. Inclua como se candidatar pelo WhatsApp.', 'Boa comunicação; disponibilidade de horário.', 'Vale-transporte, Vale-refeição', 'medio', 'sem-experiencia', 'Serviços', 'Português', 'TRUE']
    ];
    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'myjob_imc_template_br.csv';
    link.click();
  };

  const downloadOptionsCsv = () => {
    const rows: Array<[string, string, string]> = [['field', 'id', 'label']];
    CATEGORY_OPTIONS.forEach((o) => rows.push(['category', o.id, o.label]));
    CITY_OPTIONS.forEach((o) => rows.push(['location', o.id, o.label]));
    JOB_TYPE_OPTIONS.forEach((o) => rows.push(['job_type', o.id, o.label]));
    WORKPLACE_TYPE_OPTIONS.forEach((o) => rows.push(['workplace_type', o.id, o.label]));
    EDUCATION_LEVEL_OPTIONS.forEach((o) => rows.push(['education_level', o.id, o.label]));
    EXPERIENCE_OPTIONS.forEach((o) => rows.push(['experience', o.id, o.label]));
    PAYMENT_FREQUENCY_OPTIONS.forEach((o) => rows.push(['payment_frequency', o.id, o.label]));

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'myjob_options.csv';
    link.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    (async () => {
      try {
        const text = await decodeCsvFile(file);
        const results = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
        if (results.errors?.length) {
          const msg = results.errors[0]?.message || 'CSV inválido';
          throw new Error(msg);
        }

        const rows = (results.data || []).filter((r) => Object.values(r || {}).some((v) => String(v ?? '').trim() !== ''));
        const payload = rows.map((row) => {
          const locationRaw = row.location || 'Brasil';
          const location = normalizeCity(locationRaw);
          const bLogo = row.b_logo_url ? row.b_logo_url : LOGO_URL;
          const normalizedText = normalizeJobTextFields({
            summary: row.summary || null,
            description: row.description || null,
            requirements: row.requirements || null,
          });
          return {
            id: row.id || `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            b_name: row.b_name || 'MyJob',
            b_logo_url: bLogo || null,
            title: row.title || 'Sem título',
            category: row.category ? normalizeOptionId(row.category, CATEGORY_OPTIONS) : null,
            location,
            salary_amount: row.salary_amount ? normalizeSalaryInput(row.salary_amount) : 'A combinar',
            payment_frequency: row.payment_frequency ? normalizeOptionId(row.payment_frequency, PAYMENT_FREQUENCY_OPTIONS) : 'mensal',
            job_type: row.job_type ? normalizeOptionId(row.job_type, JOB_TYPE_OPTIONS) : 'tempo-integral',
            workplace_type: row.workplace_type ? normalizeOptionId(row.workplace_type, WORKPLACE_TYPE_OPTIONS) : 'presencial',
            summary: normalizedText.summary,
            description: normalizedText.description,
            requirements: normalizedText.requirements,
            highlights: row.highlights ? parseHighlights(row.highlights) : null,
            education_level: row.education_level ? normalizeOptionId(row.education_level, EDUCATION_LEVEL_OPTIONS) : null,
            industry: row.industry || null,
            language_req: row.language_req || null,
            experience: row.experience ? normalizeOptionId(row.experience, EXPERIENCE_OPTIONS) : null,
            is_active: parseBoolean(row.is_active, true),
          };
        });

        const { error } = await supabase.from('jobs').upsert(payload);
        if (error) throw error;

        toast.success(`Importadas ${payload.length} vagas com sucesso.`);
        queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      } catch (err: any) {
        toast.error(`Erro ao importar: ${err.message}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    })();
  };

  return (
    <div className="min-h-screen bg-secondary">
      <div className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">{t('admin.title')}</h1>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-1" /> {t('admin.logout')}
        </Button>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {jobsError && (
          <div className="bg-card rounded-2xl shadow-sm p-4 mb-4 text-sm text-destructive">
            {(jobsError as Error).message}
          </div>
        )}
        {showForm && editing ? (
          <div className="bg-card rounded-2xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">{editing.id.startsWith('job-') ? t('admin.addJob') : t('admin.editJob')}</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div><Label>ID</Label><Input value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Título</Label><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Empresa</Label><Input value={editing.b_name} onChange={(e) => setEditing({ ...editing, b_name: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Logo URL</Label><Input value={editing.b_logo_url} onChange={(e) => setEditing({ ...editing, b_logo_url: e.target.value })} className="rounded-xl mt-1" /></div>
              <div>
                <Label>Categoria</Label>
                <Input list="category-options" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="rounded-xl mt-1" />
                <datalist id="category-options">
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </datalist>
              </div>
              <div><Label>Salario</Label><Input value={editing.salary_amount} onChange={(e) => setEditing({ ...editing, salary_amount: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Frecuencia</Label><Input value={editing.payment_frequency} onChange={(e) => setEditing({ ...editing, payment_frequency: e.target.value })} className="rounded-xl mt-1" /></div>
              <div>
                <Label>Cidade</Label>
                <Input list="city-options" value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} className="rounded-xl mt-1" />
                <datalist id="city-options">
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </datalist>
              </div>
              <div><Label>Tipo de empleo</Label><Input value={editing.job_type} onChange={(e) => setEditing({ ...editing, job_type: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Modalidad</Label><Input value={editing.workplace_type} onChange={(e) => setEditing({ ...editing, workplace_type: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Highlights (separados por coma)</Label><Input value={editing.highlights} onChange={(e) => setEditing({ ...editing, highlights: e.target.value })} className="rounded-xl mt-1" /></div>
            </div>
            <div><Label>Resumen</Label><Textarea value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} className="rounded-xl mt-1" rows={2} /></div>
            <div><Label>Descripción</Label><Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="rounded-xl mt-1" rows={5} /></div>
            <div><Label>Requisitos</Label><Textarea value={editing.requirements} onChange={(e) => setEditing({ ...editing, requirements: e.target.value })} className="rounded-xl mt-1" rows={3} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              <Label>Activo</Label>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => saveMutation.mutate(editing)} className="rounded-xl">{t('admin.save')}</Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-xl">{t('admin.cancel')}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadTemplate} className="rounded-xl">
                  <Download className="h-4 w-4 mr-2" /> Template CSV
                </Button>
                <Button variant="outline" onClick={downloadOptionsCsv} className="rounded-xl">
                  <Download className="h-4 w-4 mr-2" /> Options CSV
                </Button>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()} className="rounded-xl">
                  <Upload className="h-4 w-4 mr-2" /> Importar CSV
                </Button>
                <Button
                  variant="destructive"
                  className="rounded-xl"
                  disabled={deleteAllJobsMutation.isPending}
                  onClick={() => {
                    const v = window.prompt('输入 DELETE 确认清空所有帖子');
                    if (v !== 'DELETE') return;
                    deleteAllJobsMutation.mutate();
                  }}
                >
                  清空全部帖子
                </Button>
              </div>
              <Button onClick={openNew} className="rounded-xl">
                <Plus className="h-4 w-4 mr-1" /> {t('admin.addJob')}
              </Button>
            </div>
            <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Título</th>
                    <th className="text-left px-4 py-3 font-medium">Empresa</th>
                    <th className="text-left px-4 py-3 font-medium">Ciudad</th>
                    <th className="text-left px-4 py-3 font-medium">Activo</th>
                    <th className="text-left px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        Carregando...
                      </td>
                    </tr>
                  )}
                  {jobs?.map((job) => (
                    <tr key={job.id} className="border-t border-border">
                      <td className="px-4 py-3 font-mono text-xs">{job.id}</td>
                      <td className="px-4 py-3 font-medium">{job.title}</td>
                      <td className="px-4 py-3">{job.b_name}</td>
                      <td className="px-4 py-3">{job.location}</td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={Boolean(job.is_active)}
                          onCheckedChange={(v) => toggleActive.mutate({ id: job.id, is_active: v })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(job)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(!jobs || jobs.length === 0) && !isLoading && (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma vaga</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Admin;
