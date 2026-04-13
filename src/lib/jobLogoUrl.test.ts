import { describe, expect, it } from 'vitest';
import {
  collectFirstEmployerLogoRaw,
  looksLikeCompanyLogoUrl,
  normalizeImportedEmployerLogoUrl,
  stripCsvCellDecorations,
} from './jobLogoUrl';

describe('jobLogoUrl', () => {
  it('strips CSV quotes around URL', () => {
    expect(stripCsvCellDecorations('"https://example.com/a.png"')).toBe('https://example.com/a.png');
  });

  it('collects logo from alternate column names', () => {
    const row = { company_logo: 'https://example.com/c.png', b_logo_url: '' };
    expect(collectFirstEmployerLogoRaw(row)).toBe('https://example.com/c.png');
  });

  it('detects CloudFront square logo', () => {
    expect(
      looksLikeCompanyLogoUrl(
        'https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/256x256/7c42fae92bbb670e365b15cb97ccb741',
      ),
    ).toBe(true);
  });

  it('rejects MyJob brand asset', () => {
    expect(normalizeImportedEmployerLogoUrl('/brand-logo.jpg')).toBe(null);
  });

  it('accepts https logo', () => {
    expect(normalizeImportedEmployerLogoUrl('https://example.com/logo.png')).toBe('https://example.com/logo.png');
  });
});
