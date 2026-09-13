import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Per-article AI spend in `dispatchArticleScrape`.
 *
 * Every article used to draw FOUR billed calls: the ad gate, the summary, the
 * embedding, and a "newsBot opening comment". The comment was written to a
 * `message` doc on a conversation keyed by fileId — and nothing ever rendered
 * it. No page in `client/pages/` reads an article thread (the only
 * conversation UI is ChatDemoPage/ChatTestPage), so that call produced 16,158
 * rows a week, cost $2.44, and was never seen by a human.
 *
 * `generateBotComment` is deliberately KEPT and exported so a future thread UI
 * can call it on first open; what must not happen is paying for it up front.
 */

const genText = vi.fn(async () => 'text');
const embed = vi.fn(async () => [0.1, 0.2]);

vi.mock('../../../server/news/ai', () => ({
  genText,
  embed,
  truncateToApproximateTokens: (t: string, n: number) => t.slice(0, n * 4),
  generateUglyPressImage: vi.fn(async () => 'https://img/x.png'),
}));
vi.mock('../../../server/news/cluster', () => ({
  assignFileToCluster: vi.fn(async () => undefined),
}));
vi.mock('../../../server/news/download', () => ({
  htmlToMarkdown: (s: string) => s,
}));

const { dispatchArticleScrape } = await import('../../../server/news/scraper');

const written: { collection: string; doc: Record<string, unknown> }[] = [];

function fakeDb(): never {
  return {
    getDoc: async (_c: { name?: string }, id: string) =>
      id === 'art-1'
        ? {
            _id: 'art-1',
            title: 'Council approves bond',
            contentMarkdown: 'The council voted on Tuesday to approve a bond.',
            uri: null,
            imageUri: null,
            categories: ['world'],
            feedId: 'feed-1',
            fileId: null,
            created: new Date(),
          }
        : null,
    setDoc: async (
      c: { name?: string } | string,
      doc: Record<string, unknown>,
    ) => {
      const name =
        typeof c === 'string' ? c : (c.name ?? JSON.stringify(c).slice(0, 40));
      written.push({ collection: name, doc });
    },
  } as never;
}

beforeEach(() => {
  written.length = 0;
  genText.mockClear();
  embed.mockClear();
  // ad gate -> "ARTICLE", summary -> a real summary. Any FURTHER call gets a
  // comment long enough to clear generateBotComment's 20-char floor, so the
  // message-doc assertion below can actually fail if the call comes back.
  genText
    .mockResolvedValueOnce('ARTICLE')
    .mockResolvedValueOnce('A summary.')
    .mockResolvedValue('A sardonic observation about the bond vote.');
});

describe('dispatchArticleScrape — billed calls per article', () => {
  it('spends exactly two genText calls: the ad gate and the summary', async () => {
    await dispatchArticleScrape(fakeDb(), 'art-1');
    expect(
      genText.mock.calls.map((c) => (c[1] as { model: string }).model),
      'a third genText call means the bot comment is being generated eagerly again',
    ).toEqual(['gpt_oss_120b', 'gpt_oss_120b']);
  });

  it('writes no message doc, because nothing renders an article thread', async () => {
    await dispatchArticleScrape(fakeDb(), 'art-1');
    const ids = written.map((w) => String(w.doc._id ?? ''));
    expect(ids.some((id) => id.startsWith('msg_'))).toBe(false);
  });
});
