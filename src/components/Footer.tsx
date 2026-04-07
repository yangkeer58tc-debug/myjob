import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

const Footer = () => {
  const { t } = useLanguage();
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <footer className={cn('border-t', isHome ? 'dark border-white/10 bg-background' : 'border-border bg-background')}>
      <div className="container flex flex-col items-center justify-between gap-4 py-10 md:h-24 md:flex-row md:py-0">
        <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden border',
              isHome ? 'bg-white/5 border-white/10' : 'bg-primary/10 border-transparent',
            )}
          >
            <img src="/brand-logo.jpg" alt="MyJob Logo" className="w-full h-full object-cover" />
          </div>
          <p className={cn('text-center text-sm leading-loose md:text-left', isHome ? 'text-white/60' : 'text-muted-foreground')}>
            Built by{" "}
            <span className={cn('font-bold tracking-tight', isHome ? 'text-white' : 'text-foreground')}>
              My<span className={cn(isHome ? 'text-[#00D4FF]' : 'text-primary')}>Job</span>
            </span>
            . The platform for the next generation of workers.
          </p>
        </div>
        <div className={cn('flex items-center space-x-4 text-sm font-medium', isHome ? 'text-white/60' : 'text-muted-foreground')}>
          <Link to="/" className={cn('transition-colors', isHome ? 'hover:text-white' : 'hover:text-primary')}>
            {t('footer.home')}
          </Link>
          <Link to="/empleos" className={cn('transition-colors', isHome ? 'hover:text-white' : 'hover:text-primary')}>
            {t('footer.jobs')}
          </Link>
          <a
            href="https://wa.me/5218132689375"
            target="_blank"
            rel="noopener noreferrer"
            className={cn('transition-colors', isHome ? 'hover:text-white' : 'hover:text-primary')}
          >
            {t('footer.contact')}
          </a>
        </div>
      </div>
      <div className={cn('container border-t py-6 text-center text-xs', isHome ? 'border-white/10 text-white/50' : 'border-border text-muted-foreground')}>
        © 2026 MyJob. All rights reserved.
      </div>
    </footer>
  );
};

export default Footer;
