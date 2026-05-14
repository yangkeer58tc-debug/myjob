import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LogOut, Plus, Pencil, Upload, Download, Pause, Play, Search, ChevronDown } from 'lucide-react';
import OkComMxPanel from '@/components/admin/OkComMxPanel';
import WhatsAppBotPanel from '@/components/admin/WhatsAppBotPanel';
import { isResumeAdminEnabled } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';
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
import { decodeCsvFile } from '@/lib/csvFileDecode';
import { jobImportAiConcurrency, jobImportUpsertOnlyConcurrency, runPool } from '@/lib/jobImportPool';
import {
  collectFirstEmployerLogoRaw,
  looksLikeCompanyLogoUrl,
  normalizeImportedEmployerLogoUrl,
  stripCsvCellDecorations,
} from '@/lib/jobLogoUrl';

/** Papa Parse puts delimiter auto-detect notes in `errors` even when parsing succeeds — do not treat those as fatal. */
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
const ADMIN_JOB_SELECT =
  'id,b_name,b_logo_url,title,category,salary_amount,payment_frequency,location,job_type,workplace_type,summary,description,requirements,highlights,education_level,industry,language_req,experience,is_active';

/** PostgREST `.or()` for admin job search — title / company / id / city (sanitized). */
function adminJobsSearchOrFilter(searchRaw: string): string | null {
  const normalized = searchRaw
    .trim()
    .replace(/,/g, ' ')
    .replace(/%/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!normalized) return null;
  const p = `%${normalized.replace(/"/g, '')}%`;
  return `title.ilike.${p},b_name.ilike.${p},id.ilike.${p},location.ilike.${p}`;
}

function adminJobCategoryLabel(categoryId: string | null | undefined): string {
  if (!categoryId) return '—';
  const hit = CATEGORY_OPTIONS.find((c) => c.id === categoryId);
  return hit?.label ?? categoryId;
}

