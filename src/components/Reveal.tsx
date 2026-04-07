import { ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type RevealProps = {
  children: ReactNode;
  className?: string;
  from?: 'none' | 'bottom' | 'top';
  once?: boolean;
  delayMs?: number;
};

const Reveal = ({ children, className, from = 'bottom', once = true, delayMs = 0 }: RevealProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setIsInView(true);
          if (once) obs.disconnect();
        } else if (!once) {
          setIsInView(false);
        }
      },
      { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [once]);

  const fromCls =
    from === 'none'
      ? ''
      : from === 'top'
        ? 'translate-y-[-10px]'
        : 'translate-y-[10px]';

  return (
    <div
      ref={ref}
      className={cn(
        'transition-all duration-500 ease-out will-change-transform',
        !isInView && 'opacity-0',
        !isInView && fromCls,
        isInView && 'opacity-100 translate-y-0',
        className,
      )}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
};

export default Reveal;

