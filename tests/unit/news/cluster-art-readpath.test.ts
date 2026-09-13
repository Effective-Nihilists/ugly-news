import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The read paths that can SHOW cluster art must be the ones that ask for it.
 *
 * `topImageUri` is rendered on the home rail cards (newsUi.tsx reads it off
 * ClusterCard), not only on the cluster detail page — so triggering
 * generation solely from `newsClusterGet` would leave the rail permanently on
 * its hatch-pattern fallback. Every endpoint that serves a card list asks.
 */

const requestClusterArt = vi.fn(async () => undefined);
vi.mock('../../../server/news/cluster-jobs', () => ({ requestClusterArt }));
vi.mock('../../../server/news/domainBias', () => ({
  getDomainRating: async () => null,
  normalizeDomain: () => null,
}));

const clusters = await import('../../../server/news/clusters');

const row = (id: string, topImageUri: string | null = null) => ({
  _id: id,
  title: `Story ${id}`,
  category: 'world',
  fileIds: [],
  sourceIds: [],
  feedIds: [],
  articleCount: 2,
  biasBreakdown: { left: 1, center: 1, right: 0 },
  blindspotSide: null,
  factualityAvg: null,
  neutralSummary: null,
  framingSummary: null,
  uglyTakeFileId: null,
  topImageUri,
  topImageRequestedAt: null,
  score: 1,
  synthesizedAt: null,
  satirizedAt: null,
  firstSeenAt: 1,
  lastUpdatedAt: Date.now(),
});

function db(rows: ReturnType<typeof row>[]): never {
  return {
    getQuery: async () => rows,
    getDoc: async () => rows[0] ?? null,
    setDoc: async () => undefined,
  } as never;
}

beforeEach(() => {
  requestClusterArt.mockClear();
});

describe('cluster read paths request art', () => {
  it('newsTopStories asks for art for the cards it serves', async () => {
    await clusters.newsTopStories(db([row('a'), row('b')]), {});
    expect(requestClusterArt).toHaveBeenCalledTimes(1);
    const served = requestClusterArt.mock.calls[0][1] as { _id: string }[];
    expect(served.map((c) => c._id)).toEqual(['a', 'b']);
  });

  it('newsBlindspot asks too — it renders the same cards', async () => {
    await clusters.newsBlindspot(db([row('a')]), {});
    expect(requestClusterArt).toHaveBeenCalledTimes(1);
  });

  it('newsClusterGet asks for the cluster it serves', async () => {
    await clusters.newsClusterGet(db([row('a')]), { id: 'a' });
    expect(requestClusterArt).toHaveBeenCalledTimes(1);
  });

  it('still returns the cards when the art request is a no-op', async () => {
    const out = await clusters.newsTopStories(db([row('a')]), {});
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe('a');
  });
});
