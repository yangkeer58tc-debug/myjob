export const SEO_CITIES = [
  { slug: 'ciudad-de-mexico', name: 'Ciudad de México' },
  { slug: 'guadalajara', name: 'Guadalajara' },
  { slug: 'monterrey', name: 'Monterrey' },
  { slug: 'puebla', name: 'Puebla' },
  { slug: 'tijuana', name: 'Tijuana' },
] as const;

export const SEO_ROLES = [
  { slug: 'chofer', query: 'chofer', label: 'Chofer' },
  { slug: 'ayudante-general', query: 'ayudante general', label: 'Ayudante general' },
  { slug: 'seguridad', query: 'seguridad', label: 'Seguridad' },
  { slug: 'cajero', query: 'cajero', label: 'Cajero' },
  { slug: 'atencion-al-cliente', query: 'atencion al cliente', label: 'Atencion al cliente' },
  { slug: 'almacenista', query: 'almacenista', label: 'Almacenista' },
] as const;

export const seoCityBySlug = (slug: string) => SEO_CITIES.find((c) => c.slug === String(slug || '').trim());
export const seoRoleBySlug = (slug: string) => SEO_ROLES.find((r) => r.slug === String(slug || '').trim());

export const seoCityPath = (citySlug: string) => `/empleos-en/${citySlug}`;
export const seoCityRolePath = (citySlug: string, roleSlug: string) => `/empleos-en/${citySlug}/${roleSlug}`;
