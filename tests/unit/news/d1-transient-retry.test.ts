import { describe, expect, it, vi } from 'vitest';
import { isTransientD1Error, withD1Retry } from '../../../server/news/download';

/**
 * Production evidence (ugly-news v0.1.58, 2026-08-20..21): 22 log lines of
 *
 *   [NEWS] Failed to process RSS item [nyt_world] <url>:
 *     Error: D1_ERROR: D1 DB is overloaded. Requests queued for too long.
 *
 * `dispatchNewsFeedDownload` wraps each item in a try/catch that logs and moves
 * on, so an overloaded D1 didn't fail the ingest — it silently DROPPED that
 * article. All feeds are dispatched at once (`newsRefreshAllFeeds` enqueues one
 * task per feed), so the overload is self-inflicted burst pressure, and it is
 * explicitly transient: "queued for too long" means retry, not reject.
 *
 * `fetchFeedItems` already retries transient HTTP the same way; the D1 writes
 * had no equivalent.
 */
describe('isTransientD1Error', () => {
  it('recognizes the overload message prod actually logged', () => {
    expect(
      isTransientD1Error(
        new Error(
          'D1_ERROR: D1 DB is overloaded. Requests queued for too long. (at d1-api:188:19)',
        ),
      ),
    ).toBe(true);
  });

  it('recognizes storage resets and timeouts', () => {
    expect(
      isTransientD1Error(
        new Error(
          'D1_ERROR: Internal error in D1 DB storage caused object to be reset; reference = abc',
        ),
      ),
    ).toBe(true);
    expect(
      isTransientD1Error(
        new Error(
          'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.',
        ),
      ),
    ).toBe(true);
    expect(isTransientD1Error(new Error('Network connection lost.'))).toBe(
      true,
    );
  });

  it('does NOT retry a row that will never fit', () => {
    // SQLITE_TOOBIG is deterministic — retrying just burns the queue budget.
    expect(
      isTransientD1Error(
        new Error('D1_ERROR: string or blob too big: SQLITE_TOOBIG'),
      ),
    ).toBe(false);
  });

  it('does not retry an ordinary programming error', () => {
    expect(isTransientD1Error(new TypeError('x.trim is not a function'))).toBe(
      false,
    );
  });
});

describe('withD1Retry', () => {
  it('returns the value when the first attempt succeeds', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    await expect(withD1Retry(op, { sleep: async () => {} })).resolves.toBe(
      'ok',
    );
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries an overloaded D1 and returns the eventual success', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'D1_ERROR: D1 DB is overloaded. Requests queued for too long.',
        ),
      )
      .mockResolvedValue('stored');
    await expect(withD1Retry(op, { sleep: async () => {} })).resolves.toBe(
      'stored',
    );
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('backs off between attempts', async () => {
    const waits: number[] = [];
    const op = vi
      .fn()
      .mockRejectedValue(new Error('D1_ERROR: D1 DB is overloaded.'));
    await expect(
      withD1Retry(op, {
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
    ).rejects.toThrow('overloaded');
    expect(waits.length).toBeGreaterThan(1);
    expect(waits[1]).toBeGreaterThan(waits[0]!);
  });

  it('gives up and rethrows so the caller still logs the drop', async () => {
    const op = vi
      .fn()
      .mockRejectedValue(new Error('D1_ERROR: D1 DB is overloaded.'));
    await expect(withD1Retry(op, { sleep: async () => {} })).rejects.toThrow(
      'overloaded',
    );
    expect(op.mock.calls.length).toBeGreaterThan(2);
  });

  it('does not retry a non-transient failure', async () => {
    const op = vi
      .fn()
      .mockRejectedValue(
        new Error('D1_ERROR: string or blob too big: SQLITE_TOOBIG'),
      );
    await expect(withD1Retry(op, { sleep: async () => {} })).rejects.toThrow(
      'SQLITE_TOOBIG',
    );
    expect(op).toHaveBeenCalledTimes(1);
  });
});
