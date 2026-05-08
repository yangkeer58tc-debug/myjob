// Tests for the pure parsing helpers used by the WhatsApp bot Edge Function.
// We import directly from the supabase/functions tree because vitest is
// configured to discover tests under src/, but TS+SWC handles the relative
// path import fine.

import { describe, expect, it } from 'vitest';
import {
  extFromMime,
  isExplicitNo,
  isStrictSi,
  normalizeOptInText,
  sanitizeName,
  toE164ForRmc,
} from '../../supabase/functions/whatsapp-webhook/parsing';

describe('sanitizeName', () => {
  it('accepts a plain Latin name', () => {
    expect(sanitizeName('Juan Pérez')).toBe('Juan Pérez');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeName('  María   José  ')).toBe('María José');
  });

  it('truncates to 80 chars', () => {
    const long = 'A'.repeat(120);
    expect(sanitizeName(long)?.length).toBe(80);
  });

  it('rejects empty / whitespace-only input', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   ')).toBeNull();
  });

  it('rejects strings without any letter', () => {
    expect(sanitizeName('123 456')).toBeNull();
    expect(sanitizeName('!!!')).toBeNull();
    expect(sanitizeName('🙂🙂🙂')).toBeNull();
  });

  it('rejects strings that look like URLs', () => {
    expect(sanitizeName('https://example.com')).toBeNull();
    expect(sanitizeName('Visita www.foo.com')).toBeNull();
  });

  it('rejects too-short names', () => {
    expect(sanitizeName('A')).toBeNull();
  });
});

describe('isStrictSi', () => {
  it('matches plain "si" and "sí"', () => {
    expect(isStrictSi('si')).toBe(true);
    expect(isStrictSi('Si')).toBe(true);
    expect(isStrictSi('SI')).toBe(true);
    expect(isStrictSi('sí')).toBe(true);
    expect(isStrictSi('Sí')).toBe(true);
  });

  it('tolerates trailing punctuation and whitespace', () => {
    expect(isStrictSi(' si ')).toBe(true);
    expect(isStrictSi('Si!')).toBe(true);
    expect(isStrictSi('Si.')).toBe(true);
    expect(isStrictSi('Si?')).toBe(true);
  });

  it('rejects anything that isn’t exactly "si"', () => {
    expect(isStrictSi('si claro')).toBe(false);
    expect(isStrictSi('claro')).toBe(false);
    expect(isStrictSi('si por favor')).toBe(false);
    expect(isStrictSi('🙂')).toBe(false);
    expect(isStrictSi('')).toBe(false);
  });
});

describe('isExplicitNo', () => {
  it('matches plain "no"', () => {
    expect(isExplicitNo('no')).toBe(true);
    expect(isExplicitNo('No.')).toBe(true);
    expect(isExplicitNo('NO!')).toBe(true);
  });

  it('matches longer negative phrases', () => {
    expect(isExplicitNo('no gracias')).toBe(true);
    expect(isExplicitNo('No, gracias')).toBe(true);
    expect(isExplicitNo('paso')).toBe(true);
    expect(isExplicitNo('luego')).toBe(true);
    expect(isExplicitNo('mañana')).toBe(true);
    expect(isExplicitNo('manana')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(isExplicitNo('si')).toBe(false);
    expect(isExplicitNo('hola')).toBe(false);
    expect(isExplicitNo('')).toBe(false);
  });
});

describe('normalizeOptInText', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeOptInText('  Si!  ')).toBe('si');
    expect(normalizeOptInText('Sí?')).toBe('sí');
  });
});

describe('toE164ForRmc', () => {
  it('upgrades 12-digit Mexican to 13-digit E.164 with +', () => {
    expect(toE164ForRmc('528132689146')).toBe('+5218132689146');
  });

  it('passes through other lengths', () => {
    expect(toE164ForRmc('5218132689146')).toBe('+5218132689146');
    expect(toE164ForRmc('14155551212')).toBe('+14155551212');
  });

  it('strips non-digits', () => {
    expect(toE164ForRmc('+52 (81) 3268-9146')).toBe('+5218132689146');
  });

  it('returns empty string for empty input', () => {
    expect(toE164ForRmc('')).toBe('');
  });
});

describe('extFromMime', () => {
  it('maps common MIME types', () => {
    expect(extFromMime('application/pdf')).toBe('pdf');
    expect(extFromMime('image/jpeg')).toBe('jpg');
    expect(extFromMime('image/png')).toBe('png');
    expect(extFromMime('application/msword')).toBe('doc');
    expect(extFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
  });

  it('falls back to filename extension when MIME is unknown', () => {
    expect(extFromMime('application/octet-stream', 'cv.pdf')).toBe('pdf');
    expect(extFromMime(undefined, 'mi-cv.docx')).toBe('docx');
  });

  it('returns "bin" when nothing matches', () => {
    expect(extFromMime('application/octet-stream')).toBe('bin');
    expect(extFromMime(undefined, undefined)).toBe('bin');
  });
});
