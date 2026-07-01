import type { InferDocType } from 'ugly-app/shared';
import type { FileMarkdown, FileReactionT } from './FileMarkdown';
import {
  NewsArticleSchema,
  NewsFeedDocSchema,
  UserNewsPreferenceSchema,
  UserNewsReactionSchema,
  UserNewsReadSchema,
  UserNewsSavedSchema,
  UserNewsSourceFollowSchema,
} from './schemas';

export type { FileReactionT };

export type NewsFeedDoc = InferDocType<typeof NewsFeedDocSchema>;

// News desks. Lifestyle/evergreen desks (fashion, food, home, health, auto,
// etc.) were dropped in the "Three Ways" rewrite — the product focuses on news
// that clusters and debates across outlets: politics, world, business, tech,
// science, and current-events/culture happenings.
export type NewsCategory =
  | 'politics'
  | 'world'
  | 'business'
  | 'tech'
  | 'science'
  | 'events';

export const newsCategories: NewsCategory[] = [
  'politics',
  'world',
  'business',
  'tech',
  'science',
  'events',
];

// Scrape status for article content extraction
export type ScrapeStatus = 'pending' | 'success' | 'failed' | 'skipped' | 'ad';

// id is articleId
export type NewsArticle = InferDocType<typeof NewsArticleSchema>;

/**
 * Image generation style configuration for a news source.
 * Used when generating AI images for articles that don't have RSS images.
 */
export interface NewsImageStyle {
  /** Primary visual style descriptor (e.g., "sleek minimalist tech aesthetic") */
  style: string;
  /** Color palette keywords (e.g., "cool blues, silver, dark backgrounds") */
  colorPalette?: string;
  /** Photography/art style (e.g., "editorial photography", "digital illustration") */
  photographyStyle?: string;
  /** Mood/atmosphere (e.g., "professional", "edgy", "moody") */
  mood?: string;
  /** Additional keywords to append to prompt */
  additionalKeywords?: string;
  /** Negative prompt additions specific to this source */
  negativePrompt?: string;
}

export interface NewsFeed {
  id: string;
  name: string;
  url: string;
  category: NewsCategory;
  /** Optional source-specific image generation style */
  imageStyle?: NewsImageStyle;
}

/**
 * Default image styles per category, used when a source doesn't have a custom style.
 */
export const newsCategoryImageStyles: Record<NewsCategory, NewsImageStyle> = {
  politics: {
    style: 'editorial political illustration',
    colorPalette: 'newsprint cream, deep ink black, single vermilion accent',
    photographyStyle: 'mid-century screen-print, heavy linework, halftone grain',
    mood: 'wry, pointed, editorial',
  },
  world: {
    style: 'global affairs editorial illustration',
    colorPalette: 'newsprint cream, ink black, muted vermilion',
    photographyStyle: 'woodcut / risograph map-and-figure motifs, halftone',
    mood: 'serious, documentary, worldly',
  },
  business: {
    style: 'markets and economy editorial illustration',
    colorPalette: 'newsprint cream, ink black, vermilion accent',
    photographyStyle: 'flat-shape infographic motifs, ledger lines, halftone',
    mood: 'dry, analytical, a little ominous',
  },
  tech: {
    style: 'technology editorial illustration',
    colorPalette: 'newsprint cream, ink black, vermilion accent',
    photographyStyle: 'screen-print circuitry and device motifs, halftone',
    mood: 'sharp, modern, skeptical',
  },
  science: {
    style: 'science editorial illustration',
    colorPalette: 'newsprint cream, ink black, vermilion accent',
    photographyStyle: 'vintage scientific-diagram engraving, halftone grain',
    mood: 'curious, precise, wondrous',
  },
  events: {
    style: 'culture and current-events editorial illustration',
    colorPalette: 'newsprint cream, ink black, bold vermilion',
    photographyStyle: 'gig-poster screen-print energy, heavy ink, halftone',
    mood: 'lively, irreverent, of-the-moment',
  },
};

