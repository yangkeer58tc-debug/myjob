import { normalizeJobTitle } from '@/lib/jobTextUtils';

/** Hard cap for list cards + SEO titles after AI rewrite. */
export const JOB_REWRITE_TITLE_MAX_CHARS = 48;

/** Preferred band for the LLM prompt (es-MX). */
export const JOB_REWRITE_TITLE_TARGET_CHARS = 42;

/**
 * Shorten an LLM job title for display: normalize, then trim at word/separator boundaries.
 */
export function clampJobRewriteTitle(title: string, maxLen = JOB_REWRITE_TITLE_MAX_CHARS): string {
  let s = normalizeJobTitle(title);
  if (s.length <= maxLen) return s;

  const window = s.slice(0, maxLen + 1);
  const separators = [' - ', ' – ', ' | ', ', ', ' en ', ' · ', ' / '];
  for (const sep of separators) {
    const idx = window.lastIndexOf(sep);
    if (idx >= Math.floor(maxLen * 0.45)) {
      return s.slice(0, idx).trim();
    }
  }

  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxLen * 0.55)) {
    return s.slice(0, lastSpace).trim();
  }

  return s.slice(0, maxLen).trim();
}
