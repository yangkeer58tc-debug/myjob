import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { LogOut, Plus, Pencil, Upload, Download, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import type { Session } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { parseHighlights } from '@/lib/highlightUtils';
import { extractCompanyNameFromJd, extractSalaryFromJd, isPlaceholderEmployerName } from '@/lib/jdExtract';
import { estimatedMonthlyMxnForJob } from '@/lib/mxSalaryFallback';
import { isPlaceholderSalaryText } from '@/lib/salaryUtils';
import { fixJobTextArtifacts, normalizeCompanyName, normalizeJobTextFields, normalizeJobTitle } from '@/lib/jobTextUtils';
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
import {
  isImcExportCsv,
  mergeImcColumnsIntoClassicRow,
  normalizeCsvRecordKeys,
} from '@/lib/imcCsvImport';
import {
  fallbackHighlightsFromDescription,
  generateJobSummaryAndHighlights,
  hasJobAiConfig,
} from '@/lib/jobSummaryAi';
import { normalizeIndustryLabelForMexico } from '@/lib/industryEsMx';
import { jobImportAiConcurrency, jobImportUpsertOnlyConcurrency, runPool } from '@/lib/jobImportPool';
import {
  collectFirstEmployerLogoRaw,
  looksLikeCompanyLogoUrl,
  normalizeImportedEmployerLogoUrl,
  stripCsvCellDecorations,
} from '@/lib/jobLogoUrl';

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

const ADMIN_JOBS_PAGE_SIZE = 25;

type JobCsvPayloadRow = {
  id: string;
  b_name: string;
  b_logo_url: string | null;
  title: string;
  category: string | null;
  location: string;
  salary_amount: string;
  payment_frequency: string;
  job_type: string;
  workplace_type: string;
  summary: string | null;
  description: string | null;
  requirements: string | null;
  highlights: string[] | null;
  education_level: string | null;
  industry: string | null;
  language_req: string | null;
  experience: string | null;
  is_active: boolean;
};

function buildJobsPayloadFromCsvRows(rowsForImport: Record<string, string>[]): JobCsvPayloadRow[] {
  return rowsForImport.map((row) => {
    const locationRaw = row.location || 'Brasil';
    const location = normalizeCity(locationRaw);
    const authorPro = stripCsvCellDecorations(row.author_profile ?? row.author_pro ?? '');
    const logoRaw =
      collectFirstEmployerLogoRaw(row) ||
      (authorPro && looksLikeCompanyLogoUrl(authorPro) ? authorPro : '');
    const b_logo_url = normalizeImportedEmployerLogoUrl(logoRaw);
    const normalizedText = normalizeJobTextFields({
      summary: row.summary || null,
      description: row.description || null,
      requirements: row.requirements || null,
    });
    const jdBlob = [normalizedText.summary, normalizedText.description, normalizedText.requirements]
      .filter(Boolean)
      .join('\n\n');
    const titleNorm = normalizeJobTitle(
      stripCsvCellDecorations(row.title || row.job_title || '') || 'Sem título',
    );
    const categoryNorm = row.category ? normalizeOptionId(row.category, CATEGORY_OPTIONS) : null;

    let b_name = normalizeCompanyName(stripCsvCellDecorations(row.b_name || row.company || ''));
    if (!b_name || isPlaceholderEmployerName(b_name)) {
      const fromJd = extractCompanyNameFromJd(titleNorm, jdBlob);
      if (fromJd) b_name = normalizeCompanyName(fromJd);
    }
    if (!b_name || isPlaceholderEmployerName(b_name)) b_name = 'MyJob';

    let salary_amount = row.salary_amount ? normalizeSalaryInput(row.salary_amount) : '';
    let payment_frequency = row.payment_frequency
      ? normalizeOptionId(row.payment_frequency, PAYMENT_FREQUENCY_OPTIONS)
      : 'mensal';

    if (!salary_amount.trim() || isPlaceholderSalaryText(salary_amount)) {
      const ex = extractSalaryFromJd(jdBlob);
      if (ex) {
        salary_amount = normalizeSalaryInput(ex.amount);
        payment_frequency = ex.payment_frequency;
      } else {
        const est = estimatedMonthlyMxnForJob(categoryNorm, titleNorm, location);
        salary_amount = est.salary_amount;
        payment_frequency = est.payment_frequency;
      }
    }

    return {
      id: row.id || `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      b_name,
      b_logo_url,
      title: titleNorm,
      category: categoryNorm,
      location,
      salary_amount,
      payment_frequency,
      job_type: row.job_type ? normalizeOptionId(row.job_type, JOB_TYPE_OPTIONS) : 'tempo-integral',
      workplace_type: row.workplace_type ? normalizeOptionId(row.workplace_type, WORKPLACE_TYPE_OPTIONS) : 'presencial',
      summary: normalizedText.summary,
      description: normalizedText.description,
      requirements: normalizedText.requirements,
      highlights: row.highlights ? parseHighlights(row.highlights) : null,
      education_level: row.education_level ? normalizeOptionId(row.education_level, EDUCATION_LEVEL_OPTIONS) : null,
      industry: row.industry ? normalizeIndustryLabelForMexico(row.industry) : null,
      language_req: row.language_req || null,
      experience: row.experience ? normalizeOptionId(row.experience, EXPERIENCE_OPTIONS) : null,
      is_active: parseBoolean(row.is_active, true),
    };
  });
}

type JobImportProgressState = {
  isRunning: boolean;
  total: number;
  saved: number;
  failed: number;
  paused?: boolean;
  lastTitle?: string;
  lastError?: string;
};

const Admin = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState<JobForm | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'jobs' | 'candidates'>('jobs');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const candidateFileInputRef = useRef<HTMLInputElement>(null);
  const [jobImportProgress, setJobImportProgress] = useState<JobImportProgressState | null>(null);
  const jobImportPauseRef = useRef(false);
  const [adminJobsPage, setAdminJobsPage] = useState(1);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

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

  const adminJobsMaxPage = Math.max(1, Math.ceil((jobs?.length ?? 0) / ADMIN_JOBS_PAGE_SIZE));

  const jobsPageItems = useMemo(() => {
    if (!jobs?.length) return [];
    const start = (adminJobsPage - 1) * ADMIN_JOBS_PAGE_SIZE;
    return jobs.slice(start, start + ADMIN_JOBS_PAGE_SIZE);
  }, [jobs, adminJobsPage]);

  const adminPageJobIds = useMemo(() => jobsPageItems.map((j) => j.id), [jobsPageItems]);
  const selectedOnPageCount = useMemo(
    () => adminPageJobIds.filter((id) => selectedJobIds.includes(id)).length,
    [adminPageJobIds, selectedJobIds],
  );
  const allPageSelected = adminPageJobIds.length > 0 && selectedOnPageCount === adminPageJobIds.length;
  const somePageSelected = selectedOnPageCount > 0 && !allPageSelected;

  useEffect(() => {
    if (adminJobsPage > adminJobsMaxPage) setAdminJobsPage(adminJobsMaxPage);
  }, [adminJobsPage, adminJobsMaxPage]);

  const { data: candidates, isLoading: candidatesLoading, error: candidatesError } = useQuery({
    queryKey: ['adminCandidates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
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
        b_name: normalizeCompanyName(form.b_name),
        b_logo_url: normalizeImportedEmployerLogoUrl(form.b_logo_url),
        title: normalizeJobTitle(form.title),
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
        industry: form.industry ? normalizeIndustryLabelForMexico(form.industry) : null,
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

  const chunkArray = <T,>(arr: T[], size: number): T[][] => {
    if (!arr.length) return [];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const batchJobsActiveMutation = useMutation({
    mutationFn: async ({ ids, is_active }: { ids: string[]; is_active: boolean }) => {
      if (!ids.length) return;
      for (const part of chunkArray(ids, 200)) {
        const { error } = await supabase.from('jobs').update({ is_active }).in('id', part);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      setSelectedJobIds([]);
      toast.success(
        vars.is_active
          ? `Se activaron ${vars.ids.length} vacante(s).`
          : `Se desactivaron ${vars.ids.length} vacante(s).`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleCandidateActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('candidates').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminCandidates'] }),
  });

  const toggleCandidatePublic = useMutation({
    mutationFn: async ({ id, is_public }: { id: string; is_public: boolean }) => {
      const { error } = await supabase.from('candidates').update({ is_public }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminCandidates'] }),
  });

  const activateAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('jobs').update({ is_active: true }).neq('is_active', true);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      toast.success('Todas las vacantes fueron activadas');
    },
    onError: (err: unknown) => toast.error(String((err as { message?: unknown })?.message || err)),
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
      } catch (err) {
        void err;
      }
      localStorage.setItem(key, '1');
    })();
  }, [session, queryClient]);

  useEffect(() => {
    if (!session) return;
    const key = 'myjob_fixed_text_fields_v6';
    if (localStorage.getItem(key) === '1') return;

    (async () => {
      try {
        const { data, error } = await supabase.from('jobs').select('id, title, b_name, summary, description, requirements');
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
                title: row.title || null,
                b_name: row.b_name || null,
                summary: row.summary || null,
                description: row.description || null,
                requirements: row.requirements || null,
              },
              after: normalized,
              titleAfter: normalizeJobTitle(row.title || ''),
              bNameAfter: normalizeCompanyName(row.b_name || ''),
            };
          })
          .filter(
            (row) =>
              row.titleAfter !== (row.before.title || '') ||
              row.bNameAfter !== (row.before.b_name || '') ||
              row.after.summary !== row.before.summary ||
              row.after.description !== row.before.description ||
              row.after.requirements !== row.before.requirements,
          )
          .map((row) => ({ id: row.id, title: row.titleAfter, b_name: row.bNameAfter, ...row.after }));

        if (changed.length > 0) {
          const { error: upsertError } = await supabase.from('jobs').upsert(changed);
          if (upsertError) throw upsertError;
          queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
        }
      } catch (err) {
        void err;
      }

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
      toast.success('Todas las vacantes fueron eliminadas');
    },
    onError: (err: unknown) => {
      const msg = String(err?.message || err || '');
      if (msg.toLowerCase().includes('row level security') || msg.toLowerCase().includes('row-level security')) {
        toast.error(
          'Permisos insuficientes: en Supabase agrega una política DELETE de jobs para el rol authenticated.',
        );
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
      ['job-exemplo', 'MyJob', '', 'Atendente de Call Center', 'call-center-customer-service', 'sao-paulo', '', '', 'tempo-integral', 'presencial', 'Atendimento ao cliente via telefone e WhatsApp.', 'Sueldo mensual $12,000 MXN. Descreva a vaga em texto puro.', 'Boa comunicação; disponibilidade de horário.', 'Vale-transporte, Vale-refeição', 'medio', 'sem-experiencia', 'Serviços', 'Português', 'TRUE']
    ];
    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'myjob_imc_template_br.csv';
    link.click();
  };

  const downloadImcExportTemplate = () => {
    const template = [
      [
        'id',
        'origin_id',
        'category_full_path',
        'title',
        'amount',
        'company',
        'description',
        'location',
        'latitude',
        'longitude',
        'author_name',
        'author_profile',
        'create_at',
        'ext',
      ],
      [
        '55398649',
        'a8765d59',
        'Jobs > Tecnología en la salud > Empleos de Becario en nutrición',
        'Asesor de Nutrición',
        '{"type":"monthly","min":12000,"max":15000}',
        'Grupo Salud MX',
        'Objetivo del puesto: brindar asesoría nutricional personalizada a clientes en tienda. Requisitos: licenciatura en nutrición, experiencia en atención al cliente.',
        'Tlalpan, Ciudad de México',
        '19.28333',
        '-99.16667',
        'Grupo Salud MX',
        'https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/256x256/7c42fae92bbb670e365b15cb97ccb741',
        '2025-12-01',
        '{"industry":"Healthcare"}',
      ],
    ];
    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'myjob_imc_export_template.csv';
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

  const normalizeCandidateText = (value: unknown) => fixJobTextArtifacts(String(value ?? '')).replace(/\s+/g, ' ').trim();

  const downloadCandidatesTemplate = () => {
    const template = [
      ['id', 'role_slug', 'full_name', 'age', 'location', 'headline', 'summary', 'experience', 'education_level', 'employment_type', 'salary_expectation', 'availability', 'is_active', 'is_public'],
      [
        'cand-exemplo',
        'driver',
        'Leandro Rodrigues',
        '43',
        'sao-jose-dos-campos',
        'Instrutor Master Driver',
        'Buscando oportunidade como Instrutor Master Driver. Mais de 15 anos de experiência no transporte rodoviário.',
        'Treinamento de condutores, reciclagem, integração, telemetria, segurança viária, redução de sinistros.',
        'Ensino médio completo',
        'CLT',
        'MXN $5,000',
        'Imediata',
        'TRUE',
        'TRUE',
      ],
    ];
    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'myjob_candidates_template.csv';
    link.click();
  };

  const handleCandidatesFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          const ageRaw = String(row.age ?? '').trim();
          const age = ageRaw ? Number.parseInt(ageRaw, 10) : NaN;
          return {
            id: row.id || `cand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role_slug: normalizeCandidateText(row.role_slug || 'driver').toLowerCase(),
            full_name: row.full_name ? normalizeCandidateText(row.full_name) : null,
            age: Number.isFinite(age) ? age : null,
            location: row.location ? normalizeCity(row.location) : null,
            headline: row.headline ? normalizeCandidateText(row.headline) : null,
            summary: row.summary ? normalizeCandidateText(row.summary) : null,
            experience: row.experience ? normalizeCandidateText(row.experience) : null,
            education_level: row.education_level ? normalizeCandidateText(row.education_level) : null,
            employment_type: row.employment_type ? normalizeCandidateText(row.employment_type) : null,
            salary_expectation: row.salary_expectation ? normalizeCandidateText(row.salary_expectation) : null,
            availability: row.availability ? normalizeCandidateText(row.availability) : null,
            is_active: parseBoolean(row.is_active, true),
            is_public: parseBoolean(row.is_public, true),
          };
        });

        const { error } = await supabase.from('candidates').upsert(payload);
        if (error) throw error;

        toast.success(`Se importaron ${payload.length} candidatos correctamente.`);
        queryClient.invalidateQueries({ queryKey: ['adminCandidates'] });
      } catch (err: unknown) {
        toast.error(`Error al importar: ${String((err as { message?: unknown })?.message || err)}`);
      } finally {
        if (candidateFileInputRef.current) candidateFileInputRef.current.value = '';
      }
    })();
  };

  const handleJobImportPauseToggle = () => {
    const next = !jobImportPauseRef.current;
    jobImportPauseRef.current = next;
    setJobImportProgress((prev) => (prev?.isRunning ? { ...prev, paused: next } : prev));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (jobImportProgress?.isRunning) return;

    (async () => {
      try {
        const text = await decodeCsvFile(file);
        const results = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
        if (results.errors?.length) {
          const msg = results.errors[0]?.message || 'CSV inválido';
          throw new Error(msg);
        }

        const rows = (results.data || []).filter((r) => Object.values(r || {}).some((v) => String(v ?? '').trim() !== ''));
        const fieldNames = results.meta?.fields || [];
        const imcShape = isImcExportCsv(fieldNames);
        const normalizedRows = rows.map((r) => normalizeCsvRecordKeys(r as Record<string, string>));
        const rowsForImport = imcShape
          ? normalizedRows.map(mergeImcColumnsIntoClassicRow)
          : normalizedRows;

        let payload = buildJobsPayloadFromCsvRows(rowsForImport);
        const sourceTotal = payload.length;
        const incomingIds = Array.from(
          new Set(
            payload
              .map((row) => String(row.id ?? '').trim())
              .filter(Boolean),
          ),
        );
        if (incomingIds.length > 0) {
          const existingIds = new Set<string>();
          for (const part of chunkArray(incomingIds, 200)) {
            const { data, error } = await supabase.from('jobs').select('id').in('id', part);
            if (error) throw error;
            for (const row of data || []) {
              if (row?.id) existingIds.add(String(row.id));
            }
          }
          if (existingIds.size > 0) {
            payload = payload.filter((row) => !existingIds.has(String(row.id)));
            const skipped = sourceTotal - payload.length;
            if (skipped > 0) {
              toast.message(`Se omitieron ${skipped} fila(s) porque el id ya existe en jobs.`);
            }
          }
        }

        const total = payload.length;
        if (total === 0) {
          toast.message('No hay filas nuevas para importar (ids ya existentes fueron omitidos).');
          return;
        }

        const shouldRunAiForIndex = (idx: number) => {
          if (!hasJobAiConfig()) return false;
          const desc = String(payload[idx].description || '').trim();
          if (!desc) return false;
          if (imcShape) return true;
          const s = String(payload[idx].summary || '').trim();
          const h = payload[idx].highlights;
          const hasHighlights = Array.isArray(h) && h.some((x) => String(x ?? '').trim());
          return !s && !hasHighlights;
        };

        let aiFallbackUsed = false;
        const useAi = hasJobAiConfig();
        const concurrency = useAi ? jobImportAiConcurrency() : jobImportUpsertOnlyConcurrency();

        jobImportPauseRef.current = false;
        setJobImportProgress({
          isRunning: true,
          total,
          saved: 0,
          failed: 0,
          paused: false,
        });

        const waitIfPaused = async () => {
          while (jobImportPauseRef.current) {
            await new Promise<void>((r) => {
              window.setTimeout(r, 200);
            });
          }
        };

        if (imcShape && !useAi) {
          toast.message(
            'Import IMC sin IA: destaques por fila desde el JD. Puedes subir VITE_JOB_AI_URL o LLM_* para resúmenes con IA.',
            { duration: 6000 },
          );
        }

        const processOne = async (i: number) => {
          const row = payload[i];
          const desc = String(row.description || '').trim();

          await waitIfPaused();

          if (useAi && shouldRunAiForIndex(i)) {
            try {
              const ai = await generateJobSummaryAndHighlights(desc);
              if (ai.summary) row.summary = ai.summary;
              const hl =
                ai.highlights.length > 0 ? ai.highlights : fallbackHighlightsFromDescription(desc);
              row.highlights = hl.length ? hl : null;
            } catch {
              aiFallbackUsed = true;
              if (!row.highlights?.length) {
                const fb = fallbackHighlightsFromDescription(desc);
                row.highlights = fb.length ? fb : null;
              }
            }
          } else if (imcShape && !useAi && desc && !row.highlights?.length) {
            const fb = fallbackHighlightsFromDescription(desc);
            row.highlights = fb.length ? fb : null;
          }

          await waitIfPaused();

          const { error } = await supabase.from('jobs').upsert([row]);
          if (error) throw new Error(error.message || String(error));
        };

        const outcomes: boolean[] = [];
        await runPool(
          total,
          concurrency,
          async (i) => {
            let lastError: string | undefined;
            try {
              await processOne(i);
              outcomes.push(true);
            } catch (err: unknown) {
              outcomes.push(false);
              lastError = String((err as { message?: unknown })?.message || err);
            }
            const okN = outcomes.filter(Boolean).length;
            const badN = outcomes.filter((x) => !x).length;
            setJobImportProgress((prev) => {
              if (!prev?.isRunning) return prev;
              return {
                isRunning: true,
                total,
                saved: okN,
                failed: badN,
                paused: prev.paused,
                lastTitle: payload[i]?.title,
                ...(lastError ? { lastError: lastError.slice(0, 120) } : {}),
              };
            });
          },
          { beforeClaimNext: waitIfPaused },
        );

        const saved = outcomes.filter(Boolean).length;
        const failed = outcomes.length - saved;
        jobImportPauseRef.current = false;
        setJobImportProgress({ isRunning: false, total, saved, failed, paused: false });

        queryClient.invalidateQueries({ queryKey: ['adminJobs'] });

        if (failed === 0) {
          toast.success(`Se importaron ${saved} vacantes (guardado progresivo).`);
        } else {
          toast.error(`Importación terminada: ${saved} OK, ${failed} fallidas. Revisa datos o políticas RLS.`);
        }
        if (aiFallbackUsed) {
          toast.message('Algunas vacantes usaron destacados automáticos en el texto porque falló la API de IA.');
        }

        window.setTimeout(() => {
          setJobImportProgress(null);
        }, 3200);
      } catch (err: unknown) {
        jobImportPauseRef.current = false;
        setJobImportProgress(null);
        toast.error(`Error al importar: ${String((err as { message?: unknown })?.message || err)}`);
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
        {activeTab === 'jobs' && jobsError && (
          <div className="bg-card rounded-2xl shadow-sm p-4 mb-4 text-sm text-destructive">
            {(jobsError as Error).message}
          </div>
        )}
        {activeTab === 'candidates' && candidatesError && (
          <div className="bg-card rounded-2xl shadow-sm p-4 mb-4 text-sm text-destructive">
            {(candidatesError as Error).message}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            variant={activeTab === 'jobs' ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => {
              setActiveTab('jobs');
            }}
          >
            Vacantes
          </Button>
          <Button
            variant={activeTab === 'candidates' ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => {
              setActiveTab('candidates');
              setShowForm(false);
              setEditing(null);
            }}
          >
            Candidatos
          </Button>
        </div>
        {activeTab === 'jobs' && jobImportProgress && (
          <div className="bg-card rounded-2xl shadow-sm p-4 mb-4 border border-border">
            {jobImportProgress.isRunning ? (
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={handleJobImportPauseToggle}
                >
                  {jobImportProgress.paused ? (
                    <>
                      <Play className="h-4 w-4 mr-1" /> Continuar
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-1" /> Pausar
                    </>
                  )}
                </Button>
              </div>
            ) : null}
            {jobImportProgress.isRunning && jobImportProgress.paused ? (
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                En pausa: no se inician filas nuevas hasta continuar. Las peticiones de IA o guardado ya en curso pueden
                terminar antes de detenerse del todo.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium mb-2">
              <span>
                {jobImportProgress.isRunning
                  ? jobImportProgress.paused
                    ? 'Importación en pausa'
                    : 'Importando vacantes (IA + guardado)…'
                  : 'Importación terminada'}
              </span>
              <span className="text-muted-foreground">
                {jobImportProgress.saved + jobImportProgress.failed} / {jobImportProgress.total}
                {jobImportProgress.failed > 0 ? (
                  <span className="text-destructive ml-2">({jobImportProgress.failed} errores)</span>
                ) : null}
              </span>
            </div>
            <Progress
              value={
                jobImportProgress.total > 0
                  ? Math.min(
                      100,
                      Math.round(
                        ((jobImportProgress.saved + jobImportProgress.failed) / jobImportProgress.total) * 100,
                      ),
                    )
                  : 0
              }
            />
            {jobImportProgress.lastTitle ? (
              <p className="text-xs text-muted-foreground mt-2 truncate">
                Último: {jobImportProgress.lastTitle}
              </p>
            ) : null}
            {jobImportProgress.lastError ? (
              <p className="text-xs text-destructive mt-1 truncate">{jobImportProgress.lastError}</p>
            ) : null}
            <p className="text-xs text-muted-foreground mt-2">
              Concurrencia: {hasJobAiConfig() ? jobImportAiConcurrency() : jobImportUpsertOnlyConcurrency()} filas en
              paralelo (ajuste con VITE_JOB_IMPORT_AI_CONCURRENCY / VITE_JOB_IMPORT_UPSERT_CONCURRENCY).
            </p>
          </div>
        )}
        {showForm && editing ? (
          <div className="bg-card rounded-2xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">{editing.id.startsWith('job-') ? t('admin.addJob') : t('admin.editJob')}</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div><Label>ID</Label><Input value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Título</Label><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Empresa</Label><Input value={editing.b_name} onChange={(e) => setEditing({ ...editing, b_name: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>URL del logo</Label><Input value={editing.b_logo_url} onChange={(e) => setEditing({ ...editing, b_logo_url: e.target.value })} className="rounded-xl mt-1" /></div>
              <div>
                <Label>Categoría</Label>
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
                <Label>Ciudad</Label>
                <Input list="city-options" value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} className="rounded-xl mt-1" />
                <datalist id="city-options">
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </datalist>
              </div>
              <div><Label>Tipo de empleo</Label><Input value={editing.job_type} onChange={(e) => setEditing({ ...editing, job_type: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Modalidad</Label><Input value={editing.workplace_type} onChange={(e) => setEditing({ ...editing, workplace_type: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Destacados (separados por coma)</Label><Input value={editing.highlights} onChange={(e) => setEditing({ ...editing, highlights: e.target.value })} className="rounded-xl mt-1" /></div>
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
        ) : activeTab === 'jobs' ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadTemplate} className="rounded-xl">
                  <Download className="h-4 w-4 mr-2" /> Plantilla CSV
                </Button>
                <Button variant="outline" onClick={downloadImcExportTemplate} className="rounded-xl">
                  <Download className="h-4 w-4 mr-2" /> Plantilla IMC
                </Button>
                <Button variant="outline" onClick={downloadOptionsCsv} className="rounded-xl">
                  <Download className="h-4 w-4 mr-2" /> CSV de opciones
                </Button>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                <Button
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl"
                  disabled={Boolean(jobImportProgress?.isRunning)}
                >
                  <Upload className="h-4 w-4 mr-2" /> Importar CSV
                </Button>
                <Button
                  variant="destructive"
                  className="rounded-xl"
                  disabled={deleteAllJobsMutation.isPending}
                  onClick={() => {
                    const v = window.prompt('Escribe DELETE para eliminar todas las vacantes');
                    if (v !== 'DELETE') return;
                    deleteAllJobsMutation.mutate();
                  }}
                >
                  Eliminar todas las vacantes
                </Button>
              </div>
              <Button onClick={openNew} className="rounded-xl">
                <Plus className="h-4 w-4 mr-1" /> {t('admin.addJob')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
              <span className="text-muted-foreground">{selectedJobIds.length} seleccionada(s)</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="rounded-xl"
                disabled={!selectedJobIds.length || batchJobsActiveMutation.isPending}
                onClick={() => batchJobsActiveMutation.mutate({ ids: selectedJobIds, is_active: true })}
              >
                Activar selección
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={!selectedJobIds.length || batchJobsActiveMutation.isPending}
                onClick={() => batchJobsActiveMutation.mutate({ ids: selectedJobIds, is_active: false })}
              >
                Desactivar selección
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-xl"
                disabled={!selectedJobIds.length}
                onClick={() => setSelectedJobIds([])}
              >
                Limpiar selección
              </Button>
            </div>
            <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="w-10 px-2 py-3">
                      <Checkbox
                        checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                        onCheckedChange={(v) => {
                          if (v === true) {
                            setSelectedJobIds((prev) => [...new Set([...prev, ...adminPageJobIds])]);
                          } else {
                            setSelectedJobIds((prev) => prev.filter((id) => !adminPageJobIds.includes(id)));
                          }
                        }}
                        disabled={!adminPageJobIds.length || isLoading}
                        aria-label="Seleccionar página"
                      />
                    </th>
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
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">
                        Cargando...
                      </td>
                    </tr>
                  )}
                  {jobsPageItems.map((job) => (
                    <tr key={job.id} className="border-t border-border">
                      <td className="px-2 py-3 align-middle">
                        <Checkbox
                          checked={selectedJobIds.includes(job.id)}
                          onCheckedChange={(v) => {
                            setSelectedJobIds((prev) =>
                              v === true ? [...prev, job.id] : prev.filter((x) => x !== job.id),
                            );
                          }}
                          aria-label={`Seleccionar ${job.title}`}
                        />
                      </td>
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
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">
                        No hay vacantes
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {jobs && jobs.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border text-sm text-muted-foreground">
                  <span>
                    Página {adminJobsPage} de {adminJobsMaxPage} · {jobs.length} vacante(s) ·{' '}
                    {ADMIN_JOBS_PAGE_SIZE} por página
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      disabled={adminJobsPage <= 1}
                      onClick={() => setAdminJobsPage((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      disabled={adminJobsPage >= adminJobsMaxPage}
                      onClick={() => setAdminJobsPage((p) => Math.min(adminJobsMaxPage, p + 1))}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadCandidatesTemplate} className="rounded-xl">
                  <Download className="h-4 w-4 mr-2" /> Plantilla CSV
                </Button>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  ref={candidateFileInputRef}
                  onChange={handleCandidatesFileUpload}
                />
                <Button variant="secondary" onClick={() => candidateFileInputRef.current?.click()} className="rounded-xl">
                  <Upload className="h-4 w-4 mr-2" /> Importar CSV
                </Button>
              </div>
            </div>
            <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Nombre</th>
                    <th className="text-left px-4 py-3 font-medium">Perfil</th>
                    <th className="text-left px-4 py-3 font-medium">Ciudad</th>
                    <th className="text-left px-4 py-3 font-medium">Ativo</th>
                    <th className="text-left px-4 py-3 font-medium">Público</th>
                  </tr>
                </thead>
                <tbody>
                  {candidatesLoading && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        Cargando...
                      </td>
                    </tr>
                  )}
                  {candidates?.map((c: { id: string; full_name: string | null; role_slug: string | null; location: string | null; is_active: boolean | null; is_public: boolean | null }) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-4 py-3 font-mono text-xs">{c.id}</td>
                      <td className="px-4 py-3 font-medium">{c.full_name || '-'}</td>
                      <td className="px-4 py-3">{c.role_slug}</td>
                      <td className="px-4 py-3">{c.location || '-'}</td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={Boolean(c.is_active)}
                          onCheckedChange={(v) => toggleCandidateActive.mutate({ id: c.id, is_active: v })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={Boolean(c.is_public)}
                          onCheckedChange={(v) => toggleCandidatePublic.mutate({ id: c.id, is_public: v })}
                        />
                      </td>
                    </tr>
                  ))}
                  {(!candidates || candidates.length === 0) && !candidatesLoading && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        No hay candidatos
                      </td>
                    </tr>
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
