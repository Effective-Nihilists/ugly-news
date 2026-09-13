import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cluster art is generated lazily, off the READ path.
 *
 * It used to be minted inside `dispatchClusterSynthesize` for every
 * synthesized cluster that had no RSS image — 272 flux calls / $4.25 a week
 * — whether or not the story was ever surfaced to anyone. Now a card list or
 * cluster page asks for art when it serves an image-less cluster, and the
 * actual generation happens on a queue worker so no reader waits on flux.
 *
 * The two things that must hold: a repeated read must not re-enqueue (or a
 * hot rail would mint the same image hundreds of times), and a failed
 * generation must eventually be retried rather than stuck forever.
 */

const generateUglyPressImage = vi.fn(async () => 'https://img/generated.png');
const enqueued: { name: string; input: unknown }[] = [];

vi.mock('../../../server/news/ai', () => ({
  genText: vi.fn(),
  generateUglyPressImage,
  truncateToApproximateTokens: (t: string, n: number) => t.slice(0, n * 4),
}));
vi.mock('../../../server/news/queue', () => ({
  enqueueTask: async (name: string, input: unknown) => {
    enqueued.push({ name, input });
  },
}));

const jobs = await import('../../../server/news/cluster-jobs');

const NOW = 1_700_000_000_000;
const HOUR = 3600_000;

interface Cl {
  _id: string;
  title: string;
  category: string;
  topImageUri: string | null;
  topImageRequestedAt: number | null;
}
/** Build a cluster AND put it in the fake store — a real read path always
 *  serves docs that exist, and requestClusterArt re-reads each one to
 *  re-check the stamp against concurrent writers. */
const cluster = (id: string, over: Partial<Cl> = {}): Cl => {
  const c: Cl = {
    _id: id,
    title: `Story ${id}`,
    category: 'world',
    topImageUri: null,
    topImageRequestedAt: null,
    ...over,
  };
  store[id] = c;
  return c;
};

let store: Record<string, Cl>;
const written: Record<string, unknown>[] = [];

function fakeDb(): never {
  return {
    getDoc: async (_c: unknown, id: string) => store[id] ?? null,
    setDoc: async (_c: unknown, doc: Record<string, unknown>) => {
      written.push(doc);
      store[String(doc._id)] = { ...store[String(doc._id)], ...doc } as Cl;
    },
  } as never;
}

beforeEach(() => {
  enqueued.length = 0;
  written.length = 0;
  generateUglyPressImage.mockClear();
  store = {};
});

describe('requestClusterArt — the read-path trigger', () => {
  it('enqueues a backfill for a cluster with no image', async () => {
    const list = [cluster('a')];
    await jobs.requestClusterArt(fakeDb(), list as never, NOW);
    expect(enqueued).toEqual([
      { name: 'clusterImageBackfill', input: { clusterId: 'a' } },
    ]);
  });

  it('ignores clusters that already have an image', async () => {
    const list = [cluster('a', { topImageUri: 'https://rss/pic.jpg' })];
    await jobs.requestClusterArt(fakeDb(), list as never, NOW);
    expect(enqueued).toEqual([]);
    expect(generateUglyPressImage).not.toHaveBeenCalled();
  });

  it('stamps the request so a second read does not re-enqueue', async () => {
    const list = [cluster('a')];
    await jobs.requestClusterArt(fakeDb(), list as never, NOW);
    enqueued.length = 0;
    // Same docs, re-read a moment later — the marker is now persisted.
    await jobs.requestClusterArt(
      fakeDb(),
      [store['a']] as never,
      NOW + 60_000,
    );
    expect(
      enqueued,
      'a hot rail would mint the same image on every render without this guard',
    ).toEqual([]);
  });

  it('caps how many it asks for in a single read', async () => {
    const list = Array.from({ length: 12 }, (_, i) => cluster(`c${i}`));
    await jobs.requestClusterArt(fakeDb(), list as never, NOW);
    expect(enqueued.length).toBeGreaterThan(0);
    expect(
      enqueued.length,
      'one rail load must not fan out a dozen flux generations',
    ).toBeLessThanOrEqual(3);
  });

  it('re-requests once the retry window passes, so a failure is not permanent', async () => {
    const stale = cluster('a', { topImageRequestedAt: NOW - 24 * HOUR });
    await jobs.requestClusterArt(fakeDb(), [stale] as never, NOW);
    expect(enqueued).toEqual([
      { name: 'clusterImageBackfill', input: { clusterId: 'a' } },
    ]);
  });

  it('never throws — art is cosmetic and must not break a page load', async () => {
    const brokenDb = {
      getDoc: async () => {
        throw new Error('db down');
      },
      setDoc: async () => {
        throw new Error('db down');
      },
    } as never;
    await expect(
      jobs.requestClusterArt(brokenDb, [cluster('a')] as never, NOW),
    ).resolves.toBeUndefined();
  });
});

describe('dispatchClusterImageBackfill — the worker', () => {
  it('generates and persists the image', async () => {
    cluster('a', { topImageRequestedAt: NOW });
    await jobs.dispatchClusterImageBackfill(fakeDb(), 'a');
    expect(generateUglyPressImage).toHaveBeenCalledTimes(1);
    expect(store['a'].topImageUri).toBe('https://img/generated.png');
  });

  it('spends nothing when the cluster already got an image', async () => {
    cluster('a', { topImageUri: 'https://rss/pic.jpg' });
    await jobs.dispatchClusterImageBackfill(fakeDb(), 'a');
    expect(
      generateUglyPressImage,
      'two readers can enqueue before the first write lands — the worker is the last guard',
    ).not.toHaveBeenCalled();
  });
});
