import type { ReactNode } from 'react';

export const getQueryTokens = (query: string) =>
  Array.from(new Set(String(query || '').trim().split(/\s+/).map((t) => t.trim()).filter(Boolean)));

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const queryMatchesText = (text: string, query: string) => {
  const tokens = getQueryTokens(query);
  if (tokens.length === 0) return false;
  const hay = String(text || '').toLowerCase();
  return tokens.some((t) => hay.includes(t.toLowerCase()));
};

/** Highlights whitespace-separated tokens in text (case-insensitive). */
export function renderSearchHighlight(text: string, query: string): ReactNode {
  const q = String(query || '').trim();
  if (!q) return text;
  const tokens = getQueryTokens(q);
  if (tokens.length === 0) return text;
  const pattern = tokens.map(escapeRegExp).join('|');
  if (!pattern) return text;
  const re = new RegExp(`(${pattern})`, 'gi');
  const parts = String(text || '').split(re);
  if (parts.length <= 1) return text;
  return (
    <>
      {parts.map((part, idx) => {
        const isHit = re.test(part);
        re.lastIndex = 0;
        return isHit ? (
          <mark
            key={idx}
            className="bg-amber-200/95 text-amber-950 dark:bg-amber-400/35 dark:text-amber-50 rounded px-0.5 font-semibold"
          >
            {part}
          </mark>
        ) : (
          <span key={idx}>{part}</span>
        );
      })}
    </>
  );
}
