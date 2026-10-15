import { describe, expect, it } from 'vitest';
import { cacheBustedFeedUrl } from '../../../server/news/download';
import { newsFeeds } from '../../../shared/news/types';

/**
 * Prod 2026-10-08: "[NEWS] RSS feed download failed [techcrunch]: TypeError:
 * Too many redirects. https://techcrunch.com/feed/, https://techcrunch.com/feed/…"
 * — a self-redirect only the Worker saw (the feed answers 200 from anywhere
 * else). A cache-key-busting query param sidesteps the poisoned redirect.
 */
describe('feed redirect-loop fallback', () => {
  it('adds an hourly cache-busting param without touching the path', () => {
    const url = cacheBustedFeedUrl('https://techcrunch.com/feed/', 7_200_000);
    expect(url).toBe('https://techcrunch.com/feed/?_ugly=2');
  });

  it('keeps an existing query string', () => {
    expect(cacheBustedFeedUrl('https://x.com/rss?a=1', 0)).toBe(
      'https://x.com/rss?a=1&_ugly=0',
    );
  });

  it('points ft and avclub at their post-redirect feed URLs', () => {
    const byId = new Map(newsFeeds.map((f) => [f.id, f.url]));
    expect(byId.get('ft')).toBe('https://www.ft.com/rss/home/international');
    expect(byId.get('avclub')).toBe('https://www.avclub.com/rss.xml');
  });
});
