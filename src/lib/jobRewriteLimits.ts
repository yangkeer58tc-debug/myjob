/** Hard cap for one AI-rewrite CSV batch (browser tab; LLM cost/time). */
export const JOB_REWRITE_MAX_ROWS_CAP = 10_000;

/** Default when VITE_JOB_REWRITE_MAX_ROWS is unset. */
export const JOB_REWRITE_MAX_ROWS_DEFAULT = 5_000;

export function jobRewriteMaxRows(): number {
  const raw = Number.parseInt(String(import.meta.env.VITE_JOB_REWRITE_MAX_ROWS || ''), 10);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, JOB_REWRITE_MAX_ROWS_CAP);
  return JOB_REWRITE_MAX_ROWS_DEFAULT;
}

/** Parallel LLM rewrite calls (separate from CSV-only upsert pool). */
export function jobRewriteAiConcurrency(): number {
  const raw = String(
    import.meta.env.VITE_JOB_REWRITE_AI_CONCURRENCY ?? import.meta.env.VITE_JOB_IMPORT_AI_CONCURRENCY ?? '',
  ).trim();
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1) return Math.min(n, 12);
  return 4;
}
