/**
 * Run async tasks over 0..n-1 with a fixed concurrency (worker pool).
 * Order of execution is undefined; use for independent row imports.
 */
export async function runPool(
  total: number,
  concurrency: number,
  worker: (index: number) => Promise<void>,
): Promise<void> {
  if (total <= 0) return;
  const limit = Math.min(Math.max(1, concurrency), total);
  let next = 0;

  const runOne = async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      await worker(i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runOne()));
}

export function jobImportAiConcurrency(): number {
  const raw = String(import.meta.env.VITE_JOB_IMPORT_AI_CONCURRENCY ?? '').trim();
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1) return Math.min(n, 20);
  return 6;
}

export function jobImportUpsertOnlyConcurrency(): number {
  const raw = String(import.meta.env.VITE_JOB_IMPORT_UPSERT_CONCURRENCY ?? '').trim();
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1) return Math.min(n, 30);
  return 15;
}
