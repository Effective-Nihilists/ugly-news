import type { DBObject, TypedDB } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsArticle } from '../../shared/collections';
import { uglyBotId } from '../../shared/news/Bot';

type Db = TypedDB<Record<string, DBObject>>;

export interface NewsCard {
  id: string;
  title: string;
  summary: string;
  thumbnailUri: string | null;
  category: string | null;
  feedId: string | null;
  createdMs: number;
}
export interface NewsArticleFull extends NewsCard {
  markdown: string;
  sourceUri: string | null;
}

function ms(created: unknown): number {
  if (created instanceof Date) return created.getTime();
  if (typeof created === 'number') return created;
  if (typeof created === 'string') {
    const t = Date.parse(created);
    return Number.isNaN(t) ? Date.now() : t;
  }
  return Date.now();
}

function snippet(s: string, n = 220): string {
  const t = s.replace(/[#>*_`[\]]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function fileToCard(f: FileMarkdown & { _id: string; created?: unknown }): NewsCard {
  return {
    id: f._id,
    title: f.title ?? 'Untitled',
    summary: f.text ? snippet(f.text) : snippet(f.markdown ?? ''),
    thumbnailUri: f.thumbnail?.uri ?? null,
    category: f.category ?? f.tags?.[0] ?? null,
    feedId: f.feedId ?? null,
    createdMs: ms(f.created),
  };
}

function articleToCard(a: NewsArticle & { _id: string; created?: unknown }): NewsCard {
  return {
    id: a._id,
    title: a.title,
    summary: snippet(a.summary ?? a.contentMarkdown ?? ''),
    thumbnailUri: a.imageUri ?? null,
    category: a.categories?.[0] ?? null,
    feedId: a.feedId,
    createdMs: ms(a.created),
  };
}

/**
 * Spread a recency-ordered list across feeds (round-robin) so no single source
 * dominates the front page, and bias each feed's queue so its image-bearing
 * stories come first. Returns the first `limit` of the interleaved result.
 */
function diversify(cards: NewsCard[], limit: number): NewsCard[] {
  const byFeed = new Map<string, NewsCard[]>();
  for (const c of cards) {
    const key = c.feedId ?? '_';
    (byFeed.get(key) ?? byFeed.set(key, []).get(key)!).push(c);
  }
  // Within each feed keep recency but float image-bearing stories forward.
  for (const list of byFeed.values()) {
    list.sort((a, b) => {
      const ai = a.thumbnailUri ? 0 : 1;
      const bi = b.thumbnailUri ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return b.createdMs - a.createdMs;
    });
  }
  const queues = [...byFeed.values()];
  const out: NewsCard[] = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) { out.push(next); added = true; if (out.length >= limit) break; }
    }
  }
  return out;
}

/**
 * Latest news for the public landing/feed. Prefers the summarized FileMarkdown
 * articles; falls back to raw newsArticle rows (real RSS headlines) so the feed
 * shows real news even before the scrape/summarize jobs finish.
 */
export async function newsLatest(
  db: Db,
  input: { limit?: number | undefined; category?: string | undefined },
): Promise<{ items: NewsCard[] }> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 60);
  const fileMatch: Record<string, unknown> = {
    public: true,
    userId: uglyBotId,
    type: 'markdown',
  };
  if (input.category) fileMatch['category'] = input.category;
  // Pull a wider recent window, then diversify so the front page isn't
  // monopolized by whichever feed synced last (e.g. an all-techcrunch run).
  // Round-robin across feeds and float image-bearing stories up — a news
  // front page should be varied and visual, not one source in recency order.
  const pool = await db.getQuery<FileMarkdown & { _id: string; created?: unknown }>(
    'file',
    [{ $match: fileMatch }, { $sort: { created: -1 } }],
    { limit: Math.max(limit * 6, 90) },
  );
  if (pool.length > 0) {
    const cards = pool.map(fileToCard);
    return { items: diversify(cards, limit) };
  }

  // Fallback: raw articles (skip ads / unscraped-empty).
  const artMatch: Record<string, unknown> = { scrapeStatus: { $ne: 'ad' } };
  if (input.category) artMatch['categories'] = input.category;
  const articles = await db.getQuery<NewsArticle & { _id: string; created?: unknown }>(
    'newsArticle',
    [{ $match: artMatch }, { $sort: { created: -1 } }],
    { limit },
  );
  return { items: articles.map(articleToCard) };
}

/** A single article for the public article page (file first, else raw article). */
export async function newsArticleGet(
  db: Db,
  input: { id: string },
): Promise<{ article: NewsArticleFull | null }> {
  const file = await db.getDoc(collections.file, input.id);
  if (file) {
    const card = fileToCard(file as FileMarkdown & { _id: string; created?: unknown });
    return {
      article: {
        ...card,
        markdown: (file as FileMarkdown).markdown ?? '',
        sourceUri: (file as FileMarkdown).sourceUri ?? null,
      },
    };
  }
  const a = await db.getDoc(collections.newsArticle, input.id);
  if (a) {
    const card = articleToCard(a as NewsArticle & { _id: string; created?: unknown });
    const art = a as NewsArticle;
    return {
      article: {
        ...card,
        markdown: art.summary ?? art.contentMarkdown ?? '',
        sourceUri: art.uri ?? null,
      },
    };
  }
  return { article: null };
}
