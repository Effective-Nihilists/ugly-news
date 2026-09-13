import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cluster-level AI spend.
 *
 * Two changes pinned here, both from the 2026-09-13 spend audit:
 *
 *  - Synthesis moved off `deepseek_v4_flash` for the same reason the article
 *    summarizer did: forced, unbounded thinking on a summarization task.
 *  - The Ugly Take moved off `gpt_4o` ($2.50/$10 per 1M — the priciest model
 *    in the fleet) onto gpt-oss-120b. It was drawing 741 calls / $3.32 a week
 *    to produce files stored `public: false`, reachable only from a cluster
 *    page.
 *  - Cluster art is no longer minted inside synthesis. It is generated lazily
 *    off the read path instead (see clusterImageBackfill), so a story that is
 *    never surfaced never costs a flux generation.
 */

const genText = vi.fn(async () => 'A long and substantive summary of a story.');
const generateUglyPressImage = vi.fn(async () => 'https://img/generated.png');
const enqueued: { name: string; input: unknown }[] = [];

vi.mock('../../../server/news/ai', () => ({
  genText,
  generateUglyPressImage,
  truncateToApproximateTokens: (t: string, n: number) => t.slice(0, n * 4),
}));
vi.mock('../../../server/news/queue', () => ({
  enqueueTask: async (name: string, input: unknown) => {
    enqueued.push({ name, input });
  },
}));

const jobs = await import('../../../server/news/cluster-jobs');

const CLUSTER = {
  _id: 'cl-1',
  title: 'Council approves water plant bond',
  category: 'world',
  fileIds: ['f1'],
  sourceIds: [],
  feedIds: ['feed-1'],
  articleCount: 3,
  biasBreakdown: { left: 1, center: 1, right: 1 },
  blindspotSide: null,
  factualityAvg: null,
  neutralSummary: null,
  framingSummary: null,
  uglyTakeFileId: null,
  topImageUri: null,
  score: 10,
  synthesizedAt: null,
  satirizedAt: null,
  firstSeenAt: 1,
  lastUpdatedAt: 1,
  created: new Date(),
};

const written: Record<string, unknown>[] = [];

function fakeDb(overrides: Record<string, unknown> = {}): never {
  return {
    getDoc: async () => ({ ...CLUSTER, ...overrides }),
    getQuery: async () => [
      {
        _id: 'f1',
        title: 'Council approves bond',
        text: 'The council voted Tuesday.',
        feedId: 'feed-1',
        thumbnail: null,
      },
    ],
    setDoc: async (_c: unknown, doc: Record<string, unknown>) => {
      written.push(doc);
    },
  } as never;
}

beforeEach(() => {
  genText.mockClear();
  generateUglyPressImage.mockClear();
  enqueued.length = 0;
  written.length = 0;
});

const modelsUsed = (): string[] =>
  genText.mock.calls.map((c) => (c[1] as { model: string }).model);

describe('dispatchClusterSynthesize', () => {
  it('synthesizes with GPT-OSS, not DeepSeek', async () => {
    await jobs.dispatchClusterSynthesize(fakeDb(), 'cl-1');
    expect(modelsUsed().length).toBeGreaterThan(0);
    expect(new Set(modelsUsed())).toEqual(new Set(['gpt_oss_120b']));
  });

  it('does not mint cluster art — that is deferred to the read path', async () => {
    await jobs.dispatchClusterSynthesize(fakeDb(), 'cl-1');
    expect(
      generateUglyPressImage,
      'synthesis must not pay for an image the story may never need',
    ).not.toHaveBeenCalled();
  });
});

describe('dispatchClusterSatirize', () => {
  it('writes the Ugly Take with GPT-OSS, not gpt_4o', async () => {
    genText.mockResolvedValue(
      '# A deadpan headline\n\n**CITY, ST—** Something absurd happened today.',
    );
    await jobs.dispatchClusterSatirize(fakeDb(), 'cl-1');
    expect(modelsUsed()).toContain('gpt_oss_120b');
    expect(modelsUsed()).not.toContain('gpt_4o');
  });

  it('does not generate art for the satire file either', async () => {
    genText.mockResolvedValue(
      '# A deadpan headline\n\n**CITY, ST—** Something absurd happened today.',
    );
    await jobs.dispatchClusterSatirize(fakeDb(), 'cl-1');
    expect(generateUglyPressImage).not.toHaveBeenCalled();
  });
});
