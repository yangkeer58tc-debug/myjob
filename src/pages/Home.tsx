import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Briefcase, MessageCircle, CheckCircle2, Zap, ShieldCheck, Search, Lock, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { CATEGORY_OPTIONS } from '@/lib/jobOptions';

const CITIES = [
  'Rio de Janeiro',
  'Belo Horizonte',
  'São Paulo',
  'Brasília',
  'Uberlândia'
];
const CATEGORIES = CATEGORY_OPTIONS.map((c) => ({ value: c.id, name: c.label }));

const PhoneMockup = () => {
  return (
    <div className="relative mx-auto w-[280px] h-[500px] transform rotate-[-2deg] hover:rotate-0 transition-transform duration-500">
      <div className="absolute inset-0 rounded-[3rem] bg-slate-900 shadow-2xl border-8 border-slate-800" />
      <div className="absolute inset-[4px] rounded-[2.5rem] bg-[#efeae2] overflow-hidden flex flex-col">
        {/* WhatsApp Header */}
        <div className="bg-[#075e54] px-4 py-4 flex items-center gap-3 text-white">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
            <Briefcase className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold">MyJob Oficial</p>
            <p className="text-xs text-white/80">Conta empresarial verificada</p>
          </div>
        </div>
        {/* Chat Area */}
        <div className="flex-1 p-4 flex flex-col gap-3 relative" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundSize: 'cover', opacity: 0.9 }}>
          <div className="self-start bg-white rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800 font-medium mb-1">Olá! 👋 Tenho uma vaga de Atendente em São Paulo. Salário: R$ 2.200/mês.</p>
            <p className="text-[10px] text-slate-500 text-right mt-1">10:30 AM</p>
          </div>
          <div className="self-end bg-[#dcf8c6] rounded-2xl rounded-tr-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800">Tenho interesse! Como faço para me candidatar?</p>
            <p className="text-[10px] text-slate-500 text-right mt-1 flex items-center justify-end gap-1">
              10:31 AM <span className="text-[#34b7f1]">✓✓</span>
            </p>
          </div>
          <div className="self-start bg-white rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800">Envie seu currículo por aqui e agendamos entrevista ainda hoje. 🚀</p>
            <p className="text-[10px] text-slate-500 text-right mt-1">10:31 AM</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Home = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const { data: recentJobs } = useQuery({
    queryKey: ['recentJobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  const { data: categoryCounts } = useQuery({
    queryKey: ['categoryCounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('category')
        .eq('is_active', true);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data) {
        if (!row.category) continue;
        counts[row.category] = (counts[row.category] || 0) + 1;
      }
      return counts;
    },
  });

  return (
    <PublicLayout>
      <Helmet>
        <title>MyJob - Encontre emprego rápido pelo WhatsApp</title>
        <meta name="description" content="Encontre vagas no Brasil e fale direto com as empresas via WhatsApp. Rápido, seguro e sem cadastros complicados." />
        <meta property="og:title" content="MyJob - Encontre emprego rápido" />
        <meta property="og:description" content="Vagas no Brasil. Candidate-se rapidamente enviando um WhatsApp." />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "MyJob",
            "url": "https://myjob.com/",
            "potentialAction": {
              "@type": "SearchAction",
              "target": "https://myjob.com/empleos?q={search_term_string}",
              "query-input": "required name=search_term_string"
            }
          })}
        </script>
      </Helmet>
      {/* 🚀 SUPER HERO SECTION (WhatsApp Focused) */}
      <section className="relative pt-20 pb-28 lg:pt-28 lg:pb-32 overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50">
        {/* Dynamic Background */}
        <div className="absolute top-0 w-full h-full overflow-hidden -z-10">
          <div className="absolute -top-24 right-[-10%] w-[640px] h-[640px] rounded-full bg-emerald-500/20 blur-[120px] animate-pulse" />
          <div
            className="absolute bottom-[-15%] left-[-10%] w-[560px] h-[560px] rounded-full bg-indigo-500/15 blur-[120px] animate-pulse"
            style={{ animationDelay: '600ms' }}
          />
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)',
              backgroundSize: '28px 28px',
            }}
          />
        </div>

        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
            
            {/* Text Content */}
            <div className="flex-1 text-center lg:text-left z-10">
              <div className="inline-flex items-center gap-2 bg-white/70 border border-slate-200 text-slate-700 text-sm font-bold px-5 py-2.5 rounded-full mb-8 shadow-sm backdrop-blur">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#25D366]"></span>
                </span>
                Recrutamento 100% via WhatsApp
              </div>
              
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-black text-slate-900 leading-[1.1] mb-6 tracking-tight">
                Consiga emprego <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">
                  conversando.
                </span>
              </h1>
              
              <p className="text-xl text-slate-600 mb-10 leading-relaxed max-w-2xl mx-auto lg:mx-0 font-medium">
                Esqueça portais complicados e e-mails que ninguém responde. No MyJob, você fala direto com as empresas pelo WhatsApp. Rápido, seguro e sem enrolação.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <Button
                  size="lg"
                  className="w-full sm:w-auto rounded-xl h-16 px-10 text-lg font-bold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-xl shadow-emerald-500/20 transition-all hover:-translate-y-1"
                  onClick={() => navigate('/empleos')}
                >
                  <MessageCircle className="h-6 w-6 mr-3" />
                  Ver Vagas Agora
                </Button>
              </div>
              <div className="mt-5 flex justify-center lg:justify-start">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/70 border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm backdrop-blur">
                  <CheckCircle2 className="h-5 w-5 text-[#25D366]" />
                  <span>Sem cadastro prévio</span>
                </div>
              </div>
            </div>

            {/* Visual/Phone Mockup */}
            <div className="flex-1 w-full max-w-lg lg:max-w-none relative z-10 motion-safe:animate-float">
              {/* Floating badges */}
              <div className="absolute top-10 -left-12 bg-white/80 p-4 rounded-2xl shadow-xl border border-slate-200 hidden md:flex items-center gap-3 z-20 animate-pulse backdrop-blur">
                <div className="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-bold">Resposta em</p>
                  <p className="text-sm font-black text-slate-900">menos de 2h</p>
                </div>
              </div>
              
              <PhoneMockup />
            </div>

          </div>
        </div>
      </section>

      {/* 🧲 EMPLOYER ENTRY (Recruiter Focus) */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 text-sm font-bold px-4 py-2 rounded-full">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Para empresas
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight">
                Contrate mais rápido com candidatos prontos para WhatsApp.
              </h2>
              <p className="text-slate-600 text-lg font-medium leading-relaxed">
                Navegue por perfis, busque por função e fale com nosso assistente no WhatsApp para liberar o contato do candidato certo.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  size="lg"
                  className="rounded-xl h-14 px-8 text-base font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-xl shadow-slate-900/10 transition-all hover:-translate-y-0.5"
                  onClick={() => navigate('/buscar-candidatos')}
                >
                  Buscar candidatos
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl h-14 px-8 text-base font-bold border-slate-200 bg-white text-slate-900 hover:bg-slate-50 transition-all hover:-translate-y-0.5"
                  onClick={() => navigate('/buscar-candidatos?q=driver')}
                >
                  Ver demo
                </Button>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-2 rounded-[2.75rem] bg-gradient-to-r from-emerald-500/25 via-sky-500/15 to-indigo-500/25 blur-2xl opacity-70 motion-safe:animate-pulse" />
              <div className="p-[1px] rounded-[2.5rem] bg-gradient-to-r from-emerald-500/25 via-sky-500/20 to-indigo-500/25 bg-[length:200%_200%] motion-safe:animate-gradient-x">
                <div className="rounded-[2.45rem] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 hover:bg-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Search className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm font-bold text-slate-600">Acesso instantâneo</p>
                    </div>
                    <p className="text-2xl font-black text-slate-900">Perfis online</p>
                    <p className="text-sm text-slate-500 mt-2">Veja candidatos publicados em tempo real.</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 hover:bg-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Zap className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm font-bold text-slate-600">Triagem mais rápida</p>
                    </div>
                    <p className="text-2xl font-black text-slate-900">Busca + destaque</p>
                    <p className="text-sm text-slate-500 mt-2">Encontre e destaque palavras-chave dentro do perfil.</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 hover:bg-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Lock className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm font-bold text-slate-600">Privacidade</p>
                    </div>
                    <p className="text-2xl font-black text-slate-900">Dados protegidos</p>
                    <p className="text-sm text-slate-500 mt-2">Nome e contato ficam parcialmente ocultos.</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 hover:bg-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <QrCode className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm font-bold text-slate-600">WhatsApp-first</p>
                    </div>
                    <p className="text-2xl font-black text-slate-900">QR no desktop</p>
                    <p className="text-sm text-slate-500 mt-2">Escaneie e continue no celular.</p>
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 🌟 WHY WHATSAPP SECTION (Features) */}
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-black text-foreground mb-4 tracking-tight">Por que buscar emprego pelo WhatsApp?</h2>
            <p className="text-lg text-muted-foreground font-medium">Uma forma mais humana e rápida de se candidatar — direto do seu celular.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card rounded-2xl p-8 text-center hover:shadow-lg transition-all border border-border/60">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Contato direto</h3>
              <p className="text-muted-foreground">Fale com o recrutador sem intermediários nem filtros automáticos.</p>
            </div>
            
            <div className="bg-card rounded-2xl p-8 text-center hover:shadow-lg transition-all border border-border/60">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                <MessageCircle className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Acompanhamento em tempo real</h3>
              <p className="text-muted-foreground">Veja rapidamente se sua mensagem foi recebida e lida.</p>
            </div>
            
            <div className="bg-card rounded-2xl p-8 text-center hover:shadow-lg transition-all border border-border/60">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                <ShieldCheck className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Empresas verificadas</h3>
              <p className="text-muted-foreground">Mais segurança com empresas verificadas e processos transparentes.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 🏢 CATEGORIES SECTION (Rich Content) */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-4">
            <div>
              <h2 className="text-3xl md:text-4xl font-black text-foreground mb-4 tracking-tight">Explore por categoria</h2>
              <p className="text-muted-foreground font-medium">Encontre a vaga ideal para você.</p>
            </div>
            <Button variant="outline" className="rounded-xl font-bold bg-card" onClick={() => navigate('/empleos')}>
              Ver todas as categorias
            </Button>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-2">
            {CATEGORIES.map((cat) => (
              <div
                key={cat.value}
                className="bg-card p-6 rounded-2xl border border-border/60 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group min-w-[220px] flex-shrink-0"
                onClick={() => navigate(`/empleos?categoria=${encodeURIComponent(cat.value)}`)}
              >
                <h3 className="font-bold text-foreground group-hover:text-primary transition-colors mb-2">{cat.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {(categoryCounts?.[cat.value] ?? 0).toLocaleString('pt-BR')} vagas
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 💼 RECENT JOBS SECTION */}
      {recentJobs && recentJobs.length > 0 && (
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-black text-foreground mb-4 tracking-tight">Vagas em destaque</h2>
              <p className="text-lg text-muted-foreground font-medium">Candidate-se agora pelo WhatsApp.</p>
            </div>
            
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {recentJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
            
            <div className="mt-16 text-center">
              <Button 
                size="lg"
                className="rounded-xl h-14 px-10 text-base font-bold shadow-lg"
                onClick={() => navigate('/empleos')}
              >
                Ver mais vagas
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* 📍 CITIES SECTION */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-black mb-10 text-center text-foreground tracking-tight">Encontre vagas na sua cidade</h2>
          <div className="flex flex-wrap justify-center gap-4">
            {CITIES.map((city) => (
              <button
                key={city}
                onClick={() => navigate(`/empleos?ciudad=${encodeURIComponent(city)}`)}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-card hover:bg-primary/5 transition-all font-bold border border-border/60 hover:border-primary/40 text-foreground"
              >
                <MapPin className="h-4 w-4" />
                {city}
              </button>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};

export default Home;
