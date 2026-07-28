import type { ClaimsOutcome } from './messages';

export interface TierRow {
  cls: 'pass' | 'stop' | 'skip';
  value: string;
}

/**
 * What the claims tier ACTUALLY did, for the popup's gate ladder.
 *
 * The distinction between "returned" and "painted" is the whole point: a model
 * that hands back nine claims none of which anchor is a bug in our anchoring,
 * and it must not render the same as an article that genuinely asserts nothing.
 * Collapsing these is what let an unregistered route look like a quiet page.
 */
/**
 * Longer than any real call. The AI proxy's own edge timeout is 60s, so past
 * this the request is not slow, it is gone — and saying so is the difference
 * between a diagnosable state and a spinner that never resolves.
 */
export const STALLED_MS = 60_000;

export function claimSummary(
  engage: boolean,
  outcome: ClaimsOutcome | null,
  runningMs?: number,
): TierRow {
  if (!engage) return { cls: 'skip', value: 'Skipped' };
  if (outcome === null) {
    if (runningMs === undefined) return { cls: 'skip', value: 'Running' };
    const secs = Math.round(runningMs / 1000);
    if (runningMs >= STALLED_MS) {
      return { cls: 'stop', value: `Stalled — ${String(secs)}s, no reply` };
    }
    return { cls: 'skip', value: `Running ${String(secs)}s` };
  }
  if (outcome.error !== null) {
    return { cls: 'stop', value: `Failed · ${outcome.error}` };
  }
  if (outcome.returned === 0) return { cls: 'skip', value: 'No claims' };
  if (outcome.painted === 0) {
    return { cls: 'stop', value: `0 of ${String(outcome.returned)} anchored` };
  }
  if (outcome.painted < outcome.returned) {
    return {
      cls: 'pass',
      value: `${String(outcome.painted)} of ${String(outcome.returned)}`,
    };
  }
  const n = outcome.painted;
  return { cls: 'pass', value: `${String(n)} claim${n === 1 ? '' : 's'}` };
}