export const newsFeeds: NewsFeed[] = [
  // ─── POLITICS (curated Left / Center / Right so the bias bar has spread) ──
  // Center
  { id: 'npr_politics', name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml', category: 'politics' },
  { id: 'thehill', name: 'The Hill', url: 'https://thehill.com/homenews/feed/', category: 'politics' },
  // Left (Politico + MSNBC dropped RSS / 403; NBC News + The Nation verified live)
  { id: 'guardian_us', name: 'The Guardian (US Politics)', url: 'https://www.theguardian.com/us-news/us-politics/rss', category: 'politics' },
  { id: 'vox', name: 'Vox', url: 'https://www.vox.com/rss/index.xml', category: 'politics' },
  { id: 'huffpost_politics', name: 'HuffPost Politics', url: 'https://www.huffpost.com/section/politics/feed', category: 'politics' },
  { id: 'nbcnews', name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news', category: 'politics' },
  { id: 'thenation', name: 'The Nation', url: 'https://www.thenation.com/feed/?post_type=article', category: 'politics' },
  // Right
  { id: 'foxnews_politics', name: 'Fox News Politics', url: 'https://moxie.foxnews.com/google-publisher/politics.xml', category: 'politics' },
  { id: 'nypost', name: 'New York Post', url: 'https://nypost.com/politics/feed/', category: 'politics' },
  { id: 'nationalreview', name: 'National Review', url: 'https://www.nationalreview.com/feed/', category: 'politics' },
  { id: 'dailywire', name: 'The Daily Wire', url: 'https://www.dailywire.com/feeds/rss.xml', category: 'politics' },
  { id: 'washingtonexaminer', name: 'Washington Examiner', url: 'https://www.washingtonexaminer.com/feed', category: 'politics' },

  // ─── WORLD ────────────────────────────────────────────────────────────────
  { id: 'bbc_world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'world' },
  { id: 'nyt_world', name: 'New York Times (World)', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', category: 'world' },
  { id: 'guardian_world', name: 'The Guardian (World)', url: 'https://www.theguardian.com/world/rss', category: 'world' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world' },
  { id: 'dw_world', name: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-world', category: 'world' },

  // ─── BUSINESS ─────────────────────────────────────────────────────────────
  { id: 'cnbc', name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'business' },
  { id: 'marketwatch', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'business' },
  { id: 'fortune', name: 'Fortune', url: 'https://fortune.com/feed/', category: 'business' },
  { id: 'forbes_business', name: 'Forbes (Business)', url: 'https://www.forbes.com/business/feed/', category: 'business' },

  // ─── TECH ─────────────────────────────────────────────────────────────────
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'tech' },
  { id: 'theverge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech' },
  { id: 'arstechnica', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech' },
  { id: 'wired', name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'tech' },
  { id: 'engadget', name: 'Engadget', url: 'https://www.engadget.com/rss.xml', category: 'tech' },

  // ─── SCIENCE ──────────────────────────────────────────────────────────────
  { id: 'sciencedaily', name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/all.xml', category: 'science' },
  { id: 'physorg', name: 'Phys.org', url: 'https://phys.org/rss-feed/', category: 'science' },
  { id: 'arstechnica_science', name: 'Ars Technica (Science)', url: 'https://feeds.arstechnica.com/arstechnica/science', category: 'science' },
  { id: 'scientificamerican', name: 'Scientific American', url: 'http://rss.sciam.com/ScientificAmerican-Global', category: 'science' },

  // ─── EVENTS (culture / sports / entertainment happenings) ─────────────────
  { id: 'variety', name: 'Variety', url: 'https://variety.com/feed/', category: 'events' },
  { id: 'hollywoodreporter', name: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com/feed/', category: 'events' },
  { id: 'rollingstone', name: 'Rolling Stone', url: 'https://www.rollingstone.com/feed/', category: 'events' },
  { id: 'pitchfork', name: 'Pitchfork', url: 'https://pitchfork.com/rss/news/', category: 'events' },
  { id: 'espn', name: 'ESPN', url: 'https://www.espn.com/espn/rss/news', category: 'events' },

  // ─── GOOGLE NEWS (free, unlimited breadth/backfill; mixed-source aggregator,
  // so items are "unrated" for bias and don't skew the coverage bar). ────────
  { id: 'googlenews_world', name: 'Google News — World', url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en', category: 'world' },
  { id: 'googlenews_business', name: 'Google News — Business', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en', category: 'business' },
  { id: 'googlenews_tech', name: 'Google News — Technology', url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en', category: 'tech' },
  { id: 'googlenews_science', name: 'Google News — Science', url: 'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en', category: 'science' },
  { id: 'googlenews_entertainment', name: 'Google News — Entertainment', url: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en', category: 'events' },
];

// ============================================================================
// User News Tracking - Read/Saved articles
// ============================================================================

// Tracks which FileMarkdown articles a user has read
// ID format: `${userId}_${fileId}`
export type UserNewsRead = InferDocType<typeof UserNewsReadSchema>;

// Tracks which FileMarkdown articles a user has saved/bookmarked
// ID format: `${userId}_${fileId}`
export type UserNewsSaved = InferDocType<typeof UserNewsSavedSchema>;

// Tracks user reactions to articles (like/dislike for personalization)
// ID format: `${userId}_${articleId}`
export type UserNewsReaction = InferDocType<typeof UserNewsReactionSchema>;

// User subscription to news sources (RSS feeds)
// ID format: `${userId}_${sourceId}`
export type UserNewsSourceFollow = InferDocType<
  typeof UserNewsSourceFollowSchema
>;

// User news preferences for embedding-based personalization
// ID format: `${userId}`
export type UserNewsPreference = InferDocType<typeof UserNewsPreferenceSchema>;

// ============================================================================
// News API Types
// ============================================================================

// --- Read Tracking ---
export interface NewsMarkReadInput {
  fileId: string;
}

export interface NewsMarkReadBulkInput {
  fileIds: string[];
}

export interface NewsMarkUnreadInput {
  fileId: string;
}

// --- Save/Bookmark ---
export interface NewsSaveInput {
  fileId: string;
  saved: boolean;
}

export interface NewsSavedGetInput {
  limit: number;
  beforeSavedAt?: number | undefined;
}

export interface NewsSavedGetOutput {
  items: string[]; // fileIds
  hasMore: boolean;
}

// --- Feed ---
export interface NewsFeedGetInput {
  limit: number;
}

export interface NewsFeedItem {
  file: FileMarkdown;
  saved: boolean;
  reaction: FileReactionT | null;
}

export interface NewsFeedGetOutput {
  items: NewsFeedItem[];
  hasMore: boolean;
}

// --- Search ---
export interface NewsSearchInput {
  query: string;
  limit: number;
  categories?: NewsCategory[] | undefined;
}

export interface NewsSearchOutput {
  items: string[]; // fileIds
}

// --- Check if saved ---
export interface NewsIsSavedInput {
  fileId: string;
}

export interface NewsIsSavedOutput {
  saved: boolean;
}

// --- Batch check saved ---
export interface NewsIsSavedBatchInput {
  fileIds: string[];
}

export interface NewsIsSavedBatchOutput {
  savedFileIds: string[];
}

// --- React (like/dislike) ---
export interface NewsReactInput {
  articleId: string;
  reaction: 'like' | 'dislike' | null; // null to remove reaction
}

export interface NewsReactOutput {
  reaction: UserNewsReaction | null;
}

// --- Source Following ---
export interface NewsSourceFollowInput {
  sourceId: string;
  follow: boolean;
}

export interface NewsSourceFollowOutput {
  followed: boolean;
}

export interface NewsSourceGetFollowedInput {}

export interface NewsSourceGetFollowedOutput {
  sources: {
    sourceId: string;
    category: NewsCategory;
    name: string;
  }[];
}

export type NewsResetInput = Record<string, never>;
export type NewsResetOutput = Record<string, never>;

// Function registry (authenticated)
export type NewsFunctionsT =
  | 'newsMarkRead'
  | 'newsMarkReadBulk'
  | 'newsMarkUnread'
  | 'newsReadGetAll'
  | 'newsReadResetAll'
  | 'newsSave'
  | 'newsSavedGet'
  | 'newsFeedGet'
  | 'newsSearch'
  | 'newsIsSaved'
  | 'newsIsSavedBatch'
  | 'newsReact'
  | 'newsSourceFollow'
  | 'newsSourceGetFollowed'
  | 'newsPodcastGet'
  | 'newsPodcastInit'
  | 'newsPodcastList'
  | 'newsPodcastRegenerate'
  | 'newsReset';

// Get all read article file IDs for the current user
export interface NewsReadGetAllOutput {
  fileIds: string[];
}

// Reset all read articles for the current user
export interface NewsReadResetAllOutput {
  deletedCount: number;
}
