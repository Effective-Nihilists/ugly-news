import { describe, expect, it } from 'vitest';
import { RETENTION_MS, runNewsRetention } from '../../../server/news/retention';

/**
 * Production evidence (ugly-news v0.1.58, build 1789344904602, 2026-10-10
 * 10:04 UTC):
 *
 *   [workers-app:cron] task "worker:pruneOldNews" failed:
 *     D1_ERROR: Network connection lost.
 *
 * A cron task gets no platform retry (the scheduled() dispatcher logs the
 * failure once and the next chance is tomorrow), and the first failing
 * deleteQuery used to abort the other two sweeps with it.
 */
const LOST = () => new Error('D1_ERROR: Network connection lost.');
const noSleep = { sleep: async () => {} };

function fakeDb(
  deleteQuery: (collection: unknown, filter: unknown) => Promise<unknown>,
): never {
  return { deleteQuery } as never;
}

describe('runNewsRetention', () => {
  it('prunes all three collections at the retention cutoff', async () => {
    const filters: unknown[] = [];
    const db = fakeDb(async (_collection, filter) => {
      filters.push(filter);
      return 0;
    });
    const now = 1_760_000_000_000;
    await runNewsRetention(db, now, noSleep);
    const cutoff = now - RETENTION_MS;
    expect(filters).toEqual([
      { created: { $lt: cutoff } },
      { created: { $lt: cutoff } },
      { lastUpdatedAt: { $lt: cutoff } },
    ]);
  });

  it('retries a lost connection instead of failing the daily run', async () => {
    let attempts = 0;
    const db = fakeDb(async () => {
      attempts += 1;
      if (attempts === 1) throw LOST();
      return 0;
    });
    await expect(runNewsRetention(db, 1, noSleep)).resolves.toBeUndefined();
    // One failed attempt, its retry, then the two remaining sweeps.
    expect(attempts).toBe(4);
  });

  it('still runs the other sweeps when one keeps failing, then reports it', async () => {
    let calls = 0;
    const db = fakeDb(async () => {
      calls += 1;
      if (calls <= 4) throw LOST();
      return 0;
    });
    await expect(runNewsRetention(db, 1, noSleep)).rejects.toThrow(
      /1\/3 prune sweeps failed after retries: newsArticle: .*Network connection lost/,
    );
    // Four attempts on newsArticle, then file and newsCluster once each.
    expect(calls).toBe(6);
  });

  it('does not retry a deterministic failure', async () => {
    let calls = 0;
    const db = fakeDb(async () => {
      calls += 1;
      throw new TypeError('filter is not a function');
    });
    await expect(runNewsRetention(db, 1, noSleep)).rejects.toThrow(
      /3\/3 prune sweeps failed/,
    );
    expect(calls).toBe(3);
  });
});
