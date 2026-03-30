import { ReactNode } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const PublicLayout = ({ children }: { children: ReactNode }) => (
  <HelmetProvider>
    <div className="min-h-screen flex flex-col w-full bg-background text-foreground">
      <Navbar />
      <main className="flex-1 w-full" id="main-content" role="main">
        {children}
      </main>
      <Footer />
    </div>
  </HelmetProvider>
);

export default PublicLayout;
