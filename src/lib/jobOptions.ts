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

export const CATEGORY_OPTIONS: Option[] = [
  { id: 'healthcare-medical', label: 'Saúde' },
  { id: 'call-center-customer-service', label: 'Atendimento / Call Center' },
  { id: 'sales', label: 'Vendas' },
  { id: 'mfg-transport-logistics', label: 'Logística' },
  { id: 'trades-services', label: 'Serviços' },
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
  { id: 'tempo-integral', label: 'Tempo Integral' },
  { id: 'meio-periodo', label: 'Meio Período' },
  { id: 'temporario', label: 'Temporário' },
  { id: 'freelancer', label: 'Freelancer' },
  { id: 'estagio', label: 'Estágio' },
];

export const EDUCATION_LEVEL_OPTIONS: Option[] = [
  { id: 'sem-exigencia', label: 'Sem exigência' },
  { id: 'fundamental', label: 'Ensino Fundamental' },
  { id: 'medio', label: 'Ensino Médio' },
  { id: 'tecnico', label: 'Ensino Técnico' },
  { id: 'superior', label: 'Ensino Superior' },
  { id: 'pos', label: 'Pós-graduação' },
];

export const EXPERIENCE_OPTIONS: Option[] = [
  { id: 'sem-experiencia', label: 'Sem experiência' },
  { id: 'ate-1-ano', label: 'Até 1 ano' },
  { id: '1-2-anos', label: '1–2 anos' },
  { id: '3-5-anos', label: '3–5 anos' },
  { id: 'mais-5-anos', label: 'Mais de 5 anos' },
];

export const PAYMENT_FREQUENCY_OPTIONS: Option[] = [
  { id: 'mensal', label: 'Mensal' },
  { id: 'quinzenal', label: 'Quinzenal' },
  { id: 'semanal', label: 'Semanal' },
  { id: 'diario', label: 'Diário' },
  { id: 'hora', label: 'Por hora' },
  { id: 'a-combinar', label: 'A combinar' },
];

export const normalizeOptionId = (value: unknown, options: Option[]) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const idMap = byId(options);
  if (idMap.has(raw)) return raw;
  const labelMap = byLabel(options);
  const byLbl = labelMap.get(simplify(raw));
  return byLbl ? byLbl.id : raw;
};

export const optionLabel = (value: unknown, options: Option[]) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const idMap = byId(options);
  const byIdHit = idMap.get(raw);
  if (byIdHit) return byIdHit.label;
  const labelMap = byLabel(options);
  const byLblHit = labelMap.get(simplify(raw));
  return byLblHit ? byLblHit.label : raw;
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
