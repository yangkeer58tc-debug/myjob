import { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { Carousel, CarouselApi, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { cn } from '@/lib/utils';

type Testimonial = {
  name: string;
  role: string;
  company?: string;
  quote: string;
  score?: number;
  avatarSrc: string;
};

const encodePrompt = (s: string) => encodeURIComponent(s);

const img = (prompt: string, size: string = 'square') =>
  `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodePrompt(prompt)}&image_size=${size}`;

const TestimonialCarousel = ({ className }: { className?: string }) => {
  const testimonials = useMemo<Testimonial[]>(
    () => [
      {
        name: 'Mariana S.',
        role: 'Candidata',
        quote:
          'Me gustó porque es directo: entiendes la vacante y hablas con la empresa. Sin registro largo y sin fricción.',
        score: 5,
        avatarSrc: img('portrait photo, mexican woman, professional headshot, soft studio lighting, neutral background, high-end modern style, sharp focus, 50mm', 'square'),
      },
      {
        name: 'Rafael M.',
        role: 'Candidato',
        quote:
          'El flujo por WhatsApp me ayudó a tener respuesta más rápido. Se siente como una conversación, no como un formulario.',
        score: 5,
        avatarSrc: img('portrait photo, mexican man, professional headshot, soft studio lighting, neutral background, high-end modern style, sharp focus, 50mm', 'square'),
      },
      {
        name: 'Camila A.',
        role: 'RR. HH.',
        company: 'Retail',
        quote:
          'La búsqueda de perfiles es clara y el contacto se abre con contexto. Se puede avanzar rápido con un filtrado simple.',
        score: 5,
        avatarSrc: img('portrait photo, latina woman, HR manager, professional headshot, soft studio lighting, neutral background, high-end modern style', 'square'),
      },
      {
        name: 'Bruno C.',
        role: 'Gerente',
        company: 'Logística',
        quote:
          'Para contratar, la privacidad importa. Aquí puedes evaluar antes de abrir el contacto.',
        score: 5,
        avatarSrc: img('portrait photo, mexican man, manager, professional headshot, soft studio lighting, neutral background, high-end modern style', 'square'),
      },
      {
        name: 'Juliana P.',
        role: 'Candidata',
        quote:
          'Interfaz limpia y foco en lo esencial. Pude postularme sin perderme en pantallas y filtros confusos.',
        score: 5,
        avatarSrc: img('portrait photo, mexican woman, professional headshot, soft studio lighting, neutral background, high-end modern style', 'square'),
      },
    ],
    [],
  );

  const [api, setApi] = useState<CarouselApi>();
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!api) return;
    const init = () => {
      setCount(api.scrollSnapList().length);
      setSelected(api.selectedScrollSnap());
    };
    init();
    api.on('reInit', init);
    api.on('select', () => setSelected(api.selectedScrollSnap()));
  }, [api]);

  useEffect(() => {
    if (!api) return;
    if (paused) return;
    const id = window.setInterval(() => api.scrollNext(), 6500);
    return () => window.clearInterval(id);
  }, [api, paused]);

  return (
    <div
      className={cn('relative', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Carousel
        setApi={setApi}
        opts={{ align: 'start', loop: true, skipSnaps: false }}
        className="px-1"
      >
        <CarouselContent className="-ml-6">
          {testimonials.map((t) => (
            <CarouselItem key={t.name} className="pl-6 md:basis-1/2 lg:basis-1/3">
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-2xl overflow-hidden border border-white/10 bg-white/5">
                      <img src={t.avatarSrc} alt={t.name} className="h-full w-full object-cover" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">{t.name}</p>
                      <p className="text-xs font-semibold text-white/60">
                        {t.role}
                        {t.company ? ` · ${t.company}` : ''}
                      </p>
                    </div>
                  </div>
                  {typeof t.score === 'number' && (
                    <div className="flex items-center gap-1 text-white/70">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={cn('h-4 w-4', i < t.score ? 'text-[#25D366]' : 'text-white/20')}
                          fill={i < t.score ? 'currentColor' : 'none'}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-white/75">“{t.quote}”</p>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious variant="outline" className="-left-10 border-white/15 bg-white/[0.06] text-white hover:bg-white/10" />
        <CarouselNext variant="outline" className="-right-10 border-white/15 bg-white/[0.06] text-white hover:bg-white/10" />
      </Carousel>
      <div className="mt-5 flex justify-center gap-2">
        {Array.from({ length: Math.max(count, 1) }).map((_, i) => {
          const isActive = i === selected;
          return (
            <button
              key={i}
              type="button"
              onClick={() => api?.scrollTo(i)}
              aria-label={`Ir al testimonio ${i + 1}`}
              className="rounded-full"
            >
              {isActive ? (
                <span className="block h-1.5 w-14 rounded-full bg-gradient-to-r from-[#25D366] to-[#128C7E] bg-[length:200%_200%] motion-safe:animate-gradient-x" />
              ) : (
                <span className="block h-1.5 w-3 rounded-full bg-white/15" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TestimonialCarousel;
