import * as cheerio from 'cheerio';
import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsArticle } from '../../shared/collections';
import { isDefined, uglyBotId } from '../../shared/news/Bot';
import { newsFeeds, type NewsCategory } from '../../shared/news/types';
import { embed, genText, truncateToApproximateTokens } from './ai';
import { assignFileToCluster } from './cluster';
import type { NewsDb } from './db';
import { htmlToMarkdown } from './download';

const AI_MODEL = 'deepseek_v4_flash';

const AD_DETECTION_PROMPT = `Analyze this content and determine if it is primarily an ADVERTISEMENT or SPONSORED CONTENT rather than genuine journalism. Respond with ONLY one word: "AD" or "ARTICLE".`;

const SUMMARY_PROMPT = `Rewrite this article as a complete news article in your own words.
- Write as a journalist reporting the story directly (not "this article discusses...").
- Active voice, 3-5 paragraphs, lead with the most newsworthy facts.
- Preserve all facts, names, numbers, and quotes exactly.
- Use markdown: **bold** key terms, > blockquotes for quotes, lists where useful.`;

const BOT_COMMENT_PROMPT = `You are Ugly Bot, a brutally honest and sardonic AI commentator. Write a 1-2 sentence opening comment for a news article discussion thread that makes an insightful observation (not a summary), points out an angle or irony readers might miss, and invites discussion without being generic. Output only the comment text, no quotes.`;

/** Generate the newsBot's opening comment for an article (or null). */
export async function generateBotComment(
  title: string,
  content: string,
): Promise<string | null> {
  const truncated = truncateToApproximateTokens(content, 1500);
  const comment = await genText(
    [
      { role: 'system', content: BOT_COMMENT_PROMPT },
      {
        role: 'user',
        content: `Title: ${title}\n\nArticle content:\n${truncated}`,
      },
    ],
    { model: 'llama_4_scout', temperature: 0.7, maxTokens: 150 },
  );
  if (!comment) return null;
  const trimmed = comment.trim();
  return trimmed.length >= 20 && trimmed.length <= 500 ? trimmed : null;
}

// ── Article fetch (Workers-safe: direct global fetch) ────────────────────────
// Crawlbase was removed — articles are fetched directly. Only Cloudflare,
// Neon/Postgres, and ugly.bot are permitted external connections.

const SCRAPE_TIMEOUT_MS = 10_000;

