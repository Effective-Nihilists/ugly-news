import type { DBObject, TypedDB } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type {
  FileMarkdown,
  NewsArticle,
  NewsPodcast,
} from '../../shared/collections';
import { uglyBotId } from '../../shared/news/Bot';
import { decodeHtmlEntities } from './download';
import { embed } from './ai';

type Db = TypedDB<Record<string, DBObject>>;

// Stopwords dropped from a keyword query so natural-language questions
// ("latest news on AI regulation") still match by their content terms.
const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'on',
  'in',
  'to',
  'for',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'about',
  'with',
  'what',
  'whats',
  'who',
  'when',
  'where',
  'why',
  'how',
  'latest',
  'news',
  'recent',
  'tell',
  'me',
  'show',
  'find',
  'any',
  'this',
  'that',
  'these',
  'those',
  'do',
  'does',
  'did',
  'i',
  'you',
  'it',
]);

/** Significant lowercased terms (≥3 chars, non-stopword) from a query. */
function queryTerms(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !STOP.has(t)),
    ),
  ];
}

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
  clusterId: string | null;
}
export interface PodcastCard {
  id: string;
  date: string;
  title: string;
  description: string;
  durationMs: number;
  articleCount: number;
  coverImageUri: string | null;
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
  const t = s
    .replace(/[#>*_`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function fileToCard(
  f: FileMarkdown & { _id: string; created?: unknown },
): NewsCard {
  return {
    id: f._id,
    title: decodeHtmlEntities(f.title ?? 'Untitled'),
    summary: decodeHtmlEntities(
      f.text ? snippet(f.text) : snippet(f.markdown ?? ''),
    ),
    thumbnailUri: f.thumbnail?.uri ?? null,
    category: f.category ?? f.tags?.[0] ?? null,
    feedId: f.feedId ?? null,
    createdMs: ms(f.created),
  };
}

function articleToCard(
  a: NewsArticle & { _id: string; created?: unknown },
): NewsCard {
  return {
    id: a._id,
    title: decodeHtmlEntities(a.title),
    summary: decodeHtmlEntities(snippet(a.summary ?? a.contentMarkdown ?? '')),
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
      if (next) {
        out.push(next);
        added = true;
        if (out.length >= limit) break;
      }
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
  if (input.category) fileMatch.category = input.category;
  // Pull a wider recent window, then diversify so the front page isn't
  // monopolized by whichever feed synced last (e.g. an all-techcrunch run).
  // Round-robin across feeds and float image-bearing stories up — a news
  // front page should be varied and visual, not one source in recency order.
  const pool = await db.getQuery<
    FileMarkdown & { _id: string; created?: unknown }
  >('file', [{ $match: fileMatch }, { $sort: { created: -1 } }], {
    limit: Math.max(limit * 6, 90),
  });
  if (pool.length > 0) {
    const cards = pool.map(fileToCard);
    return { items: diversify(cards, limit) };
  }

  // Fallback: raw articles (skip ads / unscraped-empty).
  const artMatch: Record<string, unknown> = { scrapeStatus: { $ne: 'ad' } };
  if (input.category) artMatch.categories = input.category;
  const articles = await db.getQuery<
    NewsArticle & { _id: string; created?: unknown }
  >('newsArticle', [{ $match: artMatch }, { $sort: { created: -1 } }], {
    limit,
  });
  return { items: articles.map(articleToCard) };
}

/**
 * Public archive: all published stories newest-first, with an optional keyword
 * filter over title/summary. Offset-paginated (skip) so the client can render
 * history grouped by date and "load more". Unlike `newsLatest` this is NOT
 * diversified — the archive wants true reverse-chronological order.
 */
export async function newsArchive(
  db: Db,
  input: {
    query?: string | undefined;
    limit?: number | undefined;
    skip?: number | undefined;
    category?: string | undefined;
  },
): Promise<{ items: NewsCard[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const skip = Math.max(input.skip ?? 0, 0);
  const filter: Record<string, unknown> = {
    public: true,
    userId: uglyBotId,
    type: 'markdown',
  };
  if (input.category) filter.category = input.category;
  const q = input.query?.trim();

  if (q) {
    // Hybrid semantic + full-text search via one getDocs call:
    //  - `near`: a 512-dim OpenAI query embedding ranked against the file's
    //    Cloudflare Vectorize vector (cosine) — catches meaning with no keyword
    //    overlap ("tensions in the middle east" → Lebanon/Iran stories). The
    //    filter's public/userId/type/category ride as Vectorize metadata
    //    pre-filters (declared in the collection's vector.filterable).
    //  - `search`: the in-D1 SQLite FTS5 index over ['title','text']. OR-join the
    //    significant terms so the query doesn't AND them to zero.
    // When both are present the framework fuses FTS5 + Vectorize with RRF (k=60).
    // If the query embedding is unavailable we degrade to FTS-only.
    const terms = queryTerms(q);
    const search = terms.length ? terms.join(' OR ') : q;
    const near = (await embed(q)) ?? undefined;
    const rows = await db.getDocs(collections.file, filter, {
      search,
      ...(near ? { near } : {}),
      limit: limit + 1,
      skip,
    });
    const hasMore = rows.length > limit;
    return {
      items: rows
        .slice(0, limit)
        .map((r) =>
          fileToCard(r as FileMarkdown & { _id: string; created?: unknown }),
        ),
      hasMore,
    };
  }

  // Browse: true reverse-chronological with offset pagination.
  const rows = await db.getQuery<
    FileMarkdown & { _id: string; created?: unknown }
  >('file', [{ $match: filter }, { $sort: { created: -1 } }], {
    limit: limit + 1,
    skip,
  });
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map(fileToCard), hasMore };
}

/**
 * Public archive: every past daily podcast newest-first as lightweight cards
 * (no heavy segments/visemes payload). Offset-paginated.
 */
export async function newsPodcastArchive(
  db: Db,
  input: { limit?: number | undefined; skip?: number | undefined },
): Promise<{ items: PodcastCard[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const skip = Math.max(input.skip ?? 0, 0);
  // Only the default (public) episodes exist in this app; list newest-first.
  const rows = await db.getQuery<NewsPodcast & { _id: string }>(
    'newsPodcast',
    [{ $match: {} }, { $sort: { date: -1 } }],
    { limit: limit + 1, skip },
  );
  const hasMore = rows.length > limit;
  const items: PodcastCard[] = rows.slice(0, limit).map((p) => ({
    id: p._id,
    date: p.date,
    title: p.title,
    description: p.description,
    durationMs: p.durationMs,
    articleCount: p.articles?.length ?? 0,
    coverImageUri: p.articles?.find((a) => a.imageUri)?.imageUri ?? null,
  }));
  return { items, hasMore };
}

/** A single article for the public article page (file first, else raw article). */
export async function newsArticleGet(
  db: Db,
  input: { id: string },
): Promise<{ article: NewsArticleFull | null }> {
  const file = await db.getDoc(collections.file, input.id);
  if (file) {
    const f = file as FileMarkdown & { _id: string; created?: unknown };
    const card = fileToCard(f);
    return {
      article: {
        ...card,
        markdown: decodeHtmlEntities(f.markdown ?? ''),
        sourceUri: f.sourceUri ?? null,
        clusterId: f.clusterId ?? null,
      },
    };
  }
  const a = await db.getDoc(collections.newsArticle, input.id);
  if (a) {
    const card = articleToCard(a);
    const art = a as NewsArticle;
    return {
      article: {
        ...card,
        markdown: decodeHtmlEntities(art.summary ?? art.contentMarkdown ?? ''),
        sourceUri: art.uri ?? null,
        clusterId: null,
      },
    };
  }
  return { article: null };
}
