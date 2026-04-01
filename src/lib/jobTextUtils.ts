export type JobTextFieldsInput = {
  summary?: string | null;
  description?: string | null;
  requirements?: string | null;
};

const fixCommonPtArtifacts = (value: string) => {
  let s = value || '';
  if (!s) return s;

  s = s.replaceAll('\u008D\u2039', 'çã');
  s = s.replaceAll('\u008D', 'ç');
  s = s.replaceAll('\u2039', 'ã');
  s = s.replaceAll('\u0090', 'ê');
  s = s.replaceAll('\u017D', 'é');
  s = s.replaceAll('\u2021', 'á');
  s = s.replace(/p\u2014s-venda/gi, (m) => (m[0] === 'P' ? 'Pós-venda' : 'pós-venda'));
  s = s.replace(/Aux\u2019lio/gi, (m) => (m[0] === 'A' ? 'Auxílio' : 'auxílio'));
  s = s.replace(/benef\u2019cios/gi, (m) => (m[0] === 'B' ? 'Benefícios' : 'benefícios'));
  s = s.replace(/sa\u2019da/gi, (m) => (m[0] === 'S' ? 'Saída' : 'saída'));
  s = s.replace(/c\u2014digos/gi, (m) => (m[0] === 'C' ? 'Códigos' : 'códigos'));

  return s;
};

const normalizeNewlines = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const stripMarkdownNoise = (value: string) =>
  value
    .replaceAll('**', '')
    .replaceAll('__', '')
    .replaceAll('`', '')
    .replaceAll('\u200B', '')
    .replaceAll('\uFEFF', '');

const canonicalizeWhitespace = (value: string) =>
  value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const preformat = (value: string) => {
  let s = fixCommonPtArtifacts(value || '');
  s = normalizeNewlines(s);
  s = stripMarkdownNoise(s);

  s = s.replace(/\s+\*\s+/g, '\n- ');
  s = s.replace(/(\s)(\d+[.)])\s+/g, '\n$2 ');
  s = s.replace(/([A-Za-zÀ-ÿ0-9][^:\n]{2,80}):\s+/g, '$1:\n');
  s = s.replace(/\s+(Estamos em busca de|A miss(?:a|ã)o do|O que (?:é|e) que|Conhe(?:c|ç)a nossa|Junte-se ao time|E a[íi],)/gi, '\n\n$1');

  return canonicalizeWhitespace(s);
};

const headingAliases: Array<{ key: 'summary' | 'requirements' | 'description'; re: RegExp }> = [
  { key: 'summary', re: /^resumo da vaga$/i },
  { key: 'requirements', re: /^requisitos(?: e qualifica(?:c|ç)(?:o|õ)es)?$/i },
  { key: 'description', re: /^(descri(?:c|ç)(?:a|ã)o da vaga|responsabilidades(?: e atribu(?:i|í)(?:c|ç)(?:o|õ)es)?|informa(?:c|ç)(?:o|õ)es adicionais|benef(?:i|í)cios|e os nossos benef(?:i|í)cios\??|principais destaques)$/i },
];

const splitByHeadings = (value: string) => {
  const text = preformat(value);
  if (!text) return { preamble: '', sections: [] as Array<{ key: string; title: string; body: string }> };

  const lines = text.split('\n');
  const sections: Array<{ key: string; title: string; body: string }> = [];
  let preambleLines: string[] = [];
  let current: { key: string; title: string; bodyLines: string[] } | null = null;

  const commit = () => {
    if (!current) return;
    const body = canonicalizeWhitespace(current.bodyLines.join('\n'));
    sections.push({ key: current.key, title: current.title, body });
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = line.match(/^(.+):$/);
    if (headingMatch) {
      const title = headingMatch[1].trim();
      const alias = headingAliases.find((h) => h.re.test(title));
      if (alias) {
        commit();
        current = { key: alias.key, title, bodyLines: [] };
        continue;
      }
    }

    if (!current) preambleLines.push(raw);
    else current.bodyLines.push(raw);
  }

  commit();
  return { preamble: canonicalizeWhitespace(preambleLines.join('\n')), sections };
};

const stripLeadingTitle = (value: string, titles: string[]) => {
  let s = value || '';
  for (const t of titles) {
    const re = new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*:?[\\s\\n]+`, 'i');
    s = s.replace(re, '');
  }
  return s.trim();
};

const firstParagraph = (value: string) => {
  const s = canonicalizeWhitespace(preformat(value));
  if (!s) return '';
  const parts = s.split('\n\n').filter(Boolean);
  return (parts[0] || '').trim();
};

export const normalizeJobTextFields = (input: JobTextFieldsInput) => {
  const summaryIn = input.summary || '';
  const descriptionIn = input.description || '';
  const requirementsIn = input.requirements || '';

  const combined = [summaryIn, descriptionIn, requirementsIn].filter(Boolean).join('\n\n');
  const { preamble, sections } = splitByHeadings(combined);

  const summarySection = sections.find((s) => s.key === 'summary')?.body || '';
  const requirementsSection = sections.find((s) => s.key === 'requirements')?.body || '';
  const descriptionSections = sections.filter((s) => s.key === 'description');

  const summaryOutCandidate = stripLeadingTitle(summarySection || summaryIn, ['Resumo da Vaga']);
  const summaryOut = canonicalizeWhitespace(preformat(summaryOutCandidate || firstParagraph(preamble || descriptionIn)));

  const requirementsOutCandidate = stripLeadingTitle(requirementsSection || requirementsIn, ['Requisitos', 'Requisitos e qualificações', 'Requisitos e qualificaçoes', 'Requisitos e qualificacoes']);
  const requirementsOut = canonicalizeWhitespace(preformat(requirementsOutCandidate));

  const descriptionBodies = descriptionSections
    .map((s) => {
      const title = stripLeadingTitle(s.title, ['Descrição da Vaga']).replace(/\s+/g, ' ').trim();
      const body = s.body;
      if (!body) return '';
      return `${title}:\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const descriptionBase = descriptionBodies || stripLeadingTitle(descriptionIn, ['Descrição da Vaga', 'Resumo da Vaga']);
  const descriptionOut = canonicalizeWhitespace(preformat(descriptionBase));

  return {
    summary: summaryOut || null,
    description: descriptionOut || null,
    requirements: requirementsOut || null,
  };
};

