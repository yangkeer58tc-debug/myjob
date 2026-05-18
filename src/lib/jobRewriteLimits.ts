/** Hard cap for one AI-rewrite CSV batch (browser tab; LLM cost/time). */
export const JOB_REWRITE_MAX_ROWS_CAP = 10_000;

/** Default when VITE_JOB_REWRITE_MAX_ROWS is unset. */
export const JOB_REWRITE_MAX_ROWS_DEFAULT = 5_000;

export function jobRewriteMaxRows(): number {
  const raw = Number.parseInt(String(import.meta.env.VITE_JOB_REWRITE_MAX_ROWS || ''), 10);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, JOB_REWRITE_MAX_ROWS_CAP);
  return JOB_REWRITE_MAX_ROWS_DEFAULT;
}

/** Parallel LLM calls — keep low to avoid Gemini suspension (see .env.staging.example). */
export const JOB_REWRITE_AI_CONCURRENCY_CAP = 12;

export function jobRewriteAiConcurrency(): number {
  const raw = String(import.meta.env.VITE_JOB_REWRITE_AI_CONCURRENCY ?? '').trim();
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1) return Math.min(n, JOB_REWRITE_AI_CONCURRENCY_CAP);
  return 6;
}

/** Minimum gap before each new LLM job claim (ms). */
export function jobRewriteMinDelayMs(): number {
  const raw = Number.parseInt(String(import.meta.env.VITE_JOB_REWRITE_MIN_DELAY_MS || ''), 10);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 5000);
  return 280;
}

/** Pause after this many LLM calls in one batch (0 = disabled). */
export function jobRewriteBatchEvery(): number {
  const raw = Number.parseInt(String(import.meta.env.VITE_JOB_REWRITE_BATCH_EVERY || ''), 10);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 500);
  return 24;
}

export function jobRewriteBatchPauseMs(): number {
  const raw = Number.parseInt(String(import.meta.env.VITE_JOB_REWRITE_BATCH_PAUSE_MS || ''), 10);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 60_000);
  return 4500;
}

export function jobRewriteMaxRetries(): number {
  const raw = Number.parseInt(String(import.meta.env.VITE_JOB_REWRITE_MAX_RETRIES || ''), 10);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 10);
  return 6;
}
