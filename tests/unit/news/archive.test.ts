import { describe, expect, it } from 'vitest';
import { newsArchive, newsPodcastArchive } from '../../../server/news/public';

// Minimal fake of the framework Db — the archive handlers only call getQuery.
// Captures the (collection, pipeline, options) so we can assert query shaping.
function fakeDb(rows: unknown[]) {
  const calls: { coll: string; pipeline: Record<string, unknown>[]; opts: { limit?: number; skip?: number } }[] = [];
  const searchCalls: { query: string; opts: { limit?: number; filter?: Record<string, unknown> } }[] = [];
  const db = {
    getQuery: async (coll: string, pipeline: Record<string, unknown>[], opts: { limit?: number; skip?: number }) => {
      calls.push({ coll, pipeline, opts });
      return rows.slice(0, opts.limit ?? rows.length);
    },
    searchDocs: async (_coll: unknown, query: string, opts: { limit?: number; filter?: Record<string, unknown> }) => {
      searchCalls.push({ query, opts });
      return rows.slice(0, opts.limit ?? rows.length);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, calls, searchCalls };
}

function story(id: string, created: Date, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    title: `Title ${id}`,
    text: `Body of ${id}`,
    thumbnail: { uri: `https://img/${id}.jpg` },
    category: 'tech',
    feedId: 'feedX',
    created,
    ...extra,
  };
}

describe('newsArchive', () => {
  it('fetches limit+1, reports hasMore, trims to limit, maps to cards', async () => {
    const rows = [
      story('a', new Date('2026-06-14T10:00:00Z')),
      story('b', new Date('2026-06-14T09:00:00Z')),
      story('c', new Date('2026-06-13T09:00:00Z')),
    ];
    const { db, calls } = fakeDb(rows);
    const out = await newsArchive(db, { limit: 2, skip: 0 });

    expect(calls[0].opts).toEqual({ limit: 3, skip: 0 }); // limit+1
    expect(out.hasMore).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({ id: 'a', title: 'Title a', thumbnailUri: 'https://img/a.jpg', category: 'tech' });
    expect(typeof out.items[0]!.createdMs).toBe('number');
  });

  it('only matches public uglyBot markdown files by default (no $or without a query)', async () => {
    const { db, calls } = fakeDb([]);
    await newsArchive(db, { limit: 10, skip: 0 });
    const match = calls[0].pipeline[0]!['$match'] as Record<string, unknown>;
    expect(match['public']).toBe(true);
    expect(match['type']).toBe('markdown');
    expect(match['$or']).toBeUndefined();
    expect(calls[0].coll).toBe('file');
  });

  it('keyword search scans a recent window and substring-filters title/summary (case-insensitive)', async () => {
    const rows = [
      story('a', new Date('2026-06-14T10:00:00Z'), { title: 'Iran deal signed Sunday' }),
      story('b', new Date('2026-06-14T09:00:00Z'), { title: 'Cats rule the internet', text: 'nothing here' }),
      story('c', new Date('2026-06-13T09:00:00Z'), { title: 'Markets react to IRAN news', text: 'x' }),
    ];
    const { db, calls, searchCalls } = fakeDb(rows);
    const out = await newsArchive(db, { limit: 10, skip: 0, query: ' iran ' });

    expect(searchCalls).toHaveLength(0); // FTS not used (column not provisioned)
    expect(calls[0].opts.limit).toBe(1000); // SEARCH_WINDOW
    expect(out.items.map((i) => i.id)).toEqual(['a', 'c']); // 'b' filtered out
  });

  it('paginates search results by slicing the filtered set', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      story(`s${i}`, new Date('2026-06-14T10:00:00Z'), { title: `Breaking news item ${i}` }),
    );
    const { db } = fakeDb(rows);
    const out = await newsArchive(db, { limit: 10, skip: 10, query: 'news' });
    expect(out.items).toHaveLength(10);
    expect(out.items[0]!.id).toBe('s10'); // sliced from offset 10
    expect(out.hasMore).toBe(true);
  });

  it('passes skip through for browse pagination', async () => {
    const { db, calls } = fakeDb([]);
    await newsArchive(db, { limit: 30, skip: 60 });
    expect(calls[0].opts.skip).toBe(60);
  });
});

describe('newsPodcastArchive', () => {
  it('maps podcasts to lightweight cards (duration, article count, first image)', async () => {
    const rows = [
      {
        _id: '2026-06-14_default',
        date: '2026-06-14',
        title: 'Episode One',
        description: 'desc',
        durationMs: 98680,
        articles: [{ imageUri: null }, { imageUri: 'https://img/x.jpg' }],
      },
    ];
    const { db, calls } = fakeDb(rows);
    const out = await newsPodcastArchive(db, { limit: 5, skip: 0 });

    expect(calls[0].coll).toBe('newsPodcast');
    expect(calls[0].pipeline[1]).toEqual({ $sort: { date: -1 } });
    expect(out.items[0]).toEqual({
      id: '2026-06-14_default',
      date: '2026-06-14',
      title: 'Episode One',
      description: 'desc',
      durationMs: 98680,
      articleCount: 2,
      coverImageUri: 'https://img/x.jpg', // first non-null image
    });
    expect(out.hasMore).toBe(false);
  });
});
