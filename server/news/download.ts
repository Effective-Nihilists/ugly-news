import { XMLParser } from 'fast-xml-parser';
import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { NewsArticle } from '../../shared/collections';
import { isDefined, isStringEmpty } from '../../shared/news/Bot';
import type { NewsFeed } from '../../shared/news/types';
import { newsFeeds } from '../../shared/news/types';
import type { NewsDb } from './db';
import { enqueueTask } from './queue';

// Workers-safe RSS/Atom parsing: global fetch() + fast-xml-parser (pure JS).
// Replaces rss-parser, which pulls in Node http/https and won't bundle for CF.
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep arrays for repeatable media tags so extractImage can scan them.
  isArray: (name) =>
    ['item', 'entry', 'media:content', 'media:thumbnail'].includes(name),
});

interface RSSItem {
  guid?: string | { '#text'?: string; [k: string]: unknown };
  id?: string;
  isoDate?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  content?: string | { '#text'?: string };
  'content:encoded'?: string;
  summary?: string;
  link?: string | { '@_href'?: string } | { '@_href'?: string }[];
  title?: string | { '#text'?: string };
  'media:content'?: { '@_url'?: string; '@_medium'?: string; '@_type'?: string }[];
  'media:thumbnail'?: { '@_url'?: string }[];
  enclosure?: { '@_url'?: string; '@_type'?: string };
  image?: { url?: string } | string;
}

function textOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && '#text' in v) {
    const t = (v as { '#text'?: unknown })['#text'];
    return typeof t === 'string' ? t : undefined;
  }
  return undefined;
}

function linkOf(item: RSSItem): string | null {
  const l = item.link;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) {
    // Atom: prefer rel=alternate / first href
    const alt = l.find((x) => x['@_href']);
    return alt?.['@_href'] ?? null;
  }
  if (l && typeof l === 'object' && '@_href' in l) return l['@_href'] ?? null;
  return null;
}

/** Fetch a feed URL and normalize RSS 2.0 / Atom into a flat item list. */
async function fetchFeedItems(url: string): Promise<RSSItem[]> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; UglyNews/1.0; +https://ugly.press)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const parsed = xml.parse(body) as {
    rss?: { channel?: { item?: RSSItem[] } };
    feed?: { entry?: RSSItem[] };
  };
  return parsed.rss?.channel?.item ?? parsed.feed?.entry ?? [];
}

/** Stable hex hash (FNV-1a, 32-bit) — Workers-safe, no md5 dependency. */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Lightweight HTML → plain markdown-ish text (Workers-safe; no DOM/turndown).
 * The full article body is produced later by the scraper; this is just the
 * RSS-provided fallback content. */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractImageFromRSSItem(item: RSSItem): string | null {
  if (item['media:content']?.length) {
    for (const media of item['media:content']) {
      const url = media['@_url'];
      if (url && (media['@_medium'] === 'image' || media['@_type']?.startsWith('image/'))) {
        return url;
      }
      if (url && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return url;
    }
  }
  if (item['media:thumbnail']?.length) {
    const url = item['media:thumbnail'][0]?.['@_url'];
    if (url) return url;
  }
  if (item.enclosure?.['@_url'] && item.enclosure['@_type']?.startsWith('image/')) {
    return item.enclosure['@_url'];
  }
  if (item.image) {
    if (typeof item.image === 'string') return item.image;
    if (item.image.url) return item.image.url;
  }
  const contentHtml =
    item['content:encoded'] ?? textOf(item.content) ?? item.description ?? '';
  const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(contentHtml);
  if (imgMatch?.[1]) return imgMatch[1];
  return null;
}

/** Download + parse one RSS feed, create newsArticle docs, enqueue scrapes. */
export async function dispatchNewsFeedDownload(
  db: NewsDb,
  feed: NewsFeed,
): Promise<void> {
  let items: RSSItem[];
  try {
    items = await fetchFeedItems(feed.url);
  } catch (error) {
    console.warn('[NEWS] RSS feed download failed', { feedId: feed.id, error });
    return;
  }

  for (const item of items) {
    try {
      const guidText =
        textOf(item.guid as unknown) ??
        (typeof item.guid === 'string' ? item.guid : undefined);
      const rawGuid = guidText ?? item.id ?? item.isoDate ?? item.pubDate ?? item.published;
      if (!isDefined(rawGuid)) continue;
      const _id = `${feed.id}_${stableHash(rawGuid)}`;

      if (isDefined(await db.getDoc(collections.newsArticle, _id))) continue;

      const imageUri = extractImageFromRSSItem(item);
      const contentHtml =
        [item['content:encoded'], textOf(item.content), item.description, item.summary].find(
          (x) => !isStringEmpty(x),
        ) ?? '';
      const contentMarkdown = htmlToMarkdown(contentHtml);
      if (isStringEmpty(contentMarkdown)) continue;

      const title = (textOf(item.title) ?? '').trim();
      if (isStringEmpty(title)) continue;

      const uri = linkOf(item);
      const dateStr = item.isoDate ?? item.published ?? item.pubDate ?? item.updated;
      const parsedMs = dateStr ? Date.parse(dateStr) : NaN;
      const createdMs = Number.isNaN(parsedMs) ? Date.now() : parsedMs;

      const article: NewsArticle = {
        _id,
        feedId: feed.id,
        title,
        contentHtml,
        contentMarkdown,
        uri,
        categories: [feed.category],
        imageUri,
        summary: null,
        summaryGeneratedAt: null,
        scrapeStatus: uri ? 'pending' : 'skipped',
        scrapeError: null,
        scrapedAt: null,
        fileId: null,
        ...dbDefaults(),
        created: new Date(createdMs),
      };
      await db.setDoc(collections.newsArticle, article);

      if (uri) await enqueueTask('articleScrape', { articleId: _id });
    } catch (error) {
      console.error('[NEWS] Failed to process RSS item', { feedId: feed.id, error });
    }
  }
}

/** Enqueue a download job for every configured feed (called by newsHourly). */
export async function newsRefreshAllFeeds(): Promise<void> {
  await Promise.all(
    newsFeeds.map((feed) => enqueueTask('newsFeedDownload', { feedId: feed.id })),
  );
}

/** Look up a feed by id (used by the newsFeedDownload worker). */
export function findFeed(feedId: string): NewsFeed | undefined {
  return newsFeeds.find((f) => f.id === feedId);
}
