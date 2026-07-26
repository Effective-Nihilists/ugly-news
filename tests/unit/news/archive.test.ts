import { describe, expect, it, vi } from 'vitest';

// public.ts reaches the ugly.bot embedGen proxy for the `near` half of hybrid
// search. Stub it so the query tests are deterministic and offline; the
// no-embedding path is covered explicitly below.
vi.mock('../../../server/news/ai', () => ({
  embed: vi.fn(async () => Array.from({ length: 512 }, () => 0.01)),
}));

import { newsArchive, newsPodcastArchive } from '../../../server/news/public';
import { collections } from '../../../shared/collections';

// Minimal fake of the framework Db. Browse goes through getQuery (aggregation
// pipeline); search goes through getDocs (hybrid FTS5 + Vectorize, fused with
// RRF by the framework). Capture both so we can assert query shaping.
function fakeDb(rows: unknown[]) {
  const calls: {
    coll: string;
    pipeline: Record<string, unknown>[];
    opts: { limit?: number; skip?: number };
  }[] = [];
  const searchCalls: {
    query: string;
    opts: { limit?: number; filter?: Record<string, unknown> };
  }[] = [];
  const getDocsCalls: {
    coll: string;
    filter: Record<string, unknown>;
    opts: {
      search?: string;
      near?: number[];
      limit?: number;
      skip?: number;
    };
  }[] = [];
  const db = {
    getDocs: async (
      coll: string,
      filter: Record<string, unknown>,
      opts: {
        search?: string;
        near?: number[];
        limit?: number;
        skip?: number;
      },
    ) => {
      getDocsCalls.push({ coll, filter, opts });
      // The framework returns already-ranked, already-paginated rows.
      return rows.slice(0, opts.limit ?? rows.length);
    },
    getQuery: async (
      coll: string,
      pipeline: Record<string, unknown>[],
      opts: { limit?: number; skip?: number },
    ) => {
      calls.push({ coll, pipeline, opts });
      return rows.slice(0, opts.limit ?? rows.length);
    },
    searchDocs: async (
      _coll: unknown,
      query: string,
      opts: { limit?: number; filter?: Record<string, unknown> },
    ) => {
      searchCalls.push({ query, opts });
      return rows.slice(0, opts.limit ?? rows.length);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, calls, searchCalls, getDocsCalls };
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
    expect(out.items[0]).toMatchObject({
      id: 'a',
      title: 'Title a',
      thumbnailUri: 'https://img/a.jpg',
      category: 'tech',
    });
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

  it('runs a query as one hybrid getDocs call: OR-joined FTS terms + a near vector', async () => {
    const rows = [
      story('a', new Date('2026-06-14T10:00:00Z'), {
        title: 'Iran deal signed Sunday',
      }),
      story('c', new Date('2026-06-13T09:00:00Z'), {
        title: 'Markets react to IRAN news',
      }),
    ];
    const { db, calls, getDocsCalls } = fakeDb(rows);
    const out = await newsArchive(db, {
      limit: 10,
      skip: 0,
      query: ' iran talks ',
    });

    expect(calls).toHaveLength(0); // no browse pipeline on the query path
    expect(getDocsCalls).toHaveLength(1);
    const call = getDocsCalls[0]!;
    expect(call.coll).toBe(collections.file);
    // Terms are OR-joined so FTS5 doesn't AND them to zero. Stopwords/<3 chars
    // are dropped by queryTerms.
    expect(call.opts.search).toBe('iran OR talks');
    expect(call.opts.near).toHaveLength(512);
    expect(call.filter['public']).toBe(true);
    expect(call.filter['type']).toBe('markdown');
    expect(out.items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('degrades to FTS-only when the query embedding is unavailable', async () => {
    const { embed } = await import('../../../server/news/ai');
    vi.mocked(embed).mockResolvedValueOnce(null);
    const { db, getDocsCalls } = fakeDb([]);
    await newsArchive(db, { limit: 10, skip: 0, query: 'iran' });
    // `near` must be OMITTED, not passed as null/undefined — the framework
    // treats its presence as "do a vector search".
    expect('near' in getDocsCalls[0]!.opts).toBe(false);
    expect(getDocsCalls[0]!.opts.search).toBe('iran');
  });

  it('delegates search pagination to getDocs via limit+1 / skip', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      story(`s${i}`, new Date('2026-06-14T10:00:00Z'), {
        title: `Breaking news item ${i}`,
      }),
    );
    const { db, getDocsCalls } = fakeDb(rows);
    const out = await newsArchive(db, { limit: 10, skip: 10, query: 'news' });
    // Ranking and offsetting happen in D1/Vectorize now, not in JS — the
    // handler must push skip down rather than over-fetch and slice.
    expect(getDocsCalls[0]!.opts.limit).toBe(11); // limit + 1 (hasMore probe)
    expect(getDocsCalls[0]!.opts.skip).toBe(10);
    expect(out.items).toHaveLength(10);
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
