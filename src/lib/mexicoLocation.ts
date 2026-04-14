/** Ciudades y zonas metropolitanas frecuentes (orden alfabético para el desplegable). */
const MEXICO_CITIES = [
  'Aguascalientes',
  'Cancún',
  'Chihuahua',
  'Ciudad de México',
  'Ciudad Juárez',
  'Culiacán',
  'Cuernavaca',
  'Durango',
  'Guadalajara',
  'Hermosillo',
  'León',
  'Los Mochis',
  'Mérida',
  'Mexicali',
  'Monclova',
  'Monterrey',
  'Morelia',
  'Oaxaca',
  'Pachuca',
  'Puebla',
  'Querétaro',
  'Saltillo',
  'San Luis Potosí',
  'Tampico',
  'Tijuana',
  'Toluca',
  'Torreón',
  'Tuxtla Gutiérrez',
  'Veracruz',
  'Villahermosa',
  'Xalapa',
  'Zacatecas',
];

const hashString = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
};

export const mexicoCityForJobId = (jobId: unknown) => {
  const raw = String(jobId ?? '').trim();
  const seed = raw || '0';
  const idx = hashString(seed) % MEXICO_CITIES.length;
  return MEXICO_CITIES[idx] || 'Ciudad de México';
};

/** Prefer DB `location` when set; otherwise deterministic city from id (legacy). */
export const displayCityForJob = (job: { id: unknown; location?: string | null }) => {
  const loc = String(job.location ?? '').trim();
  if (loc) return loc;
  return mexicoCityForJobId(job.id);
};

export const mexicoCities = () => [...MEXICO_CITIES];

