import { describe, expect, it } from 'vitest';
import {
  nearestMxMetroLabel,
  parseCoordinatesFromPara66,
} from '@/lib/mxLocationGeo';
import { resolveMxJobLocation } from '@/lib/okMxJobImport';

describe('parseCoordinatesFromPara66', () => {
  it('reads WGS-84 from para key 66', () => {
    const inner = {
      detail: 'Mexico City',
      standard: { locality: 'Mexico City', country: 'Mexico' },
      coordinate: [{ longitude: -99.133208, latitude: 19.4326077, axes: 'WGS-84' }],
    };
    const para = JSON.stringify({ '60': '1', '66': JSON.stringify(inner) });
    const c = parseCoordinatesFromPara66(para);
    expect(c).toEqual({ lat: 19.4326077, lon: -99.133208 });
  });
});

describe('nearestMxMetroLabel', () => {
  it('maps CDMX coordinates to Ciudad de México', () => {
    expect(nearestMxMetroLabel(19.4326077, -99.133208)).toBe('Ciudad de México');
  });
});

describe('resolveMxJobLocation + mx_geocoded_location', () => {
  it('prefers pre-enriched geocode string', () => {
    const row = {
      para: '',
      mx_geocoded_location: 'Colonia Centro, Cuauhtémoc, Ciudad de México, CDMX',
    };
    expect(resolveMxJobLocation(row)).toBe('Colonia Centro, Cuauhtémoc, Ciudad de México, CDMX');
  });
});
