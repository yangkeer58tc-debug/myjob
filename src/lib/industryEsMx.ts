/**
 * Normalizes free-text industry labels (often English in IMC `ext`) to Mexican Spanish
 * for storage and JobPosting schema. Unknown values are returned trimmed as-is.
 */
const EN_TO_ES_MX: Record<string, string> = {
  healthcare: 'Salud',
  health: 'Salud',
  'health care': 'Salud',
  'health-care': 'Salud',
  medical: 'Salud',
  biotechnology: 'Biotecnología',
  biotech: 'Biotecnología',
  pharmaceutical: 'Farmacéutica',
  pharmaceuticals: 'Farmacéutica',
  pharma: 'Farmacéutica',
  technology: 'Tecnología',
  tech: 'Tecnología',
  it: 'Tecnologías de la información',
  software: 'Software',
  finance: 'Finanzas',
  financial: 'Servicios financieros',
  banking: 'Banca',
  insurance: 'Seguros',
  retail: 'Comercio minorista',
  ecommerce: 'Comercio electrónico',
  'e-commerce': 'Comercio electrónico',
  manufacturing: 'Manufactura',
  automotive: 'Automotriz',
  logistics: 'Logística',
  transportation: 'Transporte',
  education: 'Educación',
  construction: 'Construcción',
  energy: 'Energía',
  telecommunications: 'Telecomunicaciones',
  telecom: 'Telecomunicaciones',
  hospitality: 'Hotelería y turismo',
  tourism: 'Turismo',
  food: 'Alimentos y bebidas',
  'food & beverage': 'Alimentos y bebidas',
  agriculture: 'Agroindustria',
  mining: 'Minería',
  government: 'Sector público',
  nonprofit: 'Organización sin fines de lucro',
  consulting: 'Consultoría',
  marketing: 'Mercadotecnia',
  media: 'Medios de comunicación',
  entertainment: 'Entretenimiento',
  realestate: 'Bienes raíces',
  'real estate': 'Bienes raíces',
  legal: 'Servicios legales',
  hr: 'Recursos humanos',
  'human resources': 'Recursos humanos',
};

const simplifyKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function normalizeIndustryLabelForMexico(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const key = simplifyKey(raw);
  if (!key) return raw;
  const hit = EN_TO_ES_MX[key];
  if (hit) return hit;
  /* Already Spanish / other: keep (no false translation). */
  return raw;
}
