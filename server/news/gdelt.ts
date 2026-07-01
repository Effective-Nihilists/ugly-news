import { franc } from 'franc-min';
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
const GDELT_MAX_RECORDS = 75;
const TIMESPAN = '24h';
// ONE broad request per run — NOT a per-desk loop. GDELT's public Doc API
// rate-limits to 1 req/5s, and `setTimeout` sleeps are unreliable inside a
// Cloudflare cron handler (which is why the old 5-request-with-gaps version
// produced 0 articles in prod). A single request sidesteps both. Category is
// inferred from the headline (categorizeGdelt) since one query spans desks.
const GDELT_QUERY = '(election OR congress OR president OR senate OR economy OR market OR technology OR science OR court OR war OR climate) sourcelang:english';

const CATEGORY_PATTERNS: [NewsCategory, RegExp][] = [
  ['politics', /\b(election|congress|senate|president|white house|governor|gop|democrat|republican|campaign|supreme court|policy|impeach|vote|lawmaker|capitol)\b/i],
  ['business', /\b(econom|market|stock|inflation|trade|tariff|fed|earnings|revenue|ceo|billion|nasdaq|dow|layoff|ipo|merger)\b/i],
  ['tech', /\b(\bai\b|artificial intelligence|software|chip|semiconductor|startup|google|apple|microsoft|meta|openai|app|cyber|hacker|robot)\b/i],
  ['science', /\b(study|research|scientist|space|nasa|physics|biolog|genome|quantum|telescope|climate|fossil|species)\b/i],
];

function categorizeGdelt(title: string): NewsCategory {
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(title)) return cat;
  return 'world';
}

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

async function fetchGdelt(): Promise<GdeltArticle[]> {
  const url =
    `${GDELT_DOC_URL}?query=${encodeURIComponent(GDELT_QUERY)}` +
    `&mode=artlist&format=json&sort=datedesc&maxrecords=${GDELT_MAX_RECORDS}&timespan=${TIMESPAN}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; UglyNews/1.0; +https://ugly.press)' },
  });
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
  // GDELT sometimes returns HTML/empty on a bad query; guard the JSON parse.
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { articles?: GdeltArticle[] };
    return data.articles ?? [];
  } catch {
    console.warn(`[gdelt] non-JSON response: ${text.slice(0, 120)}`);
    return [];
  }
}

/** Pull one broad recent GDELT slice and enqueue scrapes for new URLs. Single
 *  request (no rate-limit dance, no cron-unfriendly setTimeout). */
export async function dispatchGdeltPull(db: NewsDb, now: number = Date.now()): Promise<void> {
  void now;
  let articles: GdeltArticle[];
  try {
    articles = await fetchGdelt();
  } catch (error) {
    console.error(`[gdelt] fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  let added = 0;
  for (const a of articles) {
    try {
      if (isStringEmpty(a.url) || isStringEmpty(a.title)) continue;
      // English-only (GDELT's sourcelang:english occasionally slips).
      const lang = franc(a.title, { minLength: 25 });
      if (lang !== 'eng' && lang !== 'und') continue;
      const _id = `gdelt_${stableHash(a.url!)}`;
      if (await db.getDoc(collections.newsArticle, _id)) continue;

      const category = categorizeGdelt(a.title!);
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
      console.error(`[gdelt] item failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`[gdelt] pull complete — fetched=${articles.length} new=${added}`);
}
