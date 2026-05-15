import { describe, expect, it } from 'vitest';
import { splitRewriteBodyMarkdown } from '@/lib/jobContentRewriteSplit';

describe('splitRewriteBodyMarkdown', () => {
  it('splits five-section body into summary, description, requirements', () => {
    const body = `**Resumen del puesto**

Resumen breve del rol en Querétaro.

**Qué harás**

- Atender clientes
- Registrar pedidos

**Requisitos**

- Licenciatura
- Experiencia de 2 años

**Ofrecemos**

- Seguro médico

**Detalles del trabajo**

Modalidad: Presencial`;

    const parts = splitRewriteBodyMarkdown(body);
    expect(parts.summary).toContain('Querétaro');
    expect(parts.description).toContain('Atender clientes');
    expect(parts.requirements).toContain('Licenciatura');
  });
});
