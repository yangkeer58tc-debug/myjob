const cleanToken = (s: string) =>
  s
    .replace(/\uFFFD+/g, '')
    .replace(/\*\*/g, '')
    .replace(/[_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const shorten = (s: string, maxChars: number) => {
  const t = cleanToken(s);
  if (!t) return '';
  if (t.length <= maxChars) return t;
  const words = t.split(' ').filter(Boolean);
  const take = words.slice(0, 8).join(' ');
  return take.length <= maxChars ? take : take.slice(0, maxChars).trim();
};

export const parseHighlights = (input: unknown) => {
  const raw = String(input ?? '').trim();
  if (!raw) return [] as string[];

  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\s|^)\d+\.\s+/g, '\n')
    .replace(/•/g, '\n')
    .replace(/\*/g, '\n')
    .replace(/;/g, '\n')
    .replace(/,/g, '\n');

  const parts = normalized
    .split('\n')
    .map((p) => p.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .flatMap((p) => p.split('  ').map((x) => x.trim()).filter(Boolean));

  const out: string[] = [];
  const seen = new Set<string>();

  for (const p of parts) {
    const token = shorten(p, 42);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= 10) break;
  }

  return out;
};

