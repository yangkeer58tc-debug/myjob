import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

const Navbar = () => {
  const { t } = useLanguage();
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <nav
      className={cn(
        'sticky top-0 z-50 w-full backdrop-blur supports-[backdrop-filter]:bg-background/60',
        isHome ? 'dark bg-transparent' : 'border-b border-border bg-background/95',
      )}
    >
      <div
        className={cn(
          'container flex h-16 items-center justify-between',
          isHome
            ? 'mt-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] supports-[backdrop-filter]:bg-white/[0.06]'
            : '',
        )}
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center transition-all overflow-hidden border',
              isHome
                ? 'bg-white/5 border-white/10 group-hover:bg-white/10'
                : 'bg-primary/10 border-transparent group-hover:bg-primary/20',
            )}
          >
            <img src="/brand-logo.jpg" alt="MyJob Logo" className="w-full h-full object-cover" />
          </div>
          <span className={cn('text-xl font-black tracking-tight', isHome ? 'text-white' : 'text-foreground')}>
            My<span className={cn(isHome ? 'text-[#25D366]' : 'text-primary')}>Job</span>
          </span>
        </Link>
        
        <div className="flex items-center space-x-6">
          <Link
            to="/empleos"
            className={cn(
              'text-sm font-medium transition-colors',
              isHome ? 'rounded-full px-3 py-2 text-white/75 hover:text-white hover:bg-white/5' : 'text-muted-foreground hover:text-primary',
            )}
          >
            {t('nav.jobs')}
          </Link>
          <Link
            to="/buscar-candidatos"
            className={cn(
              'text-sm font-medium transition-colors',
              isHome ? 'rounded-full px-3 py-2 text-white/75 hover:text-white hover:bg-white/5' : 'text-muted-foreground hover:text-primary',
            )}
          >
            {t('nav.candidates')}
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
