import { ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const PublicLayout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <>
      <Helmet htmlAttributes={{ lang: 'es-MX' }}>
        <meta name="geo.region" content="MX" />
      </Helmet>
      <div className={cn('min-h-screen flex flex-col w-full bg-background text-foreground', isHome && 'dark')}>
        <Navbar />
        <main className="flex-1 w-full" id="main-content" role="main">
          {children}
        </main>
        <Footer />
      </div>
    </>
  );
};

export default PublicLayout;
