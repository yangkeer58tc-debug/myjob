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
        'sticky top-0 z-50 w-full border-b backdrop-blur supports-[backdrop-filter]:bg-background/60',
        isHome ? 'dark border-white/10 bg-transparent' : 'border-border bg-background/95',
      )}
    >
      <div className="container flex h-16 items-center justify-between">
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
              isHome ? 'text-white/70 hover:text-white' : 'text-muted-foreground hover:text-primary',
            )}
          >
            {t('nav.jobs')}
          </Link>
          <Link
            to="/buscar-candidatos"
            className={cn(
              'text-sm font-medium transition-colors',
              isHome ? 'text-white/70 hover:text-white' : 'text-muted-foreground hover:text-primary',
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
