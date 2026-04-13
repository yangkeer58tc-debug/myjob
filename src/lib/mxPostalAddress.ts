export type PostalAddressParts = {
  addressLocality: string;
  addressRegion?: string;
  postalCode?: string;
  streetAddress?: string;
};

function simplifyLocality(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Optional Google JobPosting address fields for major MX localities (label as stored in jobs.location).
 */
const LOCALITY_MAP: Array<{ match: (s: string) => boolean; addressRegion: string; postalCode?: string }> = [
  {
    match: (s) => s.includes('ciudad de mexico') || s.includes('cdmx') || s === 'mexico',
    addressRegion: 'Ciudad de México',
    postalCode: '06000',
  },
  {
    match: (s) => s.includes('quer') && s.includes('taro'),
    addressRegion: 'Querétaro',
    postalCode: '76000',
  },
  { match: (s) => s.includes('guadalajara'), addressRegion: 'Jalisco', postalCode: '44100' },
  { match: (s) => s.includes('monterrey'), addressRegion: 'Nuevo León', postalCode: '64000' },
  { match: (s) => s.includes('puebla'), addressRegion: 'Puebla', postalCode: '72000' },
  { match: (s) => s.includes('tijuana'), addressRegion: 'Baja California', postalCode: '22000' },
  { match: (s) => s.includes('leon'), addressRegion: 'Guanajuato', postalCode: '37000' },
  { match: (s) => s.includes('merida'), addressRegion: 'Yucatán', postalCode: '97000' },
];

export function postalAddressPartsForLocality(displayCity: string): PostalAddressParts {
  const locality = (displayCity || '').trim() || 'México';
  const s = simplifyLocality(locality);
  for (const row of LOCALITY_MAP) {
    if (row.match(s)) {
      return {
        addressLocality: locality,
        addressRegion: row.addressRegion,
        postalCode: row.postalCode,
      };
    }
  }
  return { addressLocality: locality };
}
