import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { NewsArticle } from '../../shared/collections';
import { isStringEmpty } from '../../shared/news/Bot';
import type { NewsCategory } from '../../shared/news/types';
import type { NewsDb } from './db';
import { enqueueTask } from './queue';

// GDELT Doc 2.0 — free, no key, ~15-min cadence over thousands of global
// outlets. We pull a recent slice per desk for breadth + underreported-story
// detection; items insert as `newsArticle`s (feedId 'gdelt', UNRATED for bias)
// and flow through the same scrape → embed → cluster path as RSS.
const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const PER_CATEGORY = 20;
// GDELT's public Doc API rate-limits to ONE request / 5s (429 otherwise) and a
// 2h window returns ~nothing for English desk queries — verified live. Use a
// 24h window (dedup by URL hash skips already-seen articles) and space the
// per-desk requests out.
const TIMESPAN = '24h';
const GDELT_REQUEST_GAP_MS = 6000;

// Query term per desk (GDELT ANDs terms with `sourcelang:english`).
const GDELT_QUERIES: Partial<Record<NewsCategory, string>> = {
  politics: 'politics',
  world: 'world',
  business: 'business OR economy',
  tech: 'technology',
  science: 'science',
};

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
}

function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Parse GDELT's `YYYYMMDDTHHMMSSZ` seendate to epoch ms (now on failure). */
function parseSeenDate(s: string | undefined): number {
  if (!s) return Date.now();
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? Date.now() : t;
  }
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

async function fetchGdelt(query: string): Promise<GdeltArticle[]> {
  const url =
    `${GDELT_DOC_URL}?query=${encodeURIComponent(`${query} sourcelang:english`)}` +
    `&mode=artlist&format=json&sort=datedesc&maxrecords=${PER_CATEGORY}&timespan=${TIMESPAN}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; UglyNews/1.0; +https://ugly.press)' },
  });
  if (!res.ok) {
    // 429 = exceeded GDELT's 1-req/5s limit — surface it distinctly so we can
    // see in the logs whether GDELT_REQUEST_GAP_MS needs raising.
    const hint = res.status === 429 ? ' (rate-limited — raise GDELT_REQUEST_GAP_MS)' : '';
    throw new Error(`GDELT HTTP ${res.status}${hint}`);
  }
  // GDELT sometimes returns HTML/empty on a bad query; guard the JSON parse.
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { articles?: GdeltArticle[] };
    return data.articles ?? [];
  } catch {
    console.warn(`[gdelt] non-JSON response for query="${query}": ${text.slice(0, 120)}`);
    return [];
  }
}

/** Pull a recent GDELT slice per desk and enqueue scrapes for new URLs. The
 *  per-desk requests are spaced ≥5s apart to respect GDELT's rate limit. */
export async function dispatchGdeltPull(db: NewsDb, now: number = Date.now()): Promise<void> {
  const entries = Object.entries(GDELT_QUERIES);
  let totalNew = 0;
  for (let i = 0; i < entries.length; i++) {
    const [category, query] = entries[i]!;
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, GDELT_REQUEST_GAP_MS));
    let articles: GdeltArticle[];
    try {
      articles = await fetchGdelt(query);
    } catch (error) {
      console.error(`[gdelt] desk=${category} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let added = 0;
    for (const a of articles) {
      try {
        if (isStringEmpty(a.url) || isStringEmpty(a.title)) continue;
        const _id = `gdelt_${stableHash(a.url!)}`;
        if (await db.getDoc(collections.newsArticle, _id)) continue;

        const createdMs = parseSeenDate(a.seendate);
        const article: NewsArticle = {
          _id,
          feedId: 'gdelt',
          title: a.title!.trim(),
          contentHtml: '',
          contentMarkdown: a.title!.trim(),
          uri: a.url!,
          categories: [category],
          imageUri: isStringEmpty(a.socialimage) ? null : a.socialimage!,
          summary: null,
          summaryGeneratedAt: null,
          scrapeStatus: 'pending',
          scrapeError: null,
          scrapedAt: null,
          fileId: null,
          ...dbDefaults(),
          created: new Date(createdMs),
        };
        await db.setDoc(collections.newsArticle, article);
        await enqueueTask('articleScrape', { articleId: _id });
        added++;
      } catch (error) {
        console.error(`[gdelt] desk=${category} item failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    totalNew += added;
    console.log(`[gdelt] desk=${category} fetched=${articles.length} new=${added}`);
    void now;
  }
  console.log(`[gdelt] pull complete — ${totalNew} new articles enqueued for scrape`);
}
