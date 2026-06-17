import { describe, expect, it } from 'vitest';
import { newsPodcastGetDefault } from '../../../server/news/podcast';

// Minimal fake Db — newsPodcastGetDefault only calls getDoc (today's key) and,
// when today's episode isn't ready yet, getQuery (latest complete fallback).
function fakeDb(docs: Record<string, unknown>, queryRows: unknown[] = []) {
  const calls = {
    getDoc: [] as string[],
    getQuery: [] as { coll: string; pipeline: Record<string, unknown>[]; opts: { limit?: number } }[],
  };
  const db = {
    getDoc: async (_coll: unknown, id: string) => {
      calls.getDoc.push(id);
      return docs[id] ?? null;
    },
    getQuery: async (coll: string, pipeline: Record<string, unknown>[], opts: { limit?: number }) => {
      calls.getQuery.push({ coll, pipeline, opts });
      return queryRows.slice(0, opts.limit ?? queryRows.length);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, calls };
}

function pod(date: string, status: 'complete' | 'generating' | 'failed' = 'complete') {
  return {
    _id: `${date}_default`,
    date,
    userId: null,
    generationStatus: status,
    audioUri: status === 'complete' ? `https://audio/${date}.wav` : '',
  };
}

describe('newsPodcastGetDefault', () => {
  it("returns today's episode when it exists and is complete (no fallback query)", async () => {
    const today = pod('2026-06-17', 'complete');
    const { db, calls } = fakeDb({ '2026-06-17_default': today });

    const out = await newsPodcastGetDefault(db, { date: '2026-06-17' });

    expect(out.podcast?._id).toBe('2026-06-17_default');
    expect(calls.getQuery).toHaveLength(0); // no fallback needed
  });

  it("falls back to the latest complete episode when today's doesn't exist yet (the 00:00–10:00 UTC gap)", async () => {
    const yesterday = pod('2026-06-16', 'complete');
    const { db, calls } = fakeDb({}, [yesterday]);

    const out = await newsPodcastGetDefault(db, { date: '2026-06-17' });

    expect(out.podcast?._id).toBe('2026-06-16_default');
    expect(calls.getQuery).toHaveLength(1);
    const q = calls.getQuery[0]!;
    expect(q.coll).toBe('newsPodcast');
    expect(q.pipeline[0]).toEqual({ $match: { userId: null, generationStatus: 'complete' } });
    expect(q.pipeline[1]).toEqual({ $sort: { date: -1 } });
    expect(q.opts.limit).toBe(1);
  });

  it("falls back when today's episode exists but is still generating", async () => {
    const todayGenerating = pod('2026-06-17', 'generating');
    const yesterday = pod('2026-06-16', 'complete');
    const { db } = fakeDb({ '2026-06-17_default': todayGenerating }, [yesterday]);

    const out = await newsPodcastGetDefault(db, { date: '2026-06-17' });

    expect(out.podcast?._id).toBe('2026-06-16_default');
  });

  it("falls back when today's generation failed", async () => {
    const todayFailed = pod('2026-06-17', 'failed');
    const yesterday = pod('2026-06-16', 'complete');
    const { db } = fakeDb({ '2026-06-17_default': todayFailed }, [yesterday]);

    const out = await newsPodcastGetDefault(db, { date: '2026-06-17' });

    expect(out.podcast?._id).toBe('2026-06-16_default');
  });

  it('returns null only when no complete episode exists anywhere', async () => {
    const { db } = fakeDb({}, []);
    const out = await newsPodcastGetDefault(db, { date: '2026-06-17' });
    expect(out.podcast).toBeNull();
  });
});
