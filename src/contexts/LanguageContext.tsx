import React, { createContext, useContext, ReactNode } from 'react';

type Language = 'es';

interface Translations {
  [key: string]: { es: string };
}

const translations: Translations = {
  // Navbar
  'nav.jobs': { es: 'Empleos' },
  'nav.candidates': { es: 'Candidatos' },

  // Hero
  'hero.badge': { es: '⭐️ Calificado con 4.8/5 por más de 10,000 usuarios' },
  'hero.title': { es: 'Encuentra trabajo rápido' },
  'hero.subtitle': { es: 'Postúlate en segundos desde tu WhatsApp.' },
  'hero.cta': { es: 'Ver empleos' },

  // Hot Cities
  'cities.title': { es: 'Ciudades populares' },

  // Hot Jobs
  'hotjobs.title': { es: 'Empleos recientes' },
  'hotjobs.viewAll': { es: 'Ver todos' },

  // Job List
  'joblist.title': { es: 'Empleos en' },
  'joblist.allCities': { es: 'Todas las ciudades' },
  'joblist.allJobs': { es: 'Todos los empleos' },
  'joblist.noJobs': { es: 'No se encontraron vacantes.' },
  'joblist.filterCity': { es: 'Filtrar por ciudad' },
  'joblist.searchPlaceholder': { es: 'Buscar por puesto, empresa o palabras clave…' },
  'joblist.search': { es: 'Buscar' },
  'joblist.clearFilters': { es: 'Limpiar filtros' },
  'joblist.jobTypeFilter': { es: 'Tipo de empleo' },
  'joblist.workplaceFilter': { es: 'Modalidad' },
  'joblist.paymentFilter': { es: 'Frecuencia de pago' },
  'joblist.educationFilter': { es: 'Educación' },
  'joblist.experienceFilter': { es: 'Experiencia' },
  'joblist.filterAll': { es: 'Todos' },

  // Job Detail
  'detail.breadHome': { es: 'Inicio' },
  'detail.breadJobs': { es: 'Empleos' },
  'detail.summary': { es: 'Resumen de la vacante' },
  'detail.description': { es: 'Descripción de la vacante' },
  'detail.requirements': { es: 'Requisitos' },
  'detail.expired': { es: '⚠️ Esta vacante ya no está disponible.' },
  'detail.closed': { es: 'Cerrada' },
  'detail.related': { es: 'Empleos similares' },
  'detail.notFound': { es: 'Vacante no encontrada' },

  // WhatsApp
  'wa.apply': { es: 'Postular por WhatsApp' },
  'wa.scanTitle': { es: 'Escanea para postularte' },
  'wa.scanSubtext': { es: 'Abre la cámara de tu celular y escanea este código para postularte.' },
  'wa.defaultMessage': {
    es: '¡Hola! Me interesa la vacante de {jobTitle} en {bName} que vi en MyJob.',
  },

  // Footer
  'footer.tagline': { es: 'Encuentra trabajo rápido y seguro.' },
  'footer.home': { es: 'Inicio' },
  'footer.jobs': { es: 'Ver empleos' },
  'footer.contact': { es: 'Contacto' },

  // Time (reserved for future t()-based relative time)
  'time.justNow': { es: 'Justo ahora' },
  'time.minutesAgo': { es: 'hace {n} min' },
  'time.hoursAgo': { es: 'hace {n} h' },
  'time.daysAgo': { es: 'hace {n} d' },

  // Admin
  'admin.title': { es: 'Panel de administración' },
  'admin.addJob': { es: 'Agregar vacante' },
  'admin.editJob': { es: 'Editar vacante' },
  'admin.login': { es: 'Iniciar sesión' },
  'admin.logout': { es: 'Cerrar sesión' },
  'admin.email': { es: 'Correo electrónico' },
  'admin.password': { es: 'Contraseña' },
  'admin.save': { es: 'Guardar' },
  'admin.cancel': { es: 'Cancelar' },
  'admin.archive': { es: 'Archivar' },
  'admin.activate': { es: 'Activar' },

  // Pagination
  'pagination.prev': { es: 'Anterior' },
  'pagination.next': { es: 'Siguiente' },

  // Phone mockup (if wired to t() later)
  'phone.bot1': { es: '¡Hola! Soy el asistente de MyJob. ¿Qué estás buscando?' },
  'phone.user1': { es: 'Busco vacante de conductor' },
};

interface LanguageContextType {
  lang: Language;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'es',
  t: () => '',
});

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const t = (key: string, params?: Record<string, string | number>) => {
    let text = translations[key]?.['es'] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

  return (
    <LanguageContext.Provider value={{ lang: 'es', t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