type JobCsvPayloadRow = {
  id: string;
  b_name: string;
  b_logo_url: string | null;
  b_same_as: string | null;
  street_address: string | null;
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

    const b_same_as_raw = stripCsvCellDecorations(row.b_same_as || '').trim();
    const street_raw = stripCsvCellDecorations(row.street_address || '').trim();

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
      b_same_as: b_same_as_raw ? b_same_as_raw : null,
      street_address: street_raw ? street_raw : null,
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

type JobOperationKind = 'import_jobs_csv' | 'deactivate_by_id_csv';

type JobOperationLog = {
  id: string;
  created_at: string;
  operation: JobOperationKind;
  total_input: number;
  total_processed: number;
  online_before: number;
  online_after: number;
  skipped: number;
  success: number;
  failed: number;
  failed_records: Array<{ id: string; error: string }>;
};

const JOB_UPLOAD_LOG_STORAGE_KEY = 'myjob_job_upload_logs_v1';

const Admin = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState<JobForm | null>(null);
  const [showForm, setShowForm] = useState(false);
  const resumeAdminEnabled = isResumeAdminEnabled();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'jobs' | 'candidates' | 'whatsapp'>('jobs');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const deactivateIdsFileInputRef = useRef<HTMLInputElement>(null);
  const candidateFileInputRef = useRef<HTMLInputElement>(null);
  const [jobImportProgress, setJobImportProgress] = useState<JobImportProgressState | null>(null);
  const jobImportPauseRef = useRef(false);
  const [adminJobsPage, setAdminJobsPage] = useState(1);
  const [jobSearchInput, setJobSearchInput] = useState('');
  const [jobSearchDebounced, setJobSearchDebounced] = useState('');
  const [jobActiveFilter, setJobActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [jobCategoryFilter, setJobCategoryFilter] = useState<string>('');
  const [importSectionOpen, setImportSectionOpen] = useState(true);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [jobOpLogs, setJobOpLogs] = useState<JobOperationLog[]>([]);

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_UPLOAD_LOG_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as JobOperationLog[];
      if (Array.isArray(parsed)) setJobOpLogs(parsed.slice(0, 50));
    } catch {
      // ignore malformed local storage
    }
  }, []);

  const appendJobOpLog = (entry: Omit<JobOperationLog, 'id' | 'created_at'>) => {
    const log: JobOperationLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      created_at: new Date().toISOString(),
      ...entry,
    };
    setJobOpLogs((prev) => {
      const next = [log, ...prev].slice(0, 50);
      localStorage.setItem(JOB_UPLOAD_LOG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const fetchOnlineJobsCount = async () => {
    const { count, error } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    if (error) throw error;
    return count || 0;
  };

  const extractIdsForDeactivate = (text: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (raw: unknown) => {
      const id = stripCsvCellDecorations(String(raw ?? '')).trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };

    const withHeader = parseRecordsWithBestDelimiter(text);
    const fields = (withHeader.meta?.fields || []).map((f) => String(f || '').trim().toLowerCase());
    if (fields.includes('id')) {
      for (const row of withHeader.data || []) push((row as Record<string, string>).id);
      return out;
    }

    const noHeader = Papa.parse<string[]>(text, {
      ...JOB_CSV_PARSE_BASE,
      header: false,
      delimiter: withHeader.meta?.delimiter || ',',
    });
    for (const row of noHeader.data || []) {
      if (!Array.isArray(row) || row.length === 0) continue;
      push(row[0]);
    }
    return out;
  };

  useEffect(() => {
    const t = window.setTimeout(() => setJobSearchDebounced(jobSearchInput), 400);
    return () => window.clearTimeout(t);
  }, [jobSearchInput]);

  useEffect(() => {
    setAdminJobsPage(1);
    setSelectedJobIds([]);
  }, [jobSearchDebounced, jobActiveFilter, jobCategoryFilter]);

  const { data: adminJobsData, isLoading, error: jobsError } = useQuery({
    queryKey: ['adminJobs', adminJobsPage, jobSearchDebounced, jobActiveFilter, jobCategoryFilter],
    queryFn: async () => {
      const from = (adminJobsPage - 1) * ADMIN_JOBS_PAGE_SIZE;
      const to = from + ADMIN_JOBS_PAGE_SIZE - 1;
      let q = supabase.from('jobs').select(ADMIN_JOB_SELECT, { count: 'exact' });
      if (jobActiveFilter === 'active') q = q.eq('is_active', true);
      else if (jobActiveFilter === 'inactive') q = q.eq('is_active', false);
      if (jobCategoryFilter) q = q.eq('category', jobCategoryFilter);
      const orFilter = adminJobsSearchOrFilter(jobSearchDebounced);
      if (orFilter) q = q.or(orFilter);
      const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, to);
      if (error) throw error;
      return {
        rows: data || [],
        count: count || 0,
      };
    },
    enabled: !!session,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const jobs = adminJobsData?.rows || [];
  const adminJobsTotalCount = adminJobsData?.count || 0;
  const adminJobsMaxPage = Math.max(1, Math.ceil(adminJobsTotalCount / ADMIN_JOBS_PAGE_SIZE));
  const jobsPageItems = jobs;

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
      toast.success('Saved');
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
          ? `Activated ${vars.ids.length} job(s).`
          : `Deactivated ${vars.ids.length} job(s).`,
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

  const deleteAllJobsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('jobs').delete().neq('id', '');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      toast.success('All jobs were deleted');
    },
    onError: (err: unknown) => {
      const msg = String(err?.message || err || '');
      if (msg.toLowerCase().includes('row level security') || msg.toLowerCase().includes('row-level security')) {
        toast.error(
          'Insufficient permissions: add a DELETE policy for jobs in Supabase for the authenticated role.',
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
        const results = parseRecordsWithBestDelimiter(text);
        const fatalCand = fatalPapaParseErrors(results.errors);
        if (fatalCand.length) {
          const msg = fatalCand[0]?.message || 'CSV inválido';
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

        toast.success(`Imported ${payload.length} candidates successfully.`);
        queryClient.invalidateQueries({ queryKey: ['adminCandidates'] });
      } catch (err: unknown) {
        toast.error(`Import error: ${String((err as { message?: unknown })?.message || err)}`);
      } finally {
        if (candidateFileInputRef.current) candidateFileInputRef.current.value = '';
      }
    })();
  };

  const handleDeactivateIdsFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (jobImportProgress?.isRunning) return;

    (async () => {
      const failedRecords: Array<{ id: string; error: string }> = [];
      let skipped = 0;
      let success = 0;
      let failed = 0;
      let onlineBefore = 0;
      let onlineAfter = 0;
      let totalInput = 0;

      try {
        const text = await decodeCsvFile(file);
        const ids = extractIdsForDeactivate(text);
        totalInput = ids.length;
        if (ids.length === 0) {
          toast.message('No IDs were found in the file.');
          return;
        }

        onlineBefore = await fetchOnlineJobsCount();

        const existingIds = new Set<string>();
        for (const part of chunkArray(ids, 200)) {
          const { data, error } = await supabase.from('jobs').select('id').in('id', part);
          if (error) throw error;
          for (const row of data || []) if (row?.id) existingIds.add(String(row.id));
        }

        const toDeactivate = ids.filter((id) => existingIds.has(id));
        skipped = ids.length - toDeactivate.length;

        for (const part of chunkArray(toDeactivate, 200)) {
          const { error } = await supabase.from('jobs').update({ is_active: false }).in('id', part);
          if (error) {
            for (const id of part) {
              failed += 1;
              failedRecords.push({ id, error: String(error.message || error) });
            }
            continue;
          }
          success += part.length;
        }

        onlineAfter = await fetchOnlineJobsCount();
        queryClient.invalidateQueries({ queryKey: ['adminJobs'] });

        const summary = `Bulk disable complete: ${success} succeeded, ${failed} failed, ${skipped} skipped.`;
        if (failed > 0) toast.error(summary);
        else toast.success(summary);
      } catch (err: unknown) {
        const msg = String((err as { message?: unknown })?.message || err);
        failed += 1;
        failedRecords.push({ id: 'batch', error: msg });
        toast.error(`Bulk disable failed: ${msg}`);
      } finally {
        if (deactivateIdsFileInputRef.current) deactivateIdsFileInputRef.current.value = '';
        appendJobOpLog({
          operation: 'deactivate_by_id_csv',
          total_input: totalInput,
          total_processed: success + failed,
          online_before: onlineBefore,
          online_after: onlineAfter,
          skipped,
          success,
          failed,
          failed_records: failedRecords.slice(0, 100),
        });
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
      const failedRecords: Array<{ id: string; error: string }> = [];
      let skipped = 0;
      let success = 0;
      let failed = 0;
      let onlineBefore = 0;
      let onlineAfter = 0;
      let totalInput = 0;
      try {
        const text = await decodeCsvFile(file);
        const results = parseRecordsWithBestDelimiter(text);
        const fatalJobs = fatalPapaParseErrors(results.errors);
        if (fatalJobs.length) {
          const msg = fatalJobs[0]?.message || 'CSV inválido';
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
        totalInput = payload.length;
        onlineBefore = await fetchOnlineJobsCount();
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
            skipped = sourceTotal - payload.length;
            if (skipped > 0) {
              toast.message(`Skipped ${skipped} row(s) because the ID already exists in jobs.`);
            }
          }
        }

        const total = payload.length;
        if (total === 0) {
          toast.message('No new rows to import (existing IDs were skipped).');
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
            'Importing IMC without AI: highlights will be generated from the JD text. Add VITE_JOB_AI_URL or LLM_* for AI summaries.',
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
              failedRecords.push({ id: payload[i]?.id || 'unknown', error: lastError });
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
        failed = outcomes.length - saved;
        success = saved;
        jobImportPauseRef.current = false;
        setJobImportProgress({ isRunning: false, total, saved, failed, paused: false });

        onlineAfter = await fetchOnlineJobsCount();
        queryClient.invalidateQueries({ queryKey: ['adminJobs'] });

        if (failed === 0) {
          toast.success(`Imported ${saved} jobs with progressive saving.`);
        } else {
          toast.error(`Import finished: ${saved} succeeded, ${failed} failed. Check your data or RLS policies.`);
        }
        if (aiFallbackUsed) {
          toast.message('Some jobs used fallback highlights from the text because the AI API failed.');
        }

        window.setTimeout(() => {
          setJobImportProgress(null);
        }, 3200);
      } catch (err: unknown) {
        jobImportPauseRef.current = false;
        setJobImportProgress(null);
        failed = failed || 1;
        if (failedRecords.length === 0) {
          failedRecords.push({ id: 'batch', error: String((err as { message?: unknown })?.message || err) });
        }
        toast.error(`Import error: ${String((err as { message?: unknown })?.message || err)}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
        appendJobOpLog({
          operation: 'import_jobs_csv',
          total_input: totalInput,
          total_processed: success + failed,
          online_before: onlineBefore,
          online_after: onlineAfter,
          skipped,
          success,
          failed,
          failed_records: failedRecords.slice(0, 100),
        });
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
            Jobs
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
            Candidates
          </Button>
          <Button
            variant={activeTab === 'whatsapp' ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => {
              setActiveTab('whatsapp');
              setShowForm(false);
              setEditing(null);
            }}
          >
            WhatsApp Bot
          </Button>
          {resumeAdminEnabled ? (
            <Button
              variant={location.pathname.startsWith('/admin/resumes') ? 'default' : 'outline'}
              className="rounded-xl"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
                navigate('/admin/resumes');
              }}
            >
              Resumes
            </Button>
          ) : null}
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
                      <Play className="h-4 w-4 mr-1" /> Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-1" /> Pause
                    </>
                  )}
                </Button>
              </div>
            ) : null}
            {jobImportProgress.isRunning && jobImportProgress.paused ? (
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                Paused: no new rows will start until you resume. In-flight AI or save requests may still finish first.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium mb-2">
              <span>
                {jobImportProgress.isRunning
                  ? jobImportProgress.paused
                    ? 'Import paused'
                    : 'Importing jobs (AI + save)...'
                  : 'Import finished'}
              </span>
              <span className="text-muted-foreground">
                {jobImportProgress.saved + jobImportProgress.failed} / {jobImportProgress.total}
                {jobImportProgress.failed > 0 ? (
                  <span className="text-destructive ml-2">({jobImportProgress.failed} errors)</span>
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
                Latest: {jobImportProgress.lastTitle}
              </p>
            ) : null}
            {jobImportProgress.lastError ? (
              <p className="text-xs text-destructive mt-1 truncate">{jobImportProgress.lastError}</p>
            ) : null}
            <p className="text-xs text-muted-foreground mt-2">
              Concurrency: {hasJobAiConfig() ? jobImportAiConcurrency() : jobImportUpsertOnlyConcurrency()} rows in
              parallel (adjust with VITE_JOB_IMPORT_AI_CONCURRENCY / VITE_JOB_IMPORT_UPSERT_CONCURRENCY).
            </p>
          </div>
        )}
        {showForm && editing ? (
          <div className="bg-card rounded-2xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">{editing.id.startsWith('job-') ? t('admin.addJob') : t('admin.editJob')}</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div><Label>ID</Label><Input value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Title</Label><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Company</Label><Input value={editing.b_name} onChange={(e) => setEditing({ ...editing, b_name: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Logo URL</Label><Input value={editing.b_logo_url} onChange={(e) => setEditing({ ...editing, b_logo_url: e.target.value })} className="rounded-xl mt-1" /></div>
              <div>
                <Label>Category</Label>
                <Input list="category-options" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="rounded-xl mt-1" />
                <datalist id="category-options">
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </datalist>
              </div>
              <div><Label>Salary</Label><Input value={editing.salary_amount} onChange={(e) => setEditing({ ...editing, salary_amount: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Frequency</Label><Input value={editing.payment_frequency} onChange={(e) => setEditing({ ...editing, payment_frequency: e.target.value })} className="rounded-xl mt-1" /></div>
              <div>
                <Label>City</Label>
                <Input list="city-options" value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} className="rounded-xl mt-1" />
                <datalist id="city-options">
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </datalist>
              </div>
              <div><Label>Employment Type</Label><Input value={editing.job_type} onChange={(e) => setEditing({ ...editing, job_type: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Workplace Type</Label><Input value={editing.workplace_type} onChange={(e) => setEditing({ ...editing, workplace_type: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label>Highlights (comma-separated)</Label><Input value={editing.highlights} onChange={(e) => setEditing({ ...editing, highlights: e.target.value })} className="rounded-xl mt-1" /></div>
            </div>
            <div><Label>Summary</Label><Textarea value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} className="rounded-xl mt-1" rows={2} /></div>
            <div><Label>Description</Label><Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="rounded-xl mt-1" rows={5} /></div>
            <div><Label>Requirements</Label><Textarea value={editing.requirements} onChange={(e) => setEditing({ ...editing, requirements: e.target.value })} className="rounded-xl mt-1" rows={3} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              <Label>Active</Label>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => saveMutation.mutate(editing)} className="rounded-xl">{t('admin.save')}</Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-xl">{t('admin.cancel')}</Button>
            </div>
          </div>
        ) : activeTab === 'jobs' ? (
          <>
            <div className="bg-card rounded-2xl border border-border p-4 mb-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">找职位</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    标题、公司、职位 ID、城市模糊匹配；可与上架状态、品类组合筛选。
                  </p>
                </div>
                <Button onClick={openNew} className="rounded-xl shrink-0 w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-1" /> {t('admin.addJob')}
                </Button>
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                <div className="flex-1 min-w-0 max-w-full sm:max-w-md">
                  <Label htmlFor="admin-job-search" className="text-xs text-muted-foreground">
                    关键词
                  </Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      id="admin-job-search"
                      value={jobSearchInput}
                      onChange={(e) => setJobSearchInput(e.target.value)}
                      placeholder="职位标题、公司名、ID 或城市…"
                      className="rounded-xl pl-9"
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="w-full sm:w-40">
                  <Label className="text-xs text-muted-foreground">上架状态</Label>
                  <Select
                    value={jobActiveFilter}
                    onValueChange={(v) => setJobActiveFilter(v as 'all' | 'active' | 'inactive')}
                  >
                    <SelectTrigger className="rounded-xl mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      <SelectItem value="active">仅在职</SelectItem>
                      <SelectItem value="inactive">仅下架</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:min-w-[12rem] sm:max-w-xs">
                  <Label className="text-xs text-muted-foreground">品类</Label>
                  <Select
                    value={jobCategoryFilter || '__all__'}
                    onValueChange={(v) => setJobCategoryFilter(v === '__all__' ? '' : v)}
                  >
                    <SelectTrigger className="rounded-xl mt-1">
                      <SelectValue placeholder="全部品类" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__all__">全部品类</SelectItem>
                      {CATEGORY_OPTIONS.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl lg:mb-0.5"
                  onClick={() => {
                    setJobSearchInput('');
                    setJobActiveFilter('all');
                    setJobCategoryFilter('');
                  }}
                >
                  清除筛选
                </Button>
              </div>
              {jobSearchInput !== jobSearchDebounced ? (
                <p className="text-xs text-muted-foreground mt-2">正在更新搜索…</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
              <span className="text-muted-foreground">已选 {selectedJobIds.length} 条</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="rounded-xl"
                disabled={!selectedJobIds.length || batchJobsActiveMutation.isPending}
                onClick={() => batchJobsActiveMutation.mutate({ ids: selectedJobIds, is_active: true })}
              >
                上架所选
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={!selectedJobIds.length || batchJobsActiveMutation.isPending}
                onClick={() => batchJobsActiveMutation.mutate({ ids: selectedJobIds, is_active: false })}
              >
                下架所选
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-xl"
                disabled={!selectedJobIds.length}
                onClick={() => setSelectedJobIds([])}
              >
                取消勾选
              </Button>
            </div>
            <div className="bg-card rounded-2xl shadow-sm border border-border mb-4 overflow-hidden">
              <div className="max-h-[min(70vh,720px)] overflow-auto">
                <div className="min-w-[720px]">
                  <table className="w-full text-sm caption-bottom">
                    <thead className="sticky top-0 z-10 bg-secondary text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
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
                            aria-label="全选本页"
                          />
                        </th>
                        <th className="text-left px-4 py-3 font-medium whitespace-nowrap">ID</th>
                        <th className="text-left px-4 py-3 font-medium min-w-[8rem]">标题</th>
                        <th className="text-left px-4 py-3 font-medium min-w-[6rem]">公司</th>
                        <th className="text-left px-4 py-3 font-medium whitespace-nowrap">品类</th>
                        <th className="text-left px-4 py-3 font-medium whitespace-nowrap">城市</th>
                        <th className="text-left px-4 py-3 font-medium whitespace-nowrap">上架</th>
                        <th className="text-left px-4 py-3 font-medium whitespace-nowrap w-20">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading && (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-muted-foreground">
                            加载中…
                          </td>
                        </tr>
                      )}
                      {jobsPageItems.map((job) => (
                        <tr
                          key={job.id}
                          className="border-t border-border hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-2 py-3 align-middle">
                            <Checkbox
                              checked={selectedJobIds.includes(job.id)}
                              onCheckedChange={(v) => {
                                setSelectedJobIds((prev) =>
                                  v === true ? [...prev, job.id] : prev.filter((x) => x !== job.id),
                                );
                              }}
                              aria-label={`选择 ${job.title}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs align-middle">{job.id}</td>
                          <td className="px-4 py-3 font-medium align-middle">{job.title}</td>
                          <td className="px-4 py-3 align-middle">{job.b_name}</td>
                          <td className="px-4 py-3 text-muted-foreground align-middle text-xs max-w-[10rem] truncate" title={adminJobCategoryLabel(job.category)}>
                            {adminJobCategoryLabel(job.category)}
                          </td>
                          <td className="px-4 py-3 align-middle">{job.location}</td>
                          <td className="px-4 py-3 align-middle">
                            <Switch
                              checked={Boolean(job.is_active)}
                              onCheckedChange={(v) => toggleActive.mutate({ id: job.id, is_active: v })}
                            />
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => openEdit(job)} aria-label="编辑">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {jobs.length === 0 && !isLoading && (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-muted-foreground">
                            {jobSearchDebounced.trim() || jobActiveFilter !== 'all' || jobCategoryFilter
                              ? '当前筛选条件下没有职位。'
                              : '暂无职位。'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {!isLoading ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border text-sm text-muted-foreground">
                  <span>
                    第 {adminJobsPage} / {adminJobsMaxPage} 页 · 共 {adminJobsTotalCount} 条 · 每页 {ADMIN_JOBS_PAGE_SIZE} 条
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      disabled={adminJobsPage <= 1 || adminJobsTotalCount === 0}
                      onClick={() => setAdminJobsPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      disabled={adminJobsPage >= adminJobsMaxPage || adminJobsTotalCount === 0}
                      onClick={() => setAdminJobsPage((p) => Math.min(adminJobsMaxPage, p + 1))}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <Collapsible
              open={importSectionOpen}
              onOpenChange={setImportSectionOpen}
              className="rounded-2xl border border-border bg-card mb-4 shadow-sm"
            >
              <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 rounded-t-2xl transition-colors [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">数据导入与模板</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    模板下载 · 主 CSV 导入 · 按 ID 下架 · MX 专用 · 上传记录
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    importSectionOpen && 'rotate-180',
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-6 px-4 pb-4 pt-4">
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    ref={deactivateIdsFileInputRef}
                    onChange={handleDeactivateIdsFileUpload}
                  />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">下载模板</p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={downloadTemplate} className="rounded-xl">
                        <Download className="h-4 w-4 mr-2" /> 标准职位 CSV
                      </Button>
                      <Button variant="outline" onClick={downloadImcExportTemplate} className="rounded-xl">
                        <Download className="h-4 w-4 mr-2" /> IMC 导出模板
                      </Button>
                      <Button variant="outline" onClick={downloadOptionsCsv} className="rounded-xl">
                        <Download className="h-4 w-4 mr-2" /> 选项枚举 CSV
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">字段名与枚举值与导入逻辑一致，建议先下载再填。</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">批量导入 / 下架</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <Button
                        variant="secondary"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl"
                        disabled={Boolean(jobImportProgress?.isRunning)}
                      >
                        <Upload className="h-4 w-4 mr-2" /> 导入主 CSV
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => deactivateIdsFileInputRef.current?.click()}
                        className="rounded-xl"
                        disabled={Boolean(jobImportProgress?.isRunning)}
                      >
                        <Upload className="h-4 w-4 mr-2" /> 按 ID 批量下架
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-3">
                    <p className="text-xs font-medium text-destructive mb-2">危险操作</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <Button
                        variant="destructive"
                        className="rounded-xl"
                        disabled={deleteAllJobsMutation.isPending}
                        onClick={() => {
                          const v = window.prompt('输入 DELETE 以删除全部职位（不可恢复）');
                          if (v !== 'DELETE') return;
                          deleteAllJobsMutation.mutate();
                        }}
                      >
                        清空全部职位
                      </Button>
                      <span className="text-xs text-muted-foreground">仅紧急情况使用，删除后无法撤销。</span>
                    </div>
                  </div>
                  <OkComMxPanel />
                  <div className="bg-muted/30 rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold">上传记录</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => {
                          setJobOpLogs([]);
                          localStorage.removeItem(JOB_UPLOAD_LOG_STORAGE_KEY);
                        }}
                      >
                        清除记录
                      </Button>
                    </div>
                    {jobOpLogs.length === 0 ? (
                      <p className="text-xs text-muted-foreground">暂无上传记录。</p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-auto">
                        {jobOpLogs.map((log) => (
                          <div key={log.id} className="text-xs border border-border rounded-lg p-2 bg-card">
                            <div className="font-medium">
                              {log.operation === 'deactivate_by_id_csv' ? '按 ID 下架' : '职位导入'} ·{' '}
                              {new Date(log.created_at).toLocaleString()}
                            </div>
                            <div className="text-muted-foreground">
                              导入前在线：{log.online_before}，导入后在线：{log.online_after}；输入 {log.total_input} 条，已处理{' '}
                              {log.total_processed}，成功 {log.success}，失败 {log.failed}，跳过 {log.skipped}
                            </div>
                            {log.failed_records.length > 0 ? (
                              <div className="text-destructive mt-1">
                                失败行（节选）：{log.failed_records.slice(0, 3).map((r) => `${r.id}（${r.error}）`).join('；')}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        ) : activeTab === 'whatsapp' ? (
          <WhatsAppBotPanel />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadCandidatesTemplate} className="rounded-xl">
                  <Download className="h-4 w-4 mr-2" /> CSV Template
                </Button>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  ref={candidateFileInputRef}
                  onChange={handleCandidatesFileUpload}
                />
                <Button variant="secondary" onClick={() => candidateFileInputRef.current?.click()} className="rounded-xl">
                  <Upload className="h-4 w-4 mr-2" /> Import CSV
                </Button>
              </div>
            </div>
            <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Profile</th>
                    <th className="text-left px-4 py-3 font-medium">City</th>
                    <th className="text-left px-4 py-3 font-medium">Active</th>
                    <th className="text-left px-4 py-3 font-medium">Public</th>
                  </tr>
                </thead>
                <tbody>
                  {candidatesLoading && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        Loading...
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
                        No candidates found.
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
