import { describe, expect, it } from 'vitest';
import { jobPublicPath, parseEmpleoParam, slugifyJobSegment } from './jobSeoPath';

describe('parseEmpleoParam', () => {
  it('parses numeric id', () => {
    expect(parseEmpleoParam('41997377609991168')).toEqual({ kind: 'id', id: '41997377609991168' });
  });

  it('parses slug-id compound', () => {
    expect(parseEmpleoParam('supervisor-calidad-41997377609991168')).toEqual({ kind: 'id', id: '41997377609991168' });
  });

  it('parses slug-id with shorter numeric id (IMC)', () => {
    expect(parseEmpleoParam('asesor-de-nutricion-55398649')).toEqual({ kind: 'id', id: '55398649' });
  });
});

describe('jobPublicPath', () => {
  it('builds path from title and id', () => {
    const p = jobPublicPath({ id: '41997377609991168', title: 'Supervisor de Calidad' });
    expect(p).toBe('/empleo/supervisor-de-calidad-41997377609991168/');
  });

  it('slugifies title', () => {
    expect(slugifyJobSegment('  Hello World  ')).toBe('hello-world');
  });
});
