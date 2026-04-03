import { Link } from 'react-router-dom';
import { Globe, Briefcase } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';

const Navbar = () => {
  const { t } = useLanguage();

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center group-hover:bg-primary/20 transition-colors overflow-hidden">
            <img src="/logo.svg" alt="MyJob Logo" className="w-full h-full object-cover" />
          </div>
          <span className="text-xl font-black tracking-tight text-foreground">
            My<span className="text-primary">Job</span>
          </span>
        </Link>
        
        <div className="flex items-center space-x-6">
          <Link
            to="/empleos"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            {t('nav.jobs')}
          </Link>
          <Link
            to="/buscar-candidatos"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            {t('nav.candidates')}
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
