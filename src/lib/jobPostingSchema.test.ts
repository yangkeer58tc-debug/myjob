import { describe, expect, it } from 'vitest';
import { jobPostingDescriptionHtml, normalizeEmployerSameAs, schemaBaseSalaryFromJob } from './jobPostingSchema';

describe('jobPostingDescriptionHtml', () => {
  it('wraps paragraphs and escapes HTML', () => {
    const html = jobPostingDescriptionHtml('Line1\n\n<script>x</script> & <b>y</b>');
    expect(html).toContain('<p>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
});

describe('normalizeEmployerSameAs', () => {
  it('adds https and strips trailing slash', () => {
    expect(normalizeEmployerSameAs('ejemplo.com/')).toBe('https://ejemplo.com');
  });
});

describe('schemaBaseSalaryFromJob', () => {
  it('returns null for placeholder', () => {
    expect(schemaBaseSalaryFromJob({ salary_amount: 'A combinar', payment_frequency: 'mensal' })).toBeNull();
  });

  it('returns block for numeric salary', () => {
    const r = schemaBaseSalaryFromJob({ salary_amount: '12000', payment_frequency: 'mensal' });
    expect(r?.baseSalary.value.value).toBe(12000);
    expect(r?.baseSalary.value.unitText).toBe('MONTH');
  });
});
