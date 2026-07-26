import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../server/news/queue', () => ({ enqueueTask: async () => {} }));

import { dispatchNewsFeedDownload } from '../../../server/news/download';
import type { NewsFeed } from '../../../shared/news/types';

// Atom feeds serve `<summary type="html">…</summary>` / `<title type="html">`,
// which fast-xml-parser returns as `{ '#text', '@_type' }` rather than a bare
// string. cnet is one such feed. Before the fix only `content` was unwrapped
// via textOf(), so an object reached isStringEmpty() and threw `x.trim is not
// a function` — INSIDE the per-item try/catch, so every cnet item was dropped
// silently. Nothing was ever persisted, so the next hourly sweep re-processed
// and re-threw the same items forever: 3,401 logged failures in six days.
function atomFeedXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Chipmakers Post Record Quarter</title>
    <guid isPermaLink="false">tag:example.com,2026:1</guid>
    <link href="https://example.com/a" />
    <published>2026-07-25T10:00:00Z</published>
    <summary type="html">&lt;p&gt;An extended plain-English account of the quarter's results, with enough words to clear the language detector's minimum length.&lt;/p&gt;</summary>
  </entry>
</feed>`;
}

const feed: NewsFeed = {
  id: 'cnet',
  name: 'CNET',
  url: 'https://example.com/rss',
  category: 'tech',
} as NewsFeed;

function stubDb(saved: Record<string, unknown>[]) {
  return {
    getDoc: async () => undefined,
    setDoc: async (_c: unknown, doc: Record<string, unknown>) => {
      saved.push(doc);
    },
    getQuery: async () => [],
  } as never;
}

describe('Atom feeds whose fields carry attributes', () => {
  it('ingests an entry whose title/summary are {#text} nodes, not strings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(atomFeedXml())),
    );
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a: unknown[]) => errors.push(String(a[0])));

    const saved: Record<string, unknown>[] = [];
    await dispatchNewsFeedDownload(stubDb(saved), feed);

    spy.mockRestore();
    vi.unstubAllGlobals();

    expect(errors).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0]!['title']).toBe('Chipmakers Post Record Quarter');
    expect(String(saved[0]!['contentMarkdown'])).toContain(
      "account of the quarter's results",
    );
  });

  it('logs item failures with the detail inline, not as a dropped object arg', async () => {
    // A entry that survives parsing but breaks downstream: setDoc rejects.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(atomFeedXml())),
    );
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a: unknown[]) => errors.push(String(a[0])));

    const db = {
      getDoc: async () => undefined,
      setDoc: async () => {
        throw new Error('D1_ERROR: string or blob too big');
      },
      getQuery: async () => [],
    } as never;
    await dispatchNewsFeedDownload(db, feed);

    spy.mockRestore();
    vi.unstubAllGlobals();

    expect(errors).toHaveLength(1);
    // The message itself must carry feed, link and error — telemetry keeps
    // nothing else.
    expect(errors[0]).toContain('[cnet]');
    expect(errors[0]).toContain('https://example.com/a');
    expect(errors[0]).toContain('D1_ERROR: string or blob too big');
    expect(errors[0]).toContain('Error:');
  });
});
