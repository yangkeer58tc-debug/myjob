import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { LogOut, Plus, Pencil, Upload, Download, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Session } from '@supabase/supabase-js';
import Papa from 'papaparse';

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

const CATEGORY_OPTIONS = [
  { value: 'healthcare-medical', label: 'Saúde' },
  { value: 'call-center-customer-service', label: 'Atendimento / Call Center' },
  { value: 'sales', label: 'Vendas' },
  { value: 'mfg-transport-logistics', label: 'Indústria / Transporte / Logística' },
  { value: 'trades-services', label: 'Serviços' },
];

const CITY_OPTIONS = [
  'Rio de Janeiro',
  'Belo Horizonte',
  'São Paulo',
  'Brasília',
  'Uberlândia',
];

const LOGO_URL = 'https://i.postimg.cc/VLyx9gfK/Gemini-Generated-Image-eiv43beiv43beiv4-(2).png';

const Admin = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState<JobForm | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [autoSeedState, setAutoSeedState] = useState<'idle' | 'checking' | 'seeding' | 'done' | 'skipped'>('idle');

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
      const payload = {
        id: form.id,
        b_name: form.b_name,
        b_logo_url: form.b_logo_url || null,
        title: form.title,
        category: form.category || null,
        salary_amount: form.salary_amount,
        payment_frequency: form.payment_frequency,
        location: form.location,
        job_type: form.job_type,
        workplace_type: form.workplace_type,
        summary: form.summary || null,
        description: form.description || null,
        requirements: form.requirements || null,
        highlights: form.highlights ? form.highlights.split(',').map((s) => s.trim()) : null,
        education_level: form.education_level || null,
        industry: form.industry || null,
        language_req: form.language_req || null,
        experience: form.experience || null,
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
      ['job-exemplo', 'Empresa Exemplo', 'https://exemplo.com/logo.png', 'Atendente de Call Center', 'call-center-customer-service', 'São Paulo', 'R$ 2.200', 'Mensal', 'Tempo Integral', 'Presencial', 'Atendimento ao cliente via telefone e WhatsApp.', 'Descreva a vaga em texto puro. Inclua como se candidatar pelo WhatsApp.', 'Boa comunicação; disponibilidade de horário.', 'Vale-transporte, Vale-refeição', 'Ensino Médio', 'Sem experiência', 'Serviços', 'Português', 'true']
    ];
    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'myjob_imc_template_br.csv';
    link.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as Record<string, string>[];
          const payload = rows.map((row) => ({
            id: row.id || `job-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            b_name: row.b_name || 'Empresa',
            b_logo_url: row.b_logo_url || null,
            title: row.title || 'Sem título',
            category: row.category || null,
            location: row.location || 'Brasil',
            salary_amount: row.salary_amount || 'A combinar',
            payment_frequency: row.payment_frequency || 'Mensal',
            job_type: row.job_type || 'Tempo Integral',
            workplace_type: row.workplace_type || 'Presencial',
            summary: row.summary || null,
            description: row.description || null,
            requirements: row.requirements || null,
            highlights: row.highlights ? row.highlights.split(',').map(s => s.trim()) : null,
            education_level: row.education_level || null,
            industry: row.industry || null,
            language_req: row.language_req || null,
            experience: row.experience || null,
            is_active: row.is_active === 'true' || row.is_active === '1',
          }));

          const { error } = await supabase.from('jobs').upsert(payload);
          if (error) throw error;
          
          toast.success(`Importadas ${payload.length} vagas com sucesso.`);
          queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
        } catch (err: any) {
          toast.error(`Erro ao importar: ${err.message}`);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      error: (error) => {
        toast.error(`Erro ao ler CSV: ${error.message}`);
      }
    });
  };

  const generateMockJobs = () => {
    const combos: { category: string; location: string }[] = [];
    for (const c of CATEGORY_OPTIONS) {
      for (const city of CITY_OPTIONS) {
        combos.push({ category: c.value, location: city });
      }
    }

    const titleByCategory: Record<string, string[]> = {
      'healthcare-medical': ['Enfermeiro(a)', 'Técnico em Enfermagem', 'Recepcionista de Clínica', 'Fisioterapeuta', 'Assistente de Laboratório'],
      'call-center-customer-service': ['Operador de Telemarketing', 'Atendente de SAC', 'Analista de Suporte', 'Assistente de Relacionamento', 'Consultor de Atendimento'],
      sales: ['Vendedor(a)', 'Consultor(a) de Vendas', 'Representante Comercial', 'Assistente Comercial', 'Gerente de Contas'],
      'mfg-transport-logistics': ['Auxiliar de Logística', 'Motorista Entregador', 'Operador de Empilhadeira', 'Ajudante Geral', 'Conferente'],
      'trades-services': ['Auxiliar de Limpeza', 'Técnico de Manutenção', 'Eletricista', 'Encanador', 'Mecânico'],
    };

    const items: any[] = [];
    const runId = Date.now();
    let i = 0;
    for (const combo of combos) {
      for (let k = 0; k < 8; k++) {
        const titles = titleByCategory[combo.category] || ['Assistente'];
        const baseTitle = titles[(k + i) % titles.length];
        const title = `${baseTitle} - ${combo.location}`;
        const salary = 1800 + (i % 12) * 150;
        const payment = i % 2 === 0 ? 'Mensal' : 'Quinzenal';
        const workplace = i % 4 === 0 ? 'Híbrido' : 'Presencial';
        const jobType = i % 3 === 0 ? 'Meio Período' : 'Tempo Integral';
        const highlights = [
          'Vale Transporte',
          'Vale Refeição',
          'Plano de Saúde',
          'Seguro de Vida',
          'Treinamento',
          'Bônus por desempenho',
        ].slice(0, 4 + (i % 3));
        items.push({
          id: `mock-${runId}-${String(i).padStart(4, '0')}`,
          b_name: 'MyJob',
          b_logo_url: LOGO_URL,
          title,
          category: combo.category,
          location: combo.location,
          salary_amount: `R$ ${String(salary).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.')}`,
          payment_frequency: payment,
          job_type: jobType,
          workplace_type: workplace,
          summary: `Vaga para ${baseTitle} em ${combo.location}. Processo rápido e 100% via WhatsApp.`,
          description:
            `Sobre a vaga:\n` +
            `Buscamos ${baseTitle} para atuar em ${combo.location} (${workplace}). Você fará parte de um time focado em atendimento rápido e eficiente.\n\n` +
            `Atividades:\n` +
            `- Rotina operacional da função\n` +
            `- Atendimento e suporte a demandas do dia a dia\n` +
            `- Organização de informações e comunicação com a equipe\n\n` +
            `O que oferecemos:\n` +
            `${highlights.map((h) => `- ${h}`).join('\n')}\n\n` +
            `Processo seletivo:\n` +
            `1) Triagem pelo WhatsApp\n` +
            `2) Conversa rápida com recrutador\n` +
            `3) Entrevista (online ou presencial)\n\n` +
            `Como se candidatar:\n` +
            `Clique no botão “Candidatar-se pelo WhatsApp” e envie: nome completo, cidade, disponibilidade e experiência.\n`,
          requirements:
            `Requisitos:\n` +
            `- Comprometimento e pontualidade\n` +
            `- Boa comunicação\n` +
            `- Disponibilidade para atuar em ${combo.location}\n` +
            `- Vontade de aprender e crescer\n`,
          highlights,
          is_active: true,
        });
        i++;
      }
    }

    return items;
  };

  const seedMocksMutation = useMutation({
    mutationFn: async () => {
      const jobs = generateMockJobs();
      for (let i = 0; i < jobs.length; i += 100) {
        const { error } = await supabase.from('jobs').upsert(jobs.slice(i, i + 100));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminJobs'] });
      toast.success('200 mocks criados');
    },
    onError: (err: any) => toast.error(err.message),
  });

  useEffect(() => {
    if (!session) return;
    if (autoSeedState !== 'idle') return;

    const storageKey = 'myjob_auto_seeded_v1';
    if (localStorage.getItem(storageKey) === '1') {
      setAutoSeedState('skipped');
      return;
    }

    (async () => {
      setAutoSeedState('checking');
      const { count, error } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
      if (error) {
        setAutoSeedState('idle');
        return;
      }

      const total = count || 0;
      if (total >= 200) {
        localStorage.setItem(storageKey, '1');
        setAutoSeedState('skipped');
        return;
      }

      setAutoSeedState('seeding');
      try {
        await seedMocksMutation.mutateAsync();
        localStorage.setItem(storageKey, '1');
        setAutoSeedState('done');
      } catch {
        setAutoSeedState('idle');
      }
    })();
  }, [session, autoSeedState, seedMocksMutation]);

  return (
    <div className="min-h-screen bg-secondary">
      <div className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">{t('admin.title')}</h1>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-1" /> {t('admin.logout')}
        </Button>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {autoSeedState === 'seeding' && (
          <div className="bg-card rounded-2xl shadow-sm p-4 mb-4 text-sm">
            正在自动生成 200 条帖子数据…（Aguarde）
          </div>
        )}
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
                    <option key={c.value} value={c.value}>{c.label}</option>
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
                    <option key={c} value={c} />
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
                  variant="outline"
                  onClick={() => seedMocksMutation.mutate()}
                  className="rounded-xl"
                  disabled={seedMocksMutation.isPending}
                >
                  <Sparkles className="h-4 w-4 mr-2" /> 200 mocks
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
