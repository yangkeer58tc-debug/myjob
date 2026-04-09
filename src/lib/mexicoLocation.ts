const MEXICO_CITIES = [
  'Ciudad de México',
  'Guadalajara',
  'Monterrey',
  'Puebla',
  'Tijuana',
  'León',
  'Querétaro',
  'Mérida',
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

export const mexicoCities = () => [...MEXICO_CITIES];

