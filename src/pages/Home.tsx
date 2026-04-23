import { Helmet } from 'react-helmet-async';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Briefcase, Building2, MessageCircle, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PublicLayout from '@/components/PublicLayout';
import JobCard from '@/components/JobCard';
import Reveal from '@/components/Reveal';
import TestimonialCarousel from '@/components/home/TestimonialCarousel';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { CATEGORY_OPTIONS } from '@/lib/jobOptions';
import { getSiteOrigin, safeJsonLdStringify } from '@/lib/siteUrl';
import { trackEvent } from '@/lib/analytics';

const CITIES = ['Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana'];
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
            <p className="text-xs text-white/80">Cuenta de empresa verificada</p>
          </div>
        </div>
        {/* Chat Area */}
        <div className="flex-1 p-4 flex flex-col gap-3 relative" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundSize: 'cover', opacity: 0.9 }}>
          <div className="self-start bg-white rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800 font-medium mb-1">Hola! 👋 Tengo una vacante de Atención al Cliente en CDMX. Sueldo: MXN $12,000/mes.</p>
            <p className="text-[10px] text-slate-500 text-right mt-1">10:30 AM</p>
          </div>
          <div className="self-end bg-[#dcf8c6] rounded-2xl rounded-tr-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800">Me interesa. ¿Cómo postulo?</p>
            <p className="text-[10px] text-slate-500 text-right mt-1 flex items-center justify-end gap-1">
              10:31 AM <span className="text-[#34b7f1]">✓✓</span>
            </p>
          </div>
          <div className="self-start bg-white rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[85%] shadow-sm">
            <p className="text-sm text-slate-800">Envíame tu CV por aquí y agendamos entrevista hoy mismo. 🚀</p>
            <p className="text-[10px] text-slate-500 text-right mt-1">10:31 AM</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Home = () => {
  const navigate = useNavigate();
  const siteOrigin = useMemo(() => getSiteOrigin(), []);
  const websiteLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'MyJob',
      url: `${siteOrigin}/`,
      description:
        'Empleos en México con postulación por WhatsApp. Encuentra vacantes o publica ofertas con flujo rápido.',
      inLanguage: 'es-MX',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${siteOrigin}/empleos?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    }),
    [siteOrigin],
  );

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
        <title>MyJob | Empleos en México y contratación por WhatsApp</title>
        <meta
          name="description"
          content="Dos caminos, un solo lugar: encuentra empleo o contrata candidatos. Todo con un flujo rápido y enfoque en WhatsApp."
        />
        <link rel="canonical" href={`${siteOrigin}/`} />
        <meta property="og:url" content={`${siteOrigin}/`} />
        <meta property="og:title" content="MyJob | Empleo y reclutamiento con WhatsApp" />
        <meta property="og:description" content="Encuentra vacantes o contrata candidatos. Flujo rápido, conversión y privacidad." />
        <meta property="og:image" content={`${siteOrigin}/placeholder.svg`} />
        <script type="application/ld+json">{safeJsonLdStringify(websiteLd)}</script>
      </Helmet>
      <div className="bg-background text-foreground">
        <section className="relative overflow-hidden pt-20 pb-14 lg:pt-28 lg:pb-20">
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,211,102,0.18),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(7,94,84,0.16),transparent_50%)]" />
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
                maskImage: 'radial-gradient(circle at 30% 20%, black 0%, transparent 58%)',
                WebkitMaskImage: 'radial-gradient(circle at 30% 20%, black 0%, transparent 58%)',
              }}
            />
            <div
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)',
                backgroundSize: '26px 26px',
                maskImage: 'radial-gradient(circle at 70% 30%, black 0%, transparent 58%)',
                WebkitMaskImage: 'radial-gradient(circle at 70% 30%, black 0%, transparent 58%)',
              }}
            />
          </div>

          <div className="container mx-auto px-4 relative">
            <Reveal>
              <div className="grid lg:grid-cols-12 gap-10 items-center">
                <div className="lg:col-span-6">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-bold text-white/80 backdrop-blur">
                    <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                    WhatsApp-first · Dos entradas (candidato / empresa)
                  </div>
                  <h1 className="mt-6 text-5xl md:text-6xl font-black leading-[1.05] tracking-tight text-white">
                    Encuentra empleo o contrata
                    <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#25D366] to-[#128C7E]">
                      con rapidez.
                    </span>
                  </h1>
                  <p className="mt-5 text-lg leading-relaxed text-white/70 max-w-xl">
                    MyJob conecta candidatos y empresas con un flujo directo y conversacional. Menos fricción, más respuestas, más claridad.
                  </p>

                  <div className="mt-8 grid sm:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        trackEvent('home_cta_click', { cta_name: 'candidate_entry', target_path: '/empleos' });
                        navigate('/empleos');
                      }}
                      className="group relative overflow-hidden rounded-2xl border border-white/12 bg-white/[0.06] backdrop-blur-xl p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-[radial-gradient(circle_at_20%_10%,rgba(37,211,102,0.16),transparent_55%),radial-gradient(circle_at_80%_40%,rgba(7,94,84,0.14),transparent_60%)]" />
                      <div className="relative">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-bold text-white/60">Soy candidato</p>
                            <p className="mt-1 text-xl font-black text-white">Ver empleos</p>
                          </div>
                          <div className="h-11 w-11 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center">
                            <MessageCircle className="h-5 w-5 text-white" />
                          </div>
                        </div>
                        <p className="mt-3 text-sm text-white/70">Postúlate por WhatsApp y avanza más rápido.</p>
                        <div className="mt-5">
                          <Button className="rounded-xl h-11 px-5 font-bold bg-gradient-to-r from-[#25D366] to-[#128C7E] text-slate-950 hover:opacity-95">
                            Abrir empleos
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        trackEvent('home_cta_click', { cta_name: 'company_entry', target_path: '/buscar-candidatos' });
                        navigate('/buscar-candidatos');
                      }}
                      className="group relative overflow-hidden rounded-2xl border border-white/12 bg-white/[0.06] backdrop-blur-xl p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-[radial-gradient(circle_at_30%_20%,rgba(37,211,102,0.16),transparent_55%),radial-gradient(circle_at_70%_70%,rgba(7,94,84,0.14),transparent_60%)]" />
                      <div className="relative">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-bold text-white/60">Soy empresa</p>
                            <p className="mt-1 text-xl font-black text-white">Buscar candidatos</p>
                          </div>
                          <div className="h-11 w-11 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center">
                            <Building2 className="h-5 w-5 text-white" />
                          </div>
                        </div>
                        <p className="mt-3 text-sm text-white/70">Filtrado rápido, privacidad y contacto por WhatsApp.</p>
                        <div className="mt-5">
                          <Button variant="outline" className="rounded-xl h-11 px-5 font-bold border-white/15 bg-white/[0.06] text-white hover:bg-white/10">
                            Ir a la búsqueda
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </button>
                  </div>

                  <div className="mt-7 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/70">
                      <ShieldCheck className="h-4 w-4 text-white/70" />
                      Privacidad por defecto
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/70">
                      <Zap className="h-4 w-4 text-white/70" />
                      Poca fricción
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/70">
                      <Sparkles className="h-4 w-4 text-white/70" />
                      Interfaz clara
                    </span>
                  </div>
                </div>

                <div className="lg:col-span-6">
                  <Reveal delayMs={120}>
                    <div className="relative mx-auto max-w-xl flex justify-center">
                      <div className="motion-safe:animate-float">
                        <PhoneMockup />
                      </div>
                    </div>
                  </Reveal>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="relative py-20">
          <div className="container mx-auto px-4">
            <Reveal>
              <div className="flex items-start md:items-end justify-between gap-6 flex-col md:flex-row">
                <div className="max-w-2xl">
                  <p className="text-xs font-bold text-white/60">Por qué funciona</p>
                  <h2 className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white">
                    Experiencia rápida, con sensación de producto premium.
                  </h2>
                  <p className="mt-3 text-white/70 leading-relaxed">
                    Dejamos lo esencial a la vista y el resto en el contexto: menos ruido, más decisiones.
                  </p>
                </div>
              </div>
            </Reveal>

            <div className="mt-10 grid md:grid-cols-3 gap-6">
              <Reveal delayMs={40}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
                  <div className="h-11 w-11 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <MessageCircle className="h-5 w-5 text-white" />
                  </div>
                  <p className="mt-4 text-lg font-black text-white">WhatsApp-first</p>
                  <p className="mt-2 text-sm text-white/70 leading-relaxed">
                    Conversación directa y contexto claro. Para candidatos y para empresas.
                  </p>
                </div>
              </Reveal>
              <Reveal delayMs={90}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
                  <div className="h-11 w-11 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5 text-white" />
                  </div>
                  <p className="mt-4 text-lg font-black text-white">Privacidad</p>
                  <p className="mt-2 text-sm text-white/70 leading-relaxed">
                    Los datos sensibles quedan protegidos por defecto. Tú decides cuándo compartir contacto.
                  </p>
                </div>
              </Reveal>
              <Reveal delayMs={140}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
                  <div className="h-11 w-11 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <p className="mt-4 text-lg font-black text-white">Filtrado objetivo</p>
                  <p className="mt-2 text-sm text-white/70 leading-relaxed">
                    Menos pantallas y más claridad: rol, contexto y siguiente paso en un solo lugar.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="relative py-20 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,211,102,0.12),transparent_55%)]" />
          <div className="container mx-auto px-4 relative">
            <Reveal>
              <div className="flex items-start md:items-end justify-between gap-6 flex-col md:flex-row">
                <div className="max-w-2xl">
                  <p className="text-xs font-bold text-white/60">Confianza</p>
                  <h2 className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white">Lo que dicen las personas</h2>
                  <p className="mt-3 text-white/70 leading-relaxed">Opiniones breves y claras para reducir dudas y aumentar la acción.</p>
                </div>
                <Button
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/[0.06] text-white hover:bg-white/10"
                  onClick={() => {
                    trackEvent('home_cta_click', { cta_name: 'testimonials_jobs', target_path: '/empleos' });
                    navigate('/empleos');
                  }}
                >
                  Ver empleos
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Reveal>
            <div className="mt-10">
              <Reveal delayMs={100}>
                <TestimonialCarousel />
              </Reveal>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4">
            <Reveal>
              <div className="flex items-start md:items-end justify-between gap-6 flex-col md:flex-row">
                <div>
                  <p className="text-xs font-bold text-white/60">Explorar</p>
                  <h2 className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white">Categorías</h2>
                  <p className="mt-3 text-white/70">Encuentra la vacante ideal para ti.</p>
                </div>
                <Button
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/[0.06] text-white hover:bg-white/10"
                  onClick={() => {
                    trackEvent('home_cta_click', { cta_name: 'categories_view_all', target_path: '/empleos' });
                    navigate('/empleos');
                  }}
                >
                  Ver todas
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Reveal>

            <div className="mt-10 flex gap-4 overflow-x-auto pb-2">
              {CATEGORIES.map((cat, idx) => (
                <Reveal key={cat.value} from="none" delayMs={Math.min(idx * 30, 210)}>
                  <button
                    type="button"
                    onClick={() => {
                      trackEvent('home_category_click', { category_id: cat.value, category_name: cat.name });
                      navigate(`/empleos?categoria=${encodeURIComponent(cat.value)}`);
                    }}
                    className="group min-w-[220px] flex-shrink-0 rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
                  >
                    <p className="text-sm font-black text-white group-hover:text-[#25D366] transition-colors">{cat.name}</p>
                    <p className="mt-2 text-xs font-semibold text-white/60">
                      {(categoryCounts?.[cat.value] ?? 0).toLocaleString('es-MX')} vacantes
                    </p>
                  </button>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {recentJobs && recentJobs.length > 0 && (
          <section className="py-20">
            <div className="container mx-auto px-4">
              <Reveal>
                <div className="text-center max-w-2xl mx-auto">
                  <p className="text-xs font-bold text-white/60">Destacado</p>
                  <h2 className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white">Vacantes destacadas</h2>
                  <p className="mt-3 text-white/70">Postúlate por WhatsApp y avanza el mismo día.</p>
                </div>
              </Reveal>
              <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {recentJobs.map((job, idx) => (
                  <Reveal key={job.id} delayMs={Math.min(idx * 60, 240)}>
                    <JobCard job={job} />
                  </Reveal>
                ))}
              </div>
              <div className="mt-12 text-center">
                <Button
                  className="rounded-xl h-12 px-8 font-bold bg-gradient-to-r from-[#25D366] to-[#128C7E] text-slate-950 hover:opacity-95"
                  onClick={() => {
                    trackEvent('home_cta_click', { cta_name: 'featured_jobs_more', target_path: '/empleos' });
                    navigate('/empleos');
                  }}
                >
                  Ver más empleos
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </section>
        )}

        <section className="py-20 border-t border-white/10">
          <div className="container mx-auto px-4">
            <Reveal>
              <div className="text-center max-w-2xl mx-auto">
                <p className="text-xs font-bold text-white/60">Localização</p>
                <h2 className="mt-2 text-2xl md:text-3xl font-black tracking-tight text-white">Empleos por ciudad</h2>
                <p className="mt-3 text-white/70">Empieza desde donde ya estás.</p>
              </div>
            </Reveal>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              {CITIES.map((city, idx) => (
                <Reveal key={city} from="none" delayMs={Math.min(idx * 40, 240)}>
                  <button
                    type="button"
                    onClick={() => {
                      trackEvent('home_city_click', { city_name: city });
                      navigate(`/empleos?ciudad=${encodeURIComponent(city)}`);
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-5 py-2.5 text-sm font-bold text-white/80 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
                  >
                    <MapPin className="h-4 w-4" />
                    {city}
                  </button>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
};

export default Home;
