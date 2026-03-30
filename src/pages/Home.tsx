import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Briefcase, MessageCircle, CheckCircle2, Zap, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

const CITIES = ['Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla', 'Querétaro', 'Tijuana'];
const CATEGORIES = [
  { name: 'Ventas y Comercial', count: '1,200+' },
  { name: 'Atención al Cliente', count: '850+' },
  { name: 'Logística y Transporte', count: '640+' },
  { name: 'Administración', count: '420+' },
];

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
            <p className="text-xs text-white/80">Cuenta de empresa verificada</p>
          </div>
        </div>
        {/* Chat Area */}
        <div className="flex-1 p-4 flex flex-col gap-3 relative" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundSize: 'cover', opacity: 0.9 }}>
          <div className="self-start bg-white rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800 font-medium mb-1">¡Hola! 👋 Tengo una vacante de Asesor de Ventas en CDMX. Sueldo: $15,000 mensuales.</p>
            <p className="text-[10px] text-slate-500 text-right mt-1">10:30 AM</p>
          </div>
          <div className="self-end bg-[#dcf8c6] rounded-2xl rounded-tr-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800">¡Me interesa! ¿Cómo aplico?</p>
            <p className="text-[10px] text-slate-500 text-right mt-1 flex items-center justify-end gap-1">
              10:31 AM <span className="text-[#34b7f1]">✓✓</span>
            </p>
          </div>
          <div className="self-start bg-white rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800">Solo envía tu CV por aquí y agendamos entrevista hoy mismo. 🚀</p>
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

  return (
    <PublicLayout>
      <Helmet>
        <title>MyJob - Consigue trabajo chateando por WhatsApp en México</title>
        <meta name="description" content="Encuentra los mejores empleos en México. Conecta directamente con empresas a través de WhatsApp. Rápido, seguro y sin registros complicados." />
        <meta property="og:title" content="MyJob - Encuentra empleo fácil y rápido" />
        <meta property="og:description" content="Miles de vacantes disponibles. Aplica directamente enviando un WhatsApp al reclutador." />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "MyJob",
            "url": "https://myjob.mx/",
            "potentialAction": {
              "@type": "SearchAction",
              "target": "https://myjob.mx/empleos?q={search_term_string}",
              "query-input": "required name=search_term_string"
            }
          })}
        </script>
      </Helmet>
      {/* 🚀 SUPER HERO SECTION (WhatsApp Focused) */}
      <section className="relative pt-20 pb-32 lg:pt-32 lg:pb-40 overflow-hidden bg-slate-50">
        {/* Dynamic Background */}
        <div className="absolute top-0 w-full h-full overflow-hidden -z-10">
          <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-[#25D366]/20 blur-[100px]" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-blue-500/10 blur-[100px]" />
        </div>

        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
            
            {/* Text Content */}
            <div className="flex-1 text-center lg:text-left z-10">
              <div className="inline-flex items-center gap-2 bg-white border border-[#25D366]/30 text-[#075e54] text-sm font-bold px-5 py-2.5 rounded-full mb-8 shadow-sm">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#25D366]"></span>
                </span>
                Reclutamiento 100% por WhatsApp
              </div>
              
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-black text-slate-900 leading-[1.1] mb-6 tracking-tight">
                Consigue trabajo <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#128C7E] to-[#25D366]">
                  chateando.
                </span>
              </h1>
              
              <p className="text-xl text-slate-600 mb-10 leading-relaxed max-w-2xl mx-auto lg:mx-0 font-medium">
                Olvida los portales complicados y los correos que nadie lee. En MyJob, conectas directamente con las empresas a través de WhatsApp. Rápido, seguro y sin rodeos.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <Button
                  size="lg"
                  className="w-full sm:w-auto rounded-xl h-16 px-10 text-lg font-bold bg-[#25D366] hover:bg-[#128C7E] text-white shadow-xl shadow-[#25D366]/30 transition-all hover:-translate-y-1"
                  onClick={() => navigate('/empleos')}
                >
                  <MessageCircle className="h-6 w-6 mr-3" />
                  Ver Vacantes Ahora
                </Button>
                <div className="flex items-center gap-3 px-4 py-2 text-slate-500 font-medium text-sm">
                  <CheckCircle2 className="h-5 w-5 text-[#25D366]" />
                  <span>Sin registro previo</span>
                </div>
              </div>
            </div>

            {/* Visual/Phone Mockup */}
            <div className="flex-1 w-full max-w-lg lg:max-w-none relative z-10">
              {/* Floating badges */}
              <div className="absolute top-10 -left-12 bg-white p-4 rounded-2xl shadow-xl border border-slate-100 hidden md:flex items-center gap-3 z-20 animate-bounce" style={{ animationDuration: '3s' }}>
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Zap className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-bold">Respuesta en</p>
                  <p className="text-sm font-black text-slate-800">Menos de 2 hrs</p>
                </div>
              </div>
              
              <PhoneMockup />
            </div>

          </div>
        </div>
      </section>

      {/* 🌟 WHY WHATSAPP SECTION (Features) */}
      <section className="py-24 bg-white border-y border-slate-100">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">¿Por qué buscar empleo por WhatsApp?</h2>
            <p className="text-lg text-slate-600 font-medium">Hemos revolucionado la forma de contratar. Es más humano, más rápido y lo tienes en la palma de tu mano.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-50 rounded-[2rem] p-8 text-center hover:shadow-lg transition-all border border-slate-100">
              <div className="w-16 h-16 mx-auto bg-[#25D366]/10 rounded-2xl flex items-center justify-center mb-6">
                <Zap className="h-8 w-8 text-[#25D366]" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Contacto Directo</h3>
              <p className="text-slate-600">Habla directamente con el reclutador. Sin intermediarios ni filtros automáticos que descarten tu CV.</p>
            </div>
            
            <div className="bg-slate-50 rounded-[2rem] p-8 text-center hover:shadow-lg transition-all border border-slate-100">
              <div className="w-16 h-16 mx-auto bg-blue-500/10 rounded-2xl flex items-center justify-center mb-6">
                <MessageCircle className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Seguimiento Real</h3>
              <p className="text-slate-600">Conoce el estado de tu proceso con las palomitas azules. Sabrás al instante si leyeron tu mensaje.</p>
            </div>
            
            <div className="bg-slate-50 rounded-[2rem] p-8 text-center hover:shadow-lg transition-all border border-slate-100">
              <div className="w-16 h-16 mx-auto bg-amber-500/10 rounded-2xl flex items-center justify-center mb-6">
                <ShieldCheck className="h-8 w-8 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Empresas Verificadas</h3>
              <p className="text-slate-600">Todas las empresas en MyJob pasan por un estricto proceso de verificación para garantizar tu seguridad.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 🏢 CATEGORIES SECTION (Rich Content) */}
      <section className="py-24 bg-slate-50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-4">
            <div>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">Explora por Categoría</h2>
              <p className="text-slate-600 font-medium">Encuentra el trabajo que mejor se adapte a tus habilidades.</p>
            </div>
            <Button variant="outline" className="rounded-xl border-slate-200 font-bold bg-white" onClick={() => navigate('/empleos')}>
              Ver todas las categorías
            </Button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CATEGORIES.map((cat, i) => (
              <div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 hover:border-[#25D366]/50 hover:shadow-md transition-all cursor-pointer group">
                <h3 className="font-bold text-slate-900 group-hover:text-[#128C7E] transition-colors mb-2">{cat.name}</h3>
                <p className="text-sm text-slate-500">{cat.count} vacantes</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 💼 RECENT JOBS SECTION */}
      {recentJobs && recentJobs.length > 0 && (
        <section className="py-24 bg-white">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">Vacantes Destacadas Hoy</h2>
              <p className="text-lg text-slate-600 font-medium">Aplica ahora mismo enviando un WhatsApp.</p>
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
                Ver más de 5,000 empleos
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* 📍 CITIES SECTION */}
      <section className="py-20 bg-slate-900 text-white">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-black mb-10 text-center">Encuentra trabajo en tu ciudad</h2>
          <div className="flex flex-wrap justify-center gap-4">
            {CITIES.map((city) => (
              <button
                key={city}
                onClick={() => navigate(`/empleos?ciudad=${encodeURIComponent(city)}`)}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-slate-800 hover:bg-[#25D366] hover:text-slate-900 transition-all font-bold border border-slate-700 hover:border-[#25D366]"
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
