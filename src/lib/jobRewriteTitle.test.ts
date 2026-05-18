import { describe, expect, it } from 'vitest';
import { clampJobRewriteTitle, JOB_REWRITE_TITLE_MAX_CHARS } from '@/lib/jobRewriteTitle';

describe('clampJobRewriteTitle', () => {
  it('leaves short titles unchanged', () => {
    expect(clampJobRewriteTitle('Asesor de ventas CDMX')).toBe('Asesor de ventas CDMX');
  });

  it('truncates at separator before hard cut', () => {
    const long =
      'Ejecutivo de ventas senior para canal retail en Ciudad de México y zona metropolitana';
    const out = clampJobRewriteTitle(long);
    expect(out.length).toBeLessThanOrEqual(JOB_REWRITE_TITLE_MAX_CHARS);
    expect(out).not.toContain('zona metropolitana');
  });

  it('never exceeds max length', () => {
    const long = 'A'.repeat(120);
    expect(clampJobRewriteTitle(long).length).toBeLessThanOrEqual(JOB_REWRITE_TITLE_MAX_CHARS);
  });
});
