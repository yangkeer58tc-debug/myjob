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
          'Gostei porque é objetivo: você entende a vaga e já fala com a empresa. Sem cadastro longo, sem fricção.',
        score: 5,
        avatarSrc: img('portrait photo, brazilian woman, professional headshot, soft studio lighting, neutral background, high-end modern style, sharp focus, 50mm', 'square'),
      },
      {
        name: 'Rafael M.',
        role: 'Candidato',
        quote:
          'O fluxo pelo WhatsApp me ajudou a ter retorno mais rápido. A sensação é de conversa, não de formulário.',
        score: 5,
        avatarSrc: img('portrait photo, brazilian man, professional headshot, soft studio lighting, neutral background, high-end modern style, sharp focus, 50mm', 'square'),
      },
      {
        name: 'Camila A.',
        role: 'RH',
        company: 'Varejo',
        quote:
          'A busca por perfil é clara e o contato é destravado com contexto. Dá para avançar rápido com triagem simples.',
        score: 5,
        avatarSrc: img('portrait photo, latina woman, HR manager, professional headshot, soft studio lighting, neutral background, high-end modern style', 'square'),
      },
      {
        name: 'Bruno C.',
        role: 'Gestor',
        company: 'Logística',
        quote:
          'Para contratação, a parte de privacidade é importante. Aqui dá para avaliar antes de abrir contato.',
        score: 5,
        avatarSrc: img('portrait photo, brazilian man, manager, professional headshot, soft studio lighting, neutral background, high-end modern style', 'square'),
      },
      {
        name: 'Juliana P.',
        role: 'Candidata',
        quote:
          'Visual limpo, foco no essencial. Eu consegui aplicar sem ficar perdida em telas e filtros confusos.',
        score: 5,
        avatarSrc: img('portrait photo, brazilian woman, professional headshot, soft studio lighting, neutral background, high-end modern style', 'square'),
      },
    ],
    [],
  );

  const [api, setApi] = useState<CarouselApi>();
  const [paused, setPaused] = useState(false);

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
                        <Star key={i} className={cn('h-4 w-4', i < t.score ? 'text-[#00D4FF]' : 'text-white/20')} />
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
        <span className="h-1.5 w-14 rounded-full bg-gradient-to-r from-[#6A5CFF] to-[#00D4FF]" />
        <span className="h-1.5 w-3 rounded-full bg-white/15" />
        <span className="h-1.5 w-3 rounded-full bg-white/15" />
      </div>
    </div>
  );
};

export default TestimonialCarousel;

