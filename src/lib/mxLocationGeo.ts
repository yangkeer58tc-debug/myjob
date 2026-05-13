/**
 * MX post `para` → WGS-84 coordinates → human-readable `jobs.location`.
 * - Tries OpenStreetMap Nominatim reverse (browser; may fail CORS → fallback).
 * - Falls back to nearest major metro anchor (Haversine) within Mexico.
 *
 * Nominatim: max ~1 req/s when enabled (https://operations.osmfoundation.org/policies/nominatim/).
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rough centers (WGS-84) for common job markets — used when Nominatim is unavailable. */
const MX_METRO_ANCHORS: Array<{ label: string; lat: number; lon: number }> = [
  { label: 'Ciudad de México', lat: 19.4326, lon: -99.1332 },
  { label: 'Guadalajara', lat: 20.6597, lon: -103.3496 },
  { label: 'Monterrey', lat: 25.6866, lon: -100.3161 },
  { label: 'Puebla', lat: 19.0414, lon: -98.2063 },
  { label: 'Tijuana', lat: 32.5149, lon: -117.0382 },
  { label: 'León', lat: 21.125, lon: -101.686 },
  { label: 'Ciudad Juárez', lat: 31.6904, lon: -106.4245 },
  { label: 'Torreón', lat: 25.5428, lon: -103.4068 },
  { label: 'Querétaro', lat: 20.5888, lon: -100.3899 },
  { label: 'Mérida', lat: 20.9674, lon: -89.5926 },
  { label: 'San Luis Potosí', lat: 22.1565, lon: -100.9855 },
  { label: 'Aguascalientes', lat: 21.8853, lon: -102.2916 },
  { label: 'Mexicali', lat: 32.6245, lon: -115.4523 },
  { label: 'Culiacán', lat: 24.8069, lon: -107.3938 },
  { label: 'Chihuahua', lat: 28.6329, lon: -106.0691 },
  { label: 'Saltillo', lat: 25.4232, lon: -101.0053 },
  { label: 'Hermosillo', lat: 29.0729, lon: -110.9559 },
  { label: 'Veracruz', lat: 19.1738, lon: -96.1342 },
  { label: 'Xalapa', lat: 19.5312, lon: -96.9159 },
  { label: 'Villahermosa', lat: 17.9892, lon: -92.9281 },
  { label: 'Oaxaca', lat: 17.0732, lon: -96.7266 },
  { label: 'Cuernavaca', lat: 18.9312, lon: -99.2397 },
  { label: 'Cancún', lat: 21.1619, lon: -86.8515 },
  { label: 'Morelia', lat: 19.7008, lon: -101.1844 },
  { label: 'Tampico', lat: 22.2553, lon: -97.8686 },
  { label: 'Durango', lat: 24.0277, lon: -104.6532 },
  { label: 'Pachuca', lat: 20.1011, lon: -98.7591 },
  { label: 'Toluca', lat: 19.2823, lon: -99.6557 },
  { label: 'Zacatecas', lat: 22.7709, lon: -102.5833 },
  { label: 'Monclova', lat: 26.9089, lon: -101.4216 },
  { label: 'Los Mochis', lat: 25.7903, lon: -108.9969 },
  { label: 'Tuxtla Gutiérrez', lat: 16.7569, lon: -93.1292 },
  { label: 'Mazatlán', lat: 23.2494, lon: -106.4111 },
  { label: 'Acapulco', lat: 16.8531, lon: -99.8237 },
  { label: 'Celaya', lat: 20.5236, lon: -100.8157 },
  { label: 'Reynosa', lat: 26.0508, lon: -98.2978 },
];

const EARTH_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_KM * c;
}

function inMexicoRough(lat: number, lon: number): boolean {
  return lat >= 14 && lat <= 33 && lon >= -118 && lon <= -86;
}

/** Nearest anchor label if within `maxKm` (default 140 km). */
export function nearestMxMetroLabel(lat: number, lon: number, maxKm = 140): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inMexicoRough(lat, lon)) return null;
  let best: { label: string; d: number } | null = null;
  for (const a of MX_METRO_ANCHORS) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    if (!best || d < best.d) best = { label: a.label, d };
  }
  if (!best || best.d > maxKm) return null;
  return best.label;
}

