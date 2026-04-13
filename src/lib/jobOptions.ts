export type Option = { id: string; label: string };

const simplify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const byId = (options: Option[]) => {
  const m = new Map<string, Option>();
  options.forEach((o) => m.set(o.id, o));
  return m;
};

const byLabel = (options: Option[]) => {
  const m = new Map<string, Option>();
  options.forEach((o) => m.set(simplify(o.label), o));
  return m;
};

/** PT/EN legacy labels → canonical id (same ids kept in DB). */
function legacyOptionId(normalizedLabel: string, options: Option[]): string | undefined {
  if (options === CATEGORY_OPTIONS) {
    const m: Record<string, string> = {
      saude: 'healthcare-medical',
      salud: 'healthcare-medical',
      'atendimento call center': 'call-center-customer-service',
      'atencion call center': 'call-center-customer-service',
      vendas: 'sales',
      logistica: 'mfg-transport-logistics',
      'logistica transporte': 'mfg-transport-logistics',
      servicos: 'trades-services',
      servicios: 'trades-services',
    };
    return m[normalizedLabel];
  }
  if (options === JOB_TYPE_OPTIONS) {
    const m: Record<string, string> = {
      'tempo integral': 'tempo-integral',
      'tiempo completo': 'tempo-integral',
      'meio periodo': 'meio-periodo',
      'medio tiempo': 'meio-periodo',
      'medio periodo': 'meio-periodo',
      temporario: 'temporario',
      temporal: 'temporario',
      freelancer: 'freelancer',
      estagio: 'estagio',
      estancia: 'estagio',
      practicas: 'estagio',
      pasantia: 'estagio',
      becario: 'estagio',
    };
    return m[normalizedLabel];
  }
  if (options === EDUCATION_LEVEL_OPTIONS) {
    const m: Record<string, string> = {
      'sem exigencia': 'sem-exigencia',
      'sin requisitos': 'sem-exigencia',
      'sin estudios': 'sem-exigencia',
      'ensino fundamental': 'fundamental',
      primaria: 'fundamental',
      'educacion primaria': 'fundamental',
      'ensino medio': 'medio',
      secundaria: 'medio',
      preparatoria: 'medio',
      bachillerato: 'medio',
      'ensino tecnico': 'tecnico',
      'carrera tecnica': 'tecnico',
      'ensino superior': 'superior',
      licenciatura: 'superior',
      universidad: 'superior',
      'pos graduacao': 'pos',
      posgrado: 'pos',
      maestria: 'pos',
    };
    return m[normalizedLabel];
  }
  if (options === EXPERIENCE_OPTIONS) {
    const m: Record<string, string> = {
      'sem experiencia': 'sem-experiencia',
      'sin experiencia': 'sem-experiencia',
      'ate 1 ano': 'ate-1-ano',
      'menos de 1 ano': 'ate-1-ano',
      'menos de 1 año': 'ate-1-ano',
      '1 2 anos': '1-2-anos',
      '1-2 anos': '1-2-anos',
      '1 2 años': '1-2-anos',
      '1-2 años': '1-2-anos',
      '3 5 anos': '3-5-anos',
      '3-5 anos': '3-5-anos',
      '3 5 años': '3-5-anos',
      '3-5 años': '3-5-anos',
      'mais de 5 anos': 'mais-5-anos',
      'mas de 5 anos': 'mais-5-anos',
      'más de 5 años': 'mais-5-anos',
    };
    return m[normalizedLabel];
  }
  if (options === PAYMENT_FREQUENCY_OPTIONS) {
    const m: Record<string, string> = {
      mensal: 'mensal',
      mensual: 'mensal',
      quinzenal: 'quinzenal',
      quincenal: 'quinzenal',
      semanal: 'semanal',
      diario: 'diario',
      hora: 'hora',
      'por hora': 'hora',
      'a combinar': 'a-combinar',
      'a convenir': 'a-combinar',
    };
    return m[normalizedLabel];
  }
  return undefined;
}

export const CATEGORY_OPTIONS: Option[] = [
  { id: 'healthcare-medical', label: 'Salud' },
  { id: 'call-center-customer-service', label: 'Atención / Call center' },
  { id: 'sales', label: 'Ventas' },
  { id: 'mfg-transport-logistics', label: 'Logística' },
  { id: 'trades-services', label: 'Servicios' },
];

