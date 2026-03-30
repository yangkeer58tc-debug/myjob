import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Briefcase } from 'lucide-react';

const Footer = () => {
  const { t } = useLanguage();

  return (
    <footer className="border-t bg-background">
      <div className="container flex flex-col items-center justify-between gap-4 py-10 md:h-24 md:flex-row md:py-0">
        <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
          <Briefcase className="h-6 w-6 text-primary" />
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built by{" "}
            <span className="font-bold text-foreground tracking-tight">
              My<span className="text-primary">Job</span>
            </span>
            . The platform for the next generation of workers.
          </p>
        </div>
        <div className="flex items-center space-x-4 text-sm font-medium text-muted-foreground">
          <Link to="/" className="hover:text-primary transition-colors">{t('footer.home')}</Link>
          <Link to="/empleos" className="hover:text-primary transition-colors">{t('footer.jobs')}</Link>
          <a
            href="https://wa.me/5215512345678"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            {t('footer.contact')}
          </a>
        </div>
      </div>
      <div className="container border-t py-6 text-center text-xs text-muted-foreground">
        © 2026 MyJob. All rights reserved.
      </div>
    </footer>
  );
};

export default Footer;
