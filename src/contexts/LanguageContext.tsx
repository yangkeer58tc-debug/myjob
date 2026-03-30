import React, { createContext, useContext, ReactNode } from 'react';

type Language = 'pt';

interface Translations {
  [key: string]: { pt: string };
}

const translations: Translations = {
  // Navbar
  'nav.jobs': { pt: 'Vagas' },
  
  // Hero
  'hero.badge': { pt: '⭐️ Avaliado com 4.8/5 por mais de 10.000 usuários' },
  'hero.title': { pt: 'Encontre trabalho rápido' },
  'hero.subtitle': { pt: 'Candidate-se em segundos diretamente do seu WhatsApp.' },
  'hero.cta': { pt: 'Ver Vagas' },
  
  // Hot Cities
  'cities.title': { pt: 'Cidades populares' },
  
  // Hot Jobs
  'hotjobs.title': { pt: 'Vagas recentes' },
  'hotjobs.viewAll': { pt: 'Ver todas' },
  
  // Job List
  'joblist.title': { pt: 'Vagas em' },
  'joblist.allCities': { pt: 'Todas as cidades' },
  'joblist.allJobs': { pt: 'Todas as vagas' },
  'joblist.noJobs': { pt: 'Nenhuma vaga encontrada.' },
  'joblist.filterCity': { pt: 'Filtrar por cidade' },
  
  // Job Detail
  'detail.breadHome': { pt: 'Início' },
  'detail.breadJobs': { pt: 'Vagas' },
  'detail.description': { pt: 'Descrição da Vaga' },
  'detail.requirements': { pt: 'Requisitos' },
  'detail.expired': { pt: '⚠️ Esta vaga não está mais disponível.' },
  'detail.closed': { pt: 'Encerrada' },
  'detail.related': { pt: 'Vagas similares' },
  'detail.notFound': { pt: 'Vaga não encontrada' },
  
  // WhatsApp
  'wa.apply': { pt: 'Candidatar-se pelo WhatsApp' },
  'wa.scanTitle': { pt: 'Escaneie para se candidatar' },
  'wa.scanSubtext': { pt: 'Abra a câmera do seu celular e escaneie este código para se candidatar.' },
  
  // Footer
  'footer.tagline': { pt: 'Encontre trabalho rápido e seguro.' },
  'footer.home': { pt: 'Início' },
  'footer.jobs': { pt: 'Ver Vagas' },
  'footer.contact': { pt: 'Contato' },
  
  // Time
  'time.justNow': { pt: 'Agora mesmo' },
  'time.minutesAgo': { pt: 'há {n} min' },
  'time.hoursAgo': { pt: 'há {n}h' },
  'time.daysAgo': { pt: 'há {n}d' },
  
  // Admin
  'admin.title': { pt: 'Painel de Administração' },
  'admin.addJob': { pt: 'Adicionar Vaga' },
  'admin.editJob': { pt: 'Editar Vaga' },
  'admin.login': { pt: 'Entrar' },
  'admin.logout': { pt: 'Sair' },
  'admin.email': { pt: 'E-mail' },
  'admin.password': { pt: 'Senha' },
  'admin.save': { pt: 'Salvar' },
  'admin.cancel': { pt: 'Cancelar' },
  'admin.archive': { pt: 'Arquivar' },
  'admin.activate': { pt: 'Ativar' },
  
  // Pagination
  'pagination.prev': { pt: 'Anterior' },
  'pagination.next': { pt: 'Próxima' },
  
  // Phone mockup
  'phone.bot1': { pt: 'Olá! Sou o assistente do MyJob. O que você procura?' },
  'phone.user1': { pt: 'Procuro vaga de Motorista' },
};

interface LanguageContextType {
  lang: Language;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'pt',
  t: () => '',
});

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const t = (key: string, params?: Record<string, string | number>) => {
    let text = translations[key]?.['pt'] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

  return (
    <LanguageContext.Provider value={{ lang: 'pt', t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
