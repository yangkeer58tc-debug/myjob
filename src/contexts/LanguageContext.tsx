import React, { createContext, useContext, useState, ReactNode } from 'react';

type Language = 'es' | 'en';

interface Translations {
  [key: string]: { es: string; en: string };
}

const translations: Translations = {
  // Navbar
  'nav.jobs': { es: 'Empleos', en: 'Jobs' },
  
  // Hero
  'hero.badge': { es: '⭐️ Calificado 4.8/5 por más de 10,000 usuarios', en: '⭐️ Rated 4.8/5 by 10,000+ users' },
  'hero.title': { es: 'Encuentra chamba rápido', en: 'Find work fast' },
  'hero.subtitle': { es: 'Postúlate en segundos directamente desde tu WhatsApp.', en: 'Apply in seconds directly from WhatsApp.' },
  'hero.cta': { es: 'Ver empleos', en: 'View jobs' },
  
  // Hot Cities
  'cities.title': { es: 'Ciudades populares', en: 'Popular cities' },
  
  // Hot Jobs
  'hotjobs.title': { es: 'Empleos recientes', en: 'Recent jobs' },
  'hotjobs.viewAll': { es: 'Ver todos', en: 'View all' },
  
  // Job List
  'joblist.title': { es: 'Empleos en', en: 'Jobs in' },
  'joblist.allCities': { es: 'Todas las ciudades', en: 'All cities' },
  'joblist.allJobs': { es: 'Todos los empleos', en: 'All jobs' },
  'joblist.noJobs': { es: 'No se encontraron empleos.', en: 'No jobs found.' },
  'joblist.filterCity': { es: 'Filtrar por ciudad', en: 'Filter by city' },
  
  // Job Detail
  'detail.breadHome': { es: 'Inicio', en: 'Home' },
  'detail.breadJobs': { es: 'Empleos', en: 'Jobs' },
  'detail.summary': { es: 'Resumen', en: 'Summary' },
  'detail.description': { es: 'Descripción del Puesto', en: 'Job Description' },
  'detail.requirements': { es: 'Requisitos', en: 'Requirements' },
  'detail.expired': { es: '⚠️ Esta vacante ya no está disponible.', en: '⚠️ This job is no longer available.' },
  'detail.closed': { es: 'Cerrado', en: 'Closed' },
  'detail.related': { es: 'Empleos similares', en: 'Similar jobs' },
  'detail.notFound': { es: 'Empleo no encontrado', en: 'Job not found' },
  
  // WhatsApp
  'wa.apply': { es: 'Postularse por WhatsApp', en: 'Apply via WhatsApp' },
  'wa.scanTitle': { es: 'Escanea para postularte', en: 'Scan to apply' },
  'wa.scanSubtext': { es: 'Abre la cámara de tu celular y escanea este código para postularte.', en: 'Open your phone camera and scan this code to apply.' },
  
  // Footer
  'footer.tagline': { es: 'Encuentra trabajo rápido y seguro.', en: 'Find work fast and safe.' },
  'footer.home': { es: 'Inicio', en: 'Home' },
  'footer.jobs': { es: 'Ver Empleos', en: 'View Jobs' },
  'footer.contact': { es: 'Contacto', en: 'Contact' },
  
  // Time
  'time.justNow': { es: 'Justo ahora', en: 'Just now' },
  'time.minutesAgo': { es: 'hace {n} min', en: '{n} min ago' },
  'time.hoursAgo': { es: 'hace {n}h', en: '{n}h ago' },
  'time.daysAgo': { es: 'hace {n}d', en: '{n}d ago' },
  
  // Admin
  'admin.title': { es: 'Panel de Administración', en: 'Admin Panel' },
  'admin.addJob': { es: 'Agregar Empleo', en: 'Add Job' },
  'admin.editJob': { es: 'Editar Empleo', en: 'Edit Job' },
  'admin.login': { es: 'Iniciar Sesión', en: 'Login' },
  'admin.logout': { es: 'Cerrar Sesión', en: 'Logout' },
  'admin.email': { es: 'Correo electrónico', en: 'Email' },
  'admin.password': { es: 'Contraseña', en: 'Password' },
  'admin.save': { es: 'Guardar', en: 'Save' },
  'admin.cancel': { es: 'Cancelar', en: 'Cancel' },
  'admin.archive': { es: 'Archivar', en: 'Archive' },
  'admin.activate': { es: 'Activar', en: 'Activate' },
  
  // Pagination
  'pagination.prev': { es: 'Anterior', en: 'Previous' },
  'pagination.next': { es: 'Siguiente', en: 'Next' },
  
  // Phone mockup
  'phone.bot1': { es: '¡Hola! Soy el asistente de MyJob. ¿Qué buscas?', en: "Hi! I'm the MyJob assistant. What are you looking for?" },
  'phone.user1': { es: 'Busco trabajo de Chofer', en: "I'm looking for a Driver job" },
};

interface LanguageContextType {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'es',
  setLang: () => {},
  t: (key) => key,
});

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLang] = useState<Language>('es');

  const t = (key: string, params?: Record<string, string | number>) => {
    const entry = translations[key];
    if (!entry) return key;
    let text = entry[lang] || entry.es;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
