import { describe, expect, it } from 'vitest';
import { extractCompanyNameFromJd, extractSalaryFromJd } from './jdExtract';

describe('extractSalaryFromJd', () => {
  it('parses monthly range (MX)', () => {
    const t = 'Sueldo: $10,000.00 - $12,700.00 al mes';
    const r = extractSalaryFromJd(t);
    expect(r?.payment_frequency).toBe('mensal');
    expect(r?.amount).toBeDefined();
    expect(Number(r!.amount)).toBeGreaterThan(10000);
  });

  it('parses weekly pay', () => {
    const t = 'Pago semanal $2,900. Horario lunes a viernes.';
    const r = extractSalaryFromJd(t);
    expect(r?.payment_frequency).toBe('semanal');
    expect(r?.amount).toBe('2900');
  });
});

describe('extractCompanyNameFromJd', () => {
  it('finds S.A. de C.V. after EN', () => {
    const title = 'Supervisor de Calidad';
    const jd = 'FUNCIONES EN CORRUFACIL S.A. DE C.V. FUNCIONES: - Verificar';
    const n = extractCompanyNameFromJd(title, jd);
    expect(n).toMatch(/CORRUFACIL/i);
  });
});
