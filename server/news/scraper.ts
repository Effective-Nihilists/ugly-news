import * as cheerio from 'cheerio';
import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsArticle } from '../../shared/collections';
import { isDefined, uglyBotId } from '../../shared/news/Bot';
import {
  newsCategoryImageStyles,
  newsFeeds,
  type NewsCategory,
} from '../../shared/news/types';
import { embed, genImage, genText, truncateToApproximateTokens } from './ai';
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
export async function generateBotComment(title: string, content: string): Promise<string | null> {
  const truncated = truncateToApproximateTokens(content, 1500);
  const comment = await genText(
    [
      { role: 'system', content: BOT_COMMENT_PROMPT },
      { role: 'user', content: `Title: ${title}\n\nArticle content:\n${truncated}` },
    ],
    { model: 'llama_4_scout', temperature: 0.7, maxTokens: 150 },
  );
  if (!comment) return null;
  const trimmed = comment.trim();
  return trimmed.length >= 20 && trimmed.length <= 500 ? trimmed : null;
}

// ── Crawlbase fetch (Workers-safe: global fetch + env token) ─────────────────

const SCRAPE_TIMEOUT_MS = 10_000;
const CRAWLBASE_BASE_URL = 'https://api.crawlbase.com/';

async function crawlbaseFetch(url: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/dot-notation
  const apiKey = process.env['CRAWLBASE_API_KEY'];
  if (!isDefined(apiKey)) {
    console.warn('[scrape] CRAWLBASE_API_KEY not set — falling back to direct fetch');
  }
  const target = apiKey
    ? `${CRAWLBASE_BASE_URL}?${new URLSearchParams({ token: apiKey, url, country: 'US' }).toString()}`
    : url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; UglyNews/1.0; +https://ugly.press)' },
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
    const selectors = ['article', '[role="article"]', '.article-content', '.post-content', '.entry-content', 'main'];
    for (const selector of selectors) {
      const el = $(selector);
      if (el.length > 0) {
        el.find('script, style, nav, header, footer, aside, .ads, .comments, .social-share').remove();
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
    $('script, style, nav, header, footer, aside, form, iframe, noscript, .ads, .comments, .social-share, .sidebar, .menu, .navigation').remove();
    const body = $('body').text();
    if (!body) return null;
    const normalized = body.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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

export async function detectIfAdvertisement(title: string, content: string): Promise<boolean> {
  const truncated = truncateToApproximateTokens(content, 1500);
  const out = await genText(
    [
      { role: 'system', content: AD_DETECTION_PROMPT },
      { role: 'user', content: `Title: ${title}\n\nContent:\n${truncated}` },
    ],
    { model: AI_MODEL, temperature: 0.1, maxTokens: 10 },
  );
  return (out ?? '').trim().toUpperCase().includes('AD') && !(out ?? '').toUpperCase().includes('ARTICLE');
}

export async function generateArticleSummary(title: string, content: string): Promise<string | null> {
  const truncated = truncateToApproximateTokens(content, 3000);
  const summary = await genText(
    [
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: `Title: ${title}\n\nSource article:\n${truncated}` },
    ],
    { model: AI_MODEL, temperature: 0.4, maxTokens: 1000 },
  );
  if (!summary) return null;
  return summary.length > 2500 ? summary.slice(0, 2500) : summary;
}

async function generateArticleImage(title: string, category: NewsCategory, feedId: string): Promise<string | null> {
  const feed = newsFeeds.find((f) => f.id === feedId);
  const style = feed?.imageStyle ?? newsCategoryImageStyles[category];
  const parts = [
    `News article illustration for "${title}".`,
    'Do not include any text, words, letters, or numbers.',
    style.style,
    style.photographyStyle,
    style.colorPalette ? `Color palette: ${style.colorPalette}.` : '',
    style.mood ? `Mood: ${style.mood}.` : '',
    style.additionalKeywords ?? '',
  ].filter(Boolean);
  const negative = ['text, words, letters, watermark, low quality, cartoon, anime', style.negativePrompt ?? '']
    .filter(Boolean)
    .join(', ');
  return genImage(parts.join(' '), { model: 'flux_1_dev', negative });
}

// ── Main dispatch ──────────────────────────────────────────────────────────

/** Scrape + summarize + image one article, then create its FileMarkdown.
 * The bot-comment conversation is created separately in Phase 3 wiring. */
export async function dispatchArticleScrape(db: NewsDb, articleId: string): Promise<void> {
  const article = await db.getDoc(collections.newsArticle, articleId);
  if (!isDefined(article)) return;
  if (article.fileId) return; // already processed

  const now = Date.now();
  const category = (article.categories[0] ?? 'news') as NewsCategory;

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
  const summary = (await generateArticleSummary(article.title, content)) ?? content;
  const feedName = newsFeeds.find((f) => f.id === article.feedId)?.name ?? article.feedId;
  const markdown = [
    summary,
    '',
    article.uri ? `[Read the original](${article.uri})` : '',
    `*Summary generated by AI. Original content © ${feedName}.*`,
  ].join('\n');

  // Image: prefer RSS image, else generate one.
  let imageUri = article.imageUri;
  if (!imageUri) imageUri = await generateArticleImage(article.title, category, article.feedId);

  // Embedding for feed ranking / search.
  const embedding = await embed(`${article.title}\n\n${summary}`);

  const fileId = `file_${article._id}`;
  const file: FileMarkdown = {
    _id: fileId,
    type: 'markdown',
    userId: uglyBotId,
    markdown,
    title: article.title,
    text: summary.slice(0, 500),
    thumbnail: imageUri ? { type: 'public', uri: imageUri, width: 1280, height: 720 } : null,
    tags: [category],
    uris: article.uri ? [article.uri] : undefined,
    sourceUri: article.uri,
    feedId: article.feedId,
    category,
    public: true,
    indexable: true,
    indexed: isDefined(embedding),
    embedding: embedding ?? null,
    likeCount: 0,
    dislikeCount: 0,
    viewCount: 0,
    conversationId: fileId,
    ...dbDefaults(),
    created: article.created,
  };
  await db.setDoc(collections.file, file, { skipIfExists: true });

  await db.setDoc(collections.newsArticle, {
    ...article,
    fileId,
    summary,
    summaryGeneratedAt: now,
    scrapeStatus: 'success',
    scrapedAt: now,
    updated: new Date(now),
  } satisfies NewsArticle);

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
