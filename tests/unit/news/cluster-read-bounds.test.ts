import { describe, expect, it, vi } from 'vitest';

/**
 * D1 rows-read regressions (prod, 2026-10). Each of these reads used to scan
 * the whole newsCluster table (~122k rows, 10 KB each) per call:
 *  - newsBlindspot: `blindspotSide: { $in: [...] }` compiles to an OR over
 *    json_each that no index can serve (210k rows/call).
 *  - newsUglyTakes: `uglyTakeFileId: { $ne: null }` alone has no index (112k).
 */

vi.mock('../../../server/news/cluster-jobs', () => ({
  requestClusterArt: async () => undefined,
}));
vi.mock('../../../server/news/domainBias', () => ({
  getDomainRating: async () => null,
  normalizeDomain: () => null,
}));

const clusters = await import('../../../server/news/clusters');

type Pipeline = Record<string, Record<string, unknown>>[];

function recordingDb(byCall: (p: Pipeline) => unknown[]) {
  const calls: Pipeline[] = [];
  const db = {
    getQuery: async (_c: string, p: Pipeline) => {
      calls.push(p);
      return byCall(p);
    },
    getDoc: async () => null,
  } as never;
  return { db, calls };
}

const card = (id: string, side: string, lastUpdatedAt: number) => ({
  _id: id,
  title: id,
  category: 'world',
  sourceIds: [],
  articleCount: 3,
  biasBreakdown: { left: 0, center: 0, right: 3 },
  blindspotSide: side,
  factualityAvg: null,
  topImageUri: null,
  neutralSummary: null,
  uglyTakeFileId: null,
  lastUpdatedAt,
});

describe('bounded newsCluster reads', () => {
  it('newsBlindspot reads each side by equality and merges newest-first', async () => {
    const { db, calls } = recordingDb((p) =>
      p[0]!.$match!.blindspotSide === 'left'
        ? [card('l1', 'left', 30), card('l2', 'left', 10)]
        : [card('r1', 'right', 20)],
    );
    const out = await clusters.newsBlindspot(db, { limit: 2 });
    expect(calls.map((p) => p[0]!.$match)).toEqual([
      { blindspotSide: 'left' },
      { blindspotSide: 'right' },
    ]);
    expect(out.items.map((c) => c.id)).toEqual(['l1', 'r1']);
  });

  it('newsUglyTakes bounds the read by satirizedAt', async () => {
    const { db, calls } = recordingDb(() => []);
    const before = Date.now();
    await clusters.newsUglyTakes(db, {});
    const match = calls[0]![0]!.$match as {
      satirizedAt: { $gte: number };
    };
    expect(match.satirizedAt.$gte).toBeGreaterThan(
      before - 15 * 24 * 60 * 60 * 1000,
    );
    expect(match.satirizedAt.$gte).toBeLessThan(before);
  });
});
