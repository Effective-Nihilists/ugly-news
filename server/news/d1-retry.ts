// ─── Transient D1 retry ────────────────────────────────────────────────────
// Every feed is dispatched at once (`newsRefreshAllFeeds`), and the resulting
// burst pushed D1 past its queue depth: 22 articles were lost across
// 2026-08-20..21 to `D1_ERROR: D1 DB is overloaded. Requests queued for too
// long.`, each one logged by the feed ingest's per-item catch and then silently
// dropped. Those messages all describe a QUEUE, not a rejection: the same class
// of failure `fetchFeedItems` already retries for HTTP.
//
// Shared by the feed ingest (download.ts) and the daily retention cron
// (retention.ts), which gets no platform retry at all.

const D1_TRANSIENT_PATTERNS = [
  'is overloaded',
  'queued for too long',
  'caused object to be reset',
  'exceeded timeout',
  'network connection lost',
  // `D1_ERROR: internal error; reference = e_Gz3hrU_...` (articleScrape,
  // 2026-10-14 21:32 UTC): a one-off fault inside D1 that carries a support
  // reference, not a verdict on the statement. The next attempt succeeds.
  'internal error',
];

/**
 * True when a D1 failure is a capacity/transport blip worth retrying.
 * Deterministic failures are excluded: `SQLITE_TOOBIG` fails identically on
 * every attempt, so retrying it only burns the queue worker's budget.
 */
export function isTransientD1Error(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  if (message.includes('sqlite_toobig')) return false;
  return D1_TRANSIENT_PATTERNS.some((p) => message.includes(p));
}

const D1_RETRY_ATTEMPTS = 4;
const D1_RETRY_BASE_MS = 250;

/**
 * Run a D1 operation, retrying transient overload with exponential backoff.
 * Rethrows on exhaustion so the caller's existing log still records the drop;
 * this makes losses rarer, it does not hide them.
 */
export async function withD1Retry<T>(
  op: () => Promise<T>,
  deps: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < D1_RETRY_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (!isTransientD1Error(error)) throw error;
      if (attempt === D1_RETRY_ATTEMPTS - 1) break;
      await sleep(D1_RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw lastError;
}