async function crawlbaseFetch(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; UglyNews/1.0; +https://ugly.press)',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Cheerio extraction (Workers-safe — no jsdom/Readability) ─────────────────

function extractWithArticleTag(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    const selectors = [
      'article',
      '[role="article"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      'main',
    ];
    for (const selector of selectors) {
      const el = $(selector);
      if (el.length > 0) {
        el.find(
          'script, style, nav, header, footer, aside, .ads, .comments, .social-share',
        ).remove();
        const inner = el.html();
        if (inner) {
          const md = htmlToMarkdown(inner);
          if (md.length > 200) return md;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractBodyText(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    $(
      'script, style, nav, header, footer, aside, form, iframe, noscript, .ads, .comments, .social-share, .sidebar, .menu, .navigation',
    ).remove();
    const body = $('body').text();
    if (!body) return null;
    const normalized = body
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return normalized.length > 200 ? normalized : null;
  } catch {
    return null;
  }
}

export async function extractArticle(url: string): Promise<string | null> {
  const html = await crawlbaseFetch(url);
  if (!html) return null;
  return extractWithArticleTag(html) ?? extractBodyText(html);
}

// ── AI processing ────────────────────────────────────────────────────────

export async function detectIfAdvertisement(
  title: string,
  content: string,
): Promise<boolean> {
  const truncated = truncateToApproximateTokens(content, 1500);
  const out = await genText(
    [
      { role: 'system', content: AD_DETECTION_PROMPT },
      { role: 'user', content: `Title: ${title}\n\nContent:\n${truncated}` },
    ],
    { model: AI_MODEL, temperature: 0.1, maxTokens: 10 },
  );
  return (
    (out ?? '').trim().toUpperCase().includes('AD') &&
    !(out ?? '').toUpperCase().includes('ARTICLE')
  );
}

export async function generateArticleSummary(
  title: string,
  content: string,
): Promise<string | null> {
  const truncated = truncateToApproximateTokens(content, 3000);
  const summary = await genText(
    [
      { role: 'system', content: SUMMARY_PROMPT },
      {
        role: 'user',
        content: `Title: ${title}\n\nSource article:\n${truncated}`,
      },
    ],
    { model: AI_MODEL, temperature: 0.4, maxTokens: 1000 },
  );
  if (!summary) return null;
  return summary.length > 2500 ? summary.slice(0, 2500) : summary;
}

// ── Main dispatch ──────────────────────────────────────────────────────────

/** Scrape + summarize + image one article, then create its FileMarkdown.
 * The bot-comment conversation is created separately in Phase 3 wiring. */
export async function dispatchArticleScrape(
  db: NewsDb,
  articleId: string,
): Promise<void> {
  const article = await db.getDoc(collections.newsArticle, articleId);
  if (!isDefined(article)) return;
  if (article.fileId) return; // already processed

  const now = Date.now();
  const category = (article.categories[0] ?? 'world') as NewsCategory;

  // Extract full content (fallback to RSS-provided markdown).
  let content = article.contentMarkdown;
  if (article.uri) {
    const extracted = await extractArticle(article.uri);
    if (extracted && extracted.length > content.length) content = extracted;
  }

  // Ad gate.
  if (await detectIfAdvertisement(article.title, content)) {
    await db.setDoc(collections.newsArticle, {
      ...article,
      scrapeStatus: 'ad',
      scrapedAt: now,
      updated: new Date(now),
    } satisfies NewsArticle);
    return;
  }

  // AI summary (fallback to extracted content).
  const summary =
    (await generateArticleSummary(article.title, content)) ?? content;
  const feedName =
    newsFeeds.find((f) => f.id === article.feedId)?.name ?? article.feedId;
  const markdown = [
    summary,
    '',
    article.uri ? `[Read the original](${article.uri})` : '',
    `*Summary generated by AI. Original content © ${feedName}.*`,
  ].join('\n');

  // Image: use the RSS-provided image only. Generated "Ugly Press" art is no
  // longer minted per article (almost none were ever shown) — it's backfilled
  // once per qualifying story cluster in dispatchClusterSynthesize. Articles
  // without an RSS image render the client's hatch-pattern fallback.
  const imageUri = article.imageUri;

  // Embedding for feed ranking / search.
  const embedding = await embed(`${article.title}\n\n${summary}`);

  const fileId = `file_${article._id}`;
  const file: FileMarkdown = {
    _id: fileId,
    type: 'markdown',
    kind: 'article',
    userId: uglyBotId,
    markdown,
    title: article.title,
    text: summary.slice(0, 500),
    thumbnail: imageUri
      ? { type: 'public', uri: imageUri, width: 1280, height: 720 }
      : null,
    tags: [category],
    uris: article.uri ? [article.uri] : undefined,
    sourceUri: article.uri,
    feedId: article.feedId,
    category,
    public: true,
    indexable: true,
    indexed: isDefined(embedding),
    embedded: isDefined(embedding),
    likeCount: 0,
    dislikeCount: 0,
    viewCount: 0,
    conversationId: fileId,
    ...dbDefaults(),
    created: article.created,
  };
  // The 512-dim embedding rides OUT-OF-BAND to Cloudflare Vectorize (keyed by
  // _id) via the `vec` option — never in the doc JSON. `skipIfExists` keeps the
  // insert idempotent; the vector is written with the first insert.
  await db.setDoc(collections.file, file, {
    skipIfExists: true,
    ...(isDefined(embedding) ? { vec: embedding } : {}),
  });

  await db.setDoc(collections.newsArticle, {
    ...article,
    fileId,
    summary,
    summaryGeneratedAt: now,
    scrapeStatus: 'success',
    scrapedAt: now,
    updated: new Date(now),
  } satisfies NewsArticle);

  // Assign to a story cluster ("same story, many outlets") for The Spread /
  // Blindspot / Ugly Take. Needs the embedding (stripped from the file's JSON),
  // so pass it directly. Best-effort — clustering must never break the scrape.
  if (isDefined(embedding)) {
    try {
      await assignFileToCluster(db, file, embedding, article.feedId, now);
    } catch (error) {
      console.warn('[scrape] cluster assignment failed', error);
    }
  }

  // newsBot opening comment → conversation thread (id === fileId), best-effort.
  try {
    const comment = await generateBotComment(article.title, summary);
    if (comment) {
      await db.setDoc(
        collections.conversation,
        { _id: fileId, type: 'news', title: article.title, ...dbDefaults() },
        { skipIfExists: true },
      );
      await db.setDoc(collections.message, {
        _id: `msg_${fileId}_0`,
        conversationId: fileId,
        userId: uglyBotId,
        text: comment,
        ...dbDefaults(),
      });
    }
  } catch (error) {
    console.warn('[scrape] bot comment failed', error);
  }
}