export const CITY_OPTIONS: Option[] = [
  { id: 'ciudad-de-mexico', label: 'Ciudad de México' },
  { id: 'guadalajara', label: 'Guadalajara' },
  { id: 'monterrey', label: 'Monterrey' },
  { id: 'puebla', label: 'Puebla' },
  { id: 'tijuana', label: 'Tijuana' },
];

export const WORKPLACE_TYPE_OPTIONS: Option[] = [
  { id: 'presencial', label: 'Presencial' },
  { id: 'hibrido', label: 'Híbrido' },
  { id: 'remoto', label: 'Remoto' },
];

export const JOB_TYPE_OPTIONS: Option[] = [
  { id: 'tempo-integral', label: 'Tiempo completo' },
  { id: 'meio-periodo', label: 'Medio tiempo' },
  { id: 'temporario', label: 'Temporal' },
  { id: 'freelancer', label: 'Freelance' },
  { id: 'estagio', label: 'Prácticas' },
];

export const EDUCATION_LEVEL_OPTIONS: Option[] = [
  { id: 'sem-exigencia', label: 'Sin estudios requeridos' },
  { id: 'fundamental', label: 'Primaria' },
  { id: 'medio', label: 'Secundaria o preparatoria' },
  { id: 'tecnico', label: 'Carrera técnica' },
  { id: 'superior', label: 'Licenciatura' },
  { id: 'pos', label: 'Posgrado' },
];

export const EXPERIENCE_OPTIONS: Option[] = [
  { id: 'sem-experiencia', label: 'Sin experiencia' },
  { id: 'ate-1-ano', label: 'Menos de 1 año' },
  { id: '1-2-anos', label: '1–2 años' },
  { id: '3-5-anos', label: '3–5 años' },
  { id: 'mais-5-anos', label: 'Más de 5 años' },
];

export const PAYMENT_FREQUENCY_OPTIONS: Option[] = [
  { id: 'mensal', label: 'Mensual' },
  { id: 'quinzenal', label: 'Quincenal' },
  { id: 'semanal', label: 'Semanal' },
  { id: 'diario', label: 'Diario' },
  { id: 'hora', label: 'Por hora' },
  { id: 'a-combinar', label: 'A convenir' },
];

export const normalizeOptionId = (value: unknown, options: Option[]) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const idMap = byId(options);
  if (idMap.has(raw)) return raw;
  const labelMap = byLabel(options);
  const byLbl = labelMap.get(simplify(raw));
  if (byLbl) return byLbl.id;
  const leg = legacyOptionId(simplify(raw), options);
  if (leg && idMap.has(leg)) return leg;
  return raw;
};

export const optionLabel = (value: unknown, options: Option[]) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const idMap = byId(options);
  const id = normalizeOptionId(raw, options);
  return idMap.get(id)?.label ?? raw;
};

/** Google JobPosting: use OccupationalExperienceRequirements + months (free text triggers "invalid enum" in Rich Results). */
const EXPERIENCE_MONTHS_MAX: Record<string, number> = {
  'sem-experiencia': 0,
  'ate-1-ano': 12,
  '1-2-anos': 24,
  '3-5-anos': 60,
  'mais-5-anos': 120,
};

export function occupationalExperienceRequirements(value: unknown):
  | { '@type': 'OccupationalExperienceRequirements'; monthsOfExperience: number }
  | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const months = EXPERIENCE_MONTHS_MAX[raw];
  if (months === undefined) return undefined;
  if (months === 0) return undefined;
  return {
    '@type': 'OccupationalExperienceRequirements',
    monthsOfExperience: months,
  };
}

/** Google-supported beta shape for educationRequirements (EducationalOccupationalCredential). */
const EDUCATION_CREDENTIAL_CATEGORY: Record<string, string> = {
  fundamental: 'primary education',
  medio: 'high school',
  tecnico: 'technical certificate',
  superior: "bachelor's degree",
  pos: "master's degree",
};

export function educationRequirementsStructured(value: unknown):
  | { '@type': 'EducationalOccupationalCredential'; credentialCategory: string }
  | undefined {
  const id = normalizeOptionId(value, EDUCATION_LEVEL_OPTIONS);
  if (!id || id === 'sem-exigencia') return undefined;
  const credentialCategory = EDUCATION_CREDENTIAL_CATEGORY[id];
  if (!credentialCategory) return undefined;
  return {
    '@type': 'EducationalOccupationalCredential',
    credentialCategory,
  };
}
