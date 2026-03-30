import { Link } from 'react-router-dom';
import { Globe, Briefcase } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';

const Navbar = () => {
  const { lang, setLang, t } = useLanguage();

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center space-x-2">
          <Briefcase className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold tracking-tight text-foreground">
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
          
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
              className="h-8 px-2 text-xs font-bold uppercase tracking-wider"
            >
              <Globe className="mr-2 h-3 w-3" />
              {lang === 'es' ? 'EN' : 'ES'}
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