/**
 * Read WGS-84 point from `para` key `66` JSON (`coordinate[0].latitude` / `.longitude`).
 */
export function parseCoordinatesFromPara66(para: string): { lat: number; lon: number } | null {
  if (!para?.trim()) return null;
  try {
    const o = JSON.parse(para) as Record<string, unknown>;
    const raw66 = o['66'];
    if (typeof raw66 !== 'string') return null;
    const inner = JSON.parse(raw66) as {
      coordinate?: Array<{ latitude?: number; longitude?: number; lat?: number; lng?: number; lon?: number }>;
    };
    const c0 = inner?.coordinate?.[0];
    if (!c0 || typeof c0 !== 'object') return null;
    const lat = Number(c0.latitude ?? c0.lat);
    const lon = Number(c0.longitude ?? c0.lng ?? c0.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

function formatNominatimAddress(data: {
  display_name?: string;
  address?: Record<string, string | undefined>;
}): string | null {
  const a = data.address || {};
  const line1 = [a.road, a.neighbourhood, a.suburb].filter(Boolean).join(', ');
  const city =
    a.city || a.town || a.village || a.municipality || a.city_district || a.county || '';
  const state = a.state || '';
  const parts = [line1, city, state].filter((x) => String(x).trim());
  if (parts.length === 0) {
    const dn = String(data.display_name ?? '').trim();
    return dn ? dn.slice(0, 120) : null;
  }
  const s = parts.join(', ').replace(/,\s*,/g, ',').trim();
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
}

/**
 * Reverse-geocode via OSM Nominatim (GET). May fail from browser (CORS / adblock) — caller should fall back.
 */
export async function reverseGeocodeNominatimEs(lat: number, lon: number): Promise<string | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'json');
  url.searchParams.set('accept-language', 'es');
  url.searchParams.set('zoom', '14');
  url.searchParams.set('addressdetails', '1');

  const referrer =
    typeof window !== 'undefined' ? `${window.location.origin}/` : 'https://myjob.com/';
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'es',
      Referer: referrer,
      // Nominatim policy: identify app
      'User-Agent': 'MyJob/1.0 (MX import; +https://myjob.com)',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Parameters<typeof formatNominatimAddress>[0];
  return formatNominatimAddress(data);
}

export type EnrichMxLocationOptions = {
  /** When false, only nearest-metro anchor (no HTTP). Default: true unless `VITE_MX_IMPORT_NOMINATIM=0`. */
  tryNominatim?: boolean;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Dedupe coordinates across rows, then set `mx_geocoded_location` on each row for `resolveMxJobLocation`.
 */
export async function enrichMxRowsWithGeocodedLocations(
  rows: Record<string, string>[],
  options?: EnrichMxLocationOptions,
): Promise<void> {
  const envOff = String(import.meta.env.VITE_MX_IMPORT_NOMINATIM ?? '').trim() === '0';
  const tryNominatim = options?.tryNominatim !== false && !envOff;

  const keyToIndices = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const c = parseCoordinatesFromPara66(String(rows[i].para ?? ''));
    if (!c) continue;
    const key = `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    if (!keyToIndices.has(key)) keyToIndices.set(key, []);
    keyToIndices.get(key)!.push(i);
  }

  const entries = [...keyToIndices.entries()];
  let done = 0;
  for (const [key, indices] of entries) {
    const [latS, lonS] = key.split(',');
    const lat = Number(latS);
    const lon = Number(lonS);

    let label: string | null = null;
    let usedNominatim = false;
    if (tryNominatim) {
      try {
        const n = await reverseGeocodeNominatimEs(lat, lon);
        if (n?.trim()) {
          label = n.trim();
          usedNominatim = true;
        }
      } catch {
        // CORS, network, etc.
      }
      if (usedNominatim) await sleep(1100);
    }

    if (!label) {
      label = nearestMxMetroLabel(lat, lon);
    }

    if (label) {
      for (const idx of indices) {
        rows[idx] = { ...rows[idx], mx_geocoded_location: label };
      }
    }

    done += 1;
    options?.onProgress?.(done, entries.length);
  }
}
