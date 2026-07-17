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
  'politics' | 'world' | 'business' | 'tech' | 'science' | 'events';

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
    photographyStyle:
      'mid-century screen-print, heavy linework, halftone grain',
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
  {
    id: 'npr_politics',
    name: 'NPR Politics',
    url: 'https://feeds.npr.org/1014/rss.xml',
    category: 'politics',
  },
  {
    id: 'thehill',
    name: 'The Hill',
    url: 'https://thehill.com/homenews/feed/',
    category: 'politics',
  },
  // Left (Politico + MSNBC dropped RSS / 403; NBC News + The Nation verified live)
  {
    id: 'guardian_us',
    name: 'The Guardian (US Politics)',
    url: 'https://www.theguardian.com/us-news/us-politics/rss',
    category: 'politics',
  },
  {
    id: 'vox',
    name: 'Vox',
    url: 'https://www.vox.com/rss/index.xml',
    category: 'politics',
  },
  {
    id: 'huffpost_politics',
    name: 'HuffPost Politics',
    url: 'https://www.huffpost.com/section/politics/feed',
    category: 'politics',
  },
  {
    id: 'nbcnews',
    name: 'NBC News',
    url: 'https://feeds.nbcnews.com/nbcnews/public/news',
    category: 'politics',
  },
  {
    id: 'thenation',
    name: 'The Nation',
    url: 'https://www.thenation.com/feed/?post_type=article',
    category: 'politics',
  },
  // Right
  {
    id: 'foxnews_politics',
    name: 'Fox News Politics',
    url: 'https://moxie.foxnews.com/google-publisher/politics.xml',
    category: 'politics',
  },
  {
    id: 'nypost',
    name: 'New York Post',
    url: 'https://nypost.com/politics/feed/',
    category: 'politics',
  },
  {
    id: 'nationalreview',
    name: 'National Review',
    url: 'https://www.nationalreview.com/feed/',
    category: 'politics',
  },
  {
    id: 'dailywire',
    name: 'The Daily Wire',
    url: 'https://www.dailywire.com/feeds/rss.xml',
    category: 'politics',
  },
  {
    id: 'washingtonexaminer',
    name: 'Washington Examiner',
    url: 'https://www.washingtonexaminer.com/feed',
    category: 'politics',
  },

  // ─── WORLD ────────────────────────────────────────────────────────────────
  {
    id: 'bbc_world',
    name: 'BBC World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'world',
  },
  {
    id: 'nyt_world',
    name: 'New York Times (World)',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    category: 'world',
  },
  {
    id: 'guardian_world',
    name: 'The Guardian (World)',
    url: 'https://www.theguardian.com/world/rss',
    category: 'world',
  },
  {
    id: 'aljazeera',
    name: 'Al Jazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    category: 'world',
  },
  {
    id: 'dw_world',
    name: 'Deutsche Welle',
    url: 'https://rss.dw.com/rdf/rss-en-world',
    category: 'world',
  },

  // ─── BUSINESS ─────────────────────────────────────────────────────────────
  {
    id: 'cnbc',
    name: 'CNBC',
    url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    category: 'business',
  },
  {
    id: 'marketwatch',
    name: 'MarketWatch',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    category: 'business',
  },
  {
    id: 'fortune',
    name: 'Fortune',
    url: 'https://fortune.com/feed/',
    category: 'business',
  },
  {
    id: 'forbes_business',
    name: 'Forbes (Business)',
    url: 'https://www.forbes.com/business/feed/',
    category: 'business',
  },

  // ─── TECH ─────────────────────────────────────────────────────────────────
  {
    id: 'techcrunch',
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    category: 'tech',
  },
  {
    id: 'theverge',
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'tech',
  },
  {
    id: 'arstechnica',
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'tech',
  },
  {
    id: 'wired',
    name: 'Wired',
    url: 'https://www.wired.com/feed/rss',
    category: 'tech',
  },
  {
    id: 'engadget',
    name: 'Engadget',
    url: 'https://www.engadget.com/rss.xml',
    category: 'tech',
  },

  // ─── SCIENCE ──────────────────────────────────────────────────────────────
  {
    id: 'sciencedaily',
    name: 'ScienceDaily',
    url: 'https://www.sciencedaily.com/rss/all.xml',
    category: 'science',
  },
  {
    id: 'physorg',
    name: 'Phys.org',
    url: 'https://phys.org/rss-feed/',
    category: 'science',
  },
  {
    id: 'arstechnica_science',
    name: 'Ars Technica (Science)',
    url: 'https://feeds.arstechnica.com/arstechnica/science',
    category: 'science',
  },
  {
    id: 'scientificamerican',
    name: 'Scientific American',
    url: 'http://rss.sciam.com/ScientificAmerican-Global',
    category: 'science',
  },

  // ─── EVENTS (culture / sports / entertainment happenings) ─────────────────
  {
    id: 'variety',
    name: 'Variety',
    url: 'https://variety.com/feed/',
    category: 'events',
  },
  {
    id: 'hollywoodreporter',
    name: 'The Hollywood Reporter',
    url: 'https://www.hollywoodreporter.com/feed/',
    category: 'events',
  },
  {
    id: 'rollingstone',
    name: 'Rolling Stone',
    url: 'https://www.rollingstone.com/feed/',
    category: 'events',
  },
  {
    id: 'pitchfork',
    name: 'Pitchfork',
    url: 'https://pitchfork.com/rss/news/',
    category: 'events',
  },
  {
    id: 'espn',
    name: 'ESPN',
    url: 'https://www.espn.com/espn/rss/news',
    category: 'events',
  },

  // ─── EXPANSION 2026-06-30 (all verified live) — density for cross-spectrum
  //     clustering. Politics gets the biggest L/C/R boost. ────────────────────
  // Politics — Center
  {
    id: 'pbs',
    name: 'PBS NewsHour',
    url: 'https://www.pbs.org/newshour/feeds/rss/headlines',
    category: 'politics',
  },
  {
    id: 'csmonitor',
    name: 'Christian Science Monitor',
    url: 'https://rss.csmonitor.com/feeds/all',
    category: 'politics',
  },
  {
    id: 'newsweek',
    name: 'Newsweek',
    url: 'https://www.newsweek.com/rss',
    category: 'politics',
  },
  // Politics — Left
  {
    id: 'abcnews',
    name: 'ABC News',
    url: 'https://abcnews.go.com/abcnews/topstories',
    category: 'politics',
  },
  {
    id: 'cbsnews',
    name: 'CBS News',
    url: 'https://www.cbsnews.com/latest/rss/main',
    category: 'politics',
  },
  {
    id: 'theconversation',
    name: 'The Conversation',
    url: 'https://theconversation.com/us/articles.atom',
    category: 'politics',
  },
  {
    id: 'slate',
    name: 'Slate',
    url: 'https://slate.com/feeds/all.rss',
    category: 'politics',
  },
  {
    id: 'motherjones',
    name: 'Mother Jones',
    url: 'https://www.motherjones.com/feed/',
    category: 'politics',
  },
  {
    id: 'salon',
    name: 'Salon',
    url: 'https://www.salon.com/feed/',
    category: 'politics',
  },
  {
    id: 'intercept',
    name: 'The Intercept',
    url: 'https://theintercept.com/feed/?rss',
    category: 'politics',
  },
  {
    id: 'commondreams',
    name: 'Common Dreams',
    url: 'https://www.commondreams.org/rss.xml',
    category: 'politics',
  },
  {
    id: 'newrepublic',
    name: 'The New Republic',
    url: 'https://newrepublic.com/rss.xml',
    category: 'politics',
  },
  // Politics — Right
  {
    id: 'washingtontimes',
    name: 'The Washington Times',
    url: 'https://www.washingtontimes.com/rss/headlines/news/',
    category: 'politics',
  },
  {
    id: 'breitbart',
    name: 'Breitbart',
    url: 'https://feeds.feedburner.com/breitbart',
    category: 'politics',
  },
  {
    id: 'federalist',
    name: 'The Federalist',
    url: 'https://thefederalist.com/feed/',
    category: 'politics',
  },
  {
    id: 'reason',
    name: 'Reason',
    url: 'https://reason.com/latest/feed/',
    category: 'politics',
  },
  {
    id: 'dailycaller',
    name: 'The Daily Caller',
    url: 'https://dailycaller.com/feed/',
    category: 'politics',
  },
  {
    id: 'freebeacon',
    name: 'Washington Free Beacon',
    url: 'https://freebeacon.com/feed/',
    category: 'politics',
  },
  // World
  {
    id: 'france24',
    name: 'France 24',
    url: 'https://www.france24.com/en/rss',
    category: 'world',
  },
  {
    id: 'cnn_world',
    name: 'CNN (World)',
    url: 'http://rss.cnn.com/rss/edition_world.rss',
    category: 'world',
  },
  {
    id: 'skynews_world',
    name: 'Sky News (World)',
    url: 'https://feeds.skynews.com/feeds/rss/world.xml',
    category: 'world',
  },
  {
    id: 'independent_world',
    name: 'The Independent (World)',
    url: 'https://www.independent.co.uk/news/world/rss',
    category: 'world',
  },
  // Business
  {
    id: 'businessinsider',
    name: 'Business Insider',
    url: 'https://www.businessinsider.com/rss',
    category: 'business',
  },
  {
    id: 'yahoofinance',
    name: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/news/rssindex',
    category: 'business',
  },
  // Tech
  {
    id: 'theregister',
    name: 'The Register',
    url: 'https://www.theregister.com/headlines.atom',
    category: 'tech',
  },
  {
    id: 'venturebeat',
    name: 'VentureBeat',
    url: 'https://venturebeat.com/feed/',
    category: 'tech',
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    url: 'https://hnrss.org/frontpage',
    category: 'tech',
  },
  {
    id: '404media',
    name: '404 Media',
    url: 'https://www.404media.co/rss/',
    category: 'tech',
  },
  // Science
  {
    id: 'nature',
    name: 'Nature',
    url: 'http://feeds.nature.com/nature/rss/current',
    category: 'science',
  },
  {
    id: 'quanta',
    name: 'Quanta Magazine',
    url: 'https://api.quantamagazine.org/feed/',
    category: 'science',
  },
  {
    id: 'space',
    name: 'Space.com',
    url: 'https://www.space.com/feeds/all',
    category: 'science',
  },
  // Events
  {
    id: 'deadline',
    name: 'Deadline',
    url: 'https://deadline.com/feed/',
    category: 'events',
  },
  {
    id: 'avclub',
    name: 'The A.V. Club',
    url: 'https://www.avclub.com/rss',
    category: 'events',
  },
  {
    id: 'ign',
    name: 'IGN',
    url: 'https://feeds.ign.com/ign/all',
    category: 'events',
  },
  {
    id: 'stereogum',
    name: 'Stereogum',
    url: 'https://www.stereogum.com/feed/',
    category: 'events',
  },

  // ─── EXPANSION 2026-07-01 (mined from the IDIAP MBFC list, ranked by Majestic
  //     popularity, high-factuality, verified-live RSS). Strengthens the right. ─
  // Politics
  {
    id: 'time',
    name: 'Time',
    url: 'https://time.com/feed/',
    category: 'politics',
  },
  {
    id: 'latimes',
    name: 'Los Angeles Times',
    url: 'https://www.latimes.com/rss2.0.xml',
    category: 'politics',
  },
  {
    id: 'theatlantic',
    name: 'The Atlantic',
    url: 'https://www.theatlantic.com/feed/all/',
    category: 'politics',
  },
  {
    id: 'newyorker',
    name: 'The New Yorker',
    url: 'https://www.newyorker.com/feed/news',
    category: 'politics',
  },
  {
    id: 'axios',
    name: 'Axios',
    url: 'https://api.axios.com/feed/',
    category: 'politics',
  },
  {
    id: 'globeandmail',
    name: 'The Globe and Mail',
    url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/politics/',
    category: 'politics',
  },
  // World
  {
    id: 'abc_au',
    name: 'ABC News (Australia)',
    url: 'https://www.abc.net.au/news/feed/51120/rss.xml',
    category: 'world',
  },
  {
    id: 'wsj',
    name: 'The Wall Street Journal',
    url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',
    category: 'world',
  },
  {
    id: 'telegraph',
    name: 'The Telegraph',
    url: 'https://www.telegraph.co.uk/rss.xml',
    category: 'world',
  },
  {
    id: 'jpost',
    name: 'The Jerusalem Post',
    url: 'https://www.jpost.com/rss/rssfeedsheadlines.aspx',
    category: 'world',
  },
  {
    id: 'standard_uk',
    name: 'Evening Standard',
    url: 'https://www.standard.co.uk/rss',
    category: 'world',
  },
  // Business
  {
    id: 'bloomberg',
    name: 'Bloomberg',
    url: 'https://feeds.bloomberg.com/markets/news.rss',
    category: 'business',
  },
  {
    id: 'ft',
    name: 'Financial Times',
    url: 'https://www.ft.com/rss/home',
    category: 'business',
  },
  // Tech
  {
    id: 'cnet',
    name: 'CNET',
    url: 'https://www.cnet.com/rss/news/',
    category: 'tech',
  },

  // NOTE: Google News RSS + GDELT were both removed (Google News = CBM-encoded
  // redirect URLs the scraper can't resolve; GDELT = intermittent 522 origin
  // timeouts + 1-req/5s rate limit, verified from the Worker). Breadth now comes
  // entirely from the direct outlet feeds above (English-filtered at ingest).
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
