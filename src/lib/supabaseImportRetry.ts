const RETRYABLE = /fetch|failed to fetch|network|timeout|502|503|504|econnreset/i;

function isRetryableMessage(msg: string): boolean {
  return RETRYABLE.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** Retry transient browser/network failures around Supabase calls that use fetch under the hood. */
export async function withImportNetworkRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (e) {
      last = e;
      const msg = String((e as { message?: unknown })?.message ?? e);
      if (!isRetryableMessage(msg) || i === attempts - 1) throw e;
      await sleep(280 * (i + 1) + Math.floor(Math.random() * 120));
    }
  }
  throw last;
}
