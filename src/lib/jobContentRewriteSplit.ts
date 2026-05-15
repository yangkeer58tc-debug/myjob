/** Split v2 body_markdown into DB fields for JobDetail. */
export function splitRewriteBodyMarkdown(body: string): {
  summary: string;
  description: string;
  requirements: string;
} {
  const text = String(body || '').trim();
  if (!text) return { summary: '', description: '', requirements: '' };

  const takeSection = (startHeader: string, endHeaders: string[]) => {
    const start = text.indexOf(startHeader);
    if (start < 0) return '';
    let from = start + startHeader.length;
    while (from < text.length && /[\s\n]/.test(text[from])) from += 1;
    let end = text.length;
    for (const h of endHeaders) {
      const i = text.indexOf(h, from);
      if (i >= 0 && i < end) end = i;
    }
    return text.slice(from, end).trim();
  };

  const resumen = takeSection('**Resumen del puesto**', [
    '**Qué harás**',
    '**Requisitos**',
    '**Ofrecemos**',
    '**Detalles del trabajo**',
  ]);
  const queHaras = takeSection('**Qué harás**', ['**Requisitos**', '**Ofrecemos**', '**Detalles del trabajo**']);
  const requisitos = takeSection('**Requisitos**', ['**Ofrecemos**', '**Detalles del trabajo**']);
  const ofrecemos = takeSection('**Ofrecemos**', ['**Detalles del trabajo**']);
  const detalles = takeSection('**Detalles del trabajo**', []);

  const summary = resumen.replace(/^\*\*|\*\*$/g, '').trim();
  const descriptionParts = [queHaras, ofrecemos, detalles].filter(Boolean);
  const description = descriptionParts.join('\n\n').trim();
  const requirements = requisitos.trim();

  return { summary, description, requirements };
}
