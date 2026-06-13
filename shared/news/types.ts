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

export type NewsCategory =
  | 'fashion'
  | 'tech'
  | 'sports'
  | 'food'
  | 'music'
  | 'auto'
  | 'news'
  | 'home'
  | 'entertainment'
  | 'science'
  | 'gaming'
  | 'health';

export const newsCategories: NewsCategory[] = [
  'news',
  'sports',
  'tech',
  'auto',
  'fashion',
  'food',
  'music',
  'home',
  'entertainment',
  'science',
  'gaming',
  'health',
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
  tech: {
    style: 'sleek modern tech aesthetic',
    colorPalette: 'cool blues, silver, dark backgrounds',
    photographyStyle: 'product photography, clean studio lighting',
    mood: 'professional, innovative',
  },
  fashion: {
    style: 'high fashion editorial',
    colorPalette: 'bold contrasts, sophisticated neutrals',
    photographyStyle: 'fashion photography, dramatic lighting',
    mood: 'glamorous, artistic',
  },
  food: {
    style: 'appetizing food photography',
    colorPalette: 'warm tones, natural colors',
    photographyStyle: 'overhead shots, rustic styling, natural light',
    mood: 'cozy, inviting',
  },
  music: {
    style: 'concert and music culture aesthetic',
    colorPalette: 'vibrant stage colors, moody tones',
    photographyStyle: 'concert photography, artistic portraits',
    mood: 'energetic, expressive',
  },
  auto: {
    style: 'automotive photography',
    colorPalette: 'metallic tones, dramatic skies',
    photographyStyle: 'dynamic angles, motion blur, studio lighting',
    mood: 'powerful, sleek',
  },
  news: {
    style: 'classic journalistic photography',
    colorPalette: 'neutral tones, documentary style',
    photographyStyle: 'photojournalism, candid shots',
    mood: 'informative, objective',
  },
  sports: {
    style: 'dynamic sports photography',
    colorPalette: 'bold team colors, high contrast',
    photographyStyle: 'action shots, dramatic angles',
    mood: 'intense, competitive',
  },
  home: {
    style: 'interior design and lifestyle',
    colorPalette: 'warm neutrals, natural materials',
    photographyStyle: 'architectural photography, lifestyle shots',
    mood: 'welcoming, aspirational',
  },
  entertainment: {
    style: 'celebrity and entertainment photography',
    colorPalette: 'glamorous, red carpet colors',
    photographyStyle: 'portrait photography, event coverage',
    mood: 'exciting, star-studded',
  },
  science: {
    style: 'scientific illustration and documentary',
    colorPalette: 'clean whites, scientific blues, data visualization colors',
    photographyStyle: 'macro photography, lab environments, space imagery',
    mood: 'curious, educational',
  },
  gaming: {
    style: 'gaming and esports aesthetic',
    colorPalette: 'neon accents, dark backgrounds, RGB colors',
    photographyStyle: 'digital art style, dramatic lighting',
    mood: 'immersive, exciting',
  },
  health: {
    style: 'health and wellness lifestyle',
    colorPalette: 'calming greens, clean whites, soft blues',
    photographyStyle: 'lifestyle photography, clinical yet warm',
    mood: 'trustworthy, caring',
  },
};

export const newsFeeds: NewsFeed[] = [
  {
    id: 'thecurvyfashionista',
    name: 'thecurvyfashionista',
    url: 'https://thecurvyfashionista.com/feed/',
    category: 'fashion',
    imageStyle: {
      style: 'body-positive fashion editorial',
      colorPalette: 'vibrant, confident colors, inclusive tones',
      photographyStyle: 'lifestyle fashion photography, empowering poses',
      mood: 'confident, inclusive, celebratory',
    },
  },
  {
    id: 'fashionbombdaily',
    name: 'fashionbombdaily',
    url: 'https://fashionbombdaily.com/feed/',
    category: 'fashion',
    imageStyle: {
      style: 'celebrity and red carpet fashion',
      colorPalette: 'bold statement colors, luxe metallics',
      photographyStyle: 'paparazzi style, red carpet glamour',
      mood: 'glamorous, trendsetting, aspirational',
    },
  },
  {
    id: 'techcrunch',
    name: 'techcrunch',
    url: 'https://techcrunch.com/feed/',
    category: 'tech',
    imageStyle: {
      style: 'startup and venture capital aesthetic',
      colorPalette: 'TechCrunch green accents, modern blacks, clean whites',
      photographyStyle:
        'founder portraits, product shots, conference photography',
      mood: 'ambitious, disruptive, Silicon Valley energy',
    },
  },
  {
    id: 'theverge',
    name: 'theverge',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'tech',
    imageStyle: {
      style: 'bold tech editorial',
      colorPalette: 'Verge pink and magenta accents, dark backgrounds',
      photographyStyle:
        'artistic product photography, experimental compositions',
      mood: 'cutting-edge, opinionated, design-forward',
    },
  },
  {
    id: 'mashable',
    name: 'mashable',
    url: 'https://mashable.com/feeds/rss/all',
    category: 'tech',
    imageStyle: {
      style: 'social media and pop culture tech',
      colorPalette: 'bright blues, playful colors, internet culture palette',
      photographyStyle: 'viral content aesthetic, meme-friendly compositions',
      mood: 'fun, accessible, internet-savvy',
    },
  },
  {
    id: 'wired',
    name: 'wired',
    url: 'https://www.wired.com/feed/rss',
    category: 'tech',
    imageStyle: {
      style: 'futuristic tech journalism',
      colorPalette: 'electric blues, cyber greens, clean whites',
      photographyStyle: 'conceptual photography, data visualization aesthetic',
      mood: 'forward-thinking, intelligent, sci-fi influenced',
    },
  },
  {
    id: 'gizmodo',
    name: 'gizmodo',
    url: 'https://gizmodo.com/rss',
    category: 'tech',
    imageStyle: {
      style: 'gadget and consumer tech focus',
      colorPalette: 'tech blacks, accent oranges, clean whites',
      photographyStyle: 'product unboxing aesthetic, hands-on review style',
      mood: 'curious, skeptical, consumer-focused',
    },
  },
  {
    id: 'therecipecritic',
    name: 'therecipecritic',
    url: 'https://therecipecritic.com/feed/',
    category: 'food',
    imageStyle: {
      style: 'family-friendly comfort food',
      colorPalette: 'warm homestyle colors, kitchen neutrals',
      photographyStyle: 'close-up food shots, home kitchen setting',
      mood: 'comforting, approachable, homemade',
    },
  },
  {
    id: 'minimalistbaker',
    name: 'minimalistbaker',
    url: 'https://minimalistbaker.com/feed/',
    category: 'food',
    imageStyle: {
      style: 'clean minimalist food photography',
      colorPalette: 'muted earth tones, plant-based greens, natural whites',
      photographyStyle: 'simple compositions, negative space, natural light',
      mood: 'simple, wholesome, plant-forward',
    },
  },
  {
    id: 'CookieAndKate',
    name: 'CookieAndKate',
    url: 'https://feeds.feedburner.com/CookieAndKate',
    category: 'food',
    imageStyle: {
      style: 'vegetarian home cooking',
      colorPalette: 'fresh vegetable colors, warm kitchen tones',
      photographyStyle: 'rustic table settings, natural daylight',
      mood: 'fresh, healthy, inviting',
    },
  },
  {
    id: 'pinchofyum',
    name: 'pinchofyum',
    url: 'https://pinchofyum.com/feed',
    category: 'food',
    imageStyle: {
      style: 'bright modern food blog aesthetic',
      colorPalette: 'vibrant food colors, clean white backgrounds',
      photographyStyle: 'studio-quality food photography, styled props',
      mood: 'appetizing, cheerful, polished',
    },
  },
  {
    id: 'pitchfork',
    name: 'pitchfork',
    url: 'https://pitchfork.com/rss/news/',
    category: 'music',
    imageStyle: {
      style: 'indie music and album art aesthetic',
      colorPalette: 'moody earth tones, vintage film colors',
      photographyStyle: 'artistic band portraits, intimate concert shots',
      mood: 'introspective, artistic, underground culture',
      additionalKeywords: 'vinyl aesthetic, lo-fi grain',
    },
  },
  {
    id: 'consequence',
    name: 'consequence',
    url: 'https://consequence.net/feed/',
    category: 'music',
    imageStyle: {
      style: 'alternative rock and festival culture',
      colorPalette: 'festival sunset colors, stage lighting',
      photographyStyle: 'live performance photography, festival crowds',
      mood: 'energetic, festival vibes, rock culture',
    },
  },
  {
    id: 'metalinjection',
    name: 'metalinjection',
    url: 'https://feeds.feedburner.com/metalinjection',
    category: 'music',
    imageStyle: {
      style: 'heavy metal and hardcore aesthetic',
      colorPalette: 'blacks, blood reds, electric colors, flames',
      photographyStyle: 'mosh pit action, dramatic stage lighting',
      mood: 'intense, powerful, rebellious, brutal',
      additionalKeywords: 'metal album art style, dark fantasy',
    },
  },
  {
    id: 'edm',
    name: 'edm',
    url: 'https://edm.com/.rss/full/',
    category: 'music',
    imageStyle: {
      style: 'electronic dance music and rave culture',
      colorPalette: 'neon colors, laser greens, UV purples',
      photographyStyle: 'festival mainstage, light shows, DJ booths',
      mood: 'euphoric, high-energy, futuristic',
      additionalKeywords: 'synthesizer waves, bass drops visual',
    },
  },
  {
    id: 'autoblog',
    name: 'autoblog',
    url: 'https://www.autoblog.com/.rss/feed/7a401613-317c-4892-acfb-6f19ee932643.xml',
    category: 'auto',
    imageStyle: {
      style: 'mainstream automotive journalism',
      colorPalette: 'showroom colors, clean studio backgrounds',
      photographyStyle: 'dealership quality, press release style',
      mood: 'professional, consumer-focused, informative',
    },
  },
  {
    id: 'jalopnik',
    name: 'jalopnik',
    url: 'https://jalopnik.com/rss?x=1',
    category: 'auto',
    imageStyle: {
      style: 'enthusiast car culture with attitude',
      colorPalette: 'Jalopnik orange accents, gritty urban tones',
      photographyStyle: 'candid car spots, unusual angles, real-world settings',
      mood: 'irreverent, passionate, gearhead culture',
    },
  },
  {
    id: 'Speedhunters',
    name: 'Speedhunters',
    url: 'https://feeds.feedburner.com/Speedhunters',
    category: 'auto',
    imageStyle: {
      style: 'motorsport and car culture photography',
      colorPalette: 'racing livery colors, dramatic contrast',
      photographyStyle: 'rolling shots, panning blur, track action',
      mood: 'adrenaline, speed, global car culture',
      additionalKeywords: 'drift culture, JDM, stance nation',
    },
  },
  {
    id: 'MotorAuthority2',
    name: 'MotorAuthority2',
    url: 'https://feeds.feedburner.com/MotorAuthority2',
    category: 'auto',
    imageStyle: {
      style: 'luxury and performance vehicles',
      colorPalette: 'premium metallic finishes, sophisticated neutrals',
      photographyStyle: 'studio glamour shots, scenic driving roads',
      mood: 'aspirational, authoritative, premium',
    },
  },
  {
    id: 'bbci',
    name: 'bbci',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'news',
    imageStyle: {
      style: 'British broadcast journalism',
      colorPalette: 'BBC burgundy, neutral documentary tones',
      photographyStyle:
        'photojournalism, documentary style, global perspective',
      mood: 'authoritative, balanced, impartial',
    },
  },
  {
    id: 'nytimes',
    name: 'nytimes',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    category: 'news',
    imageStyle: {
      style: 'New York Times editorial photography',
      colorPalette:
        'classic newspaper aesthetic, black and white with selective color',
      photographyStyle:
        'Pulitzer-quality photojournalism, investigative imagery',
      mood: 'serious, prestigious, in-depth',
    },
  },
  {
    id: 'aljazeera',
    name: 'aljazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    category: 'news',
    imageStyle: {
      style: 'Middle East and global south perspective',
      colorPalette:
        'Al Jazeera gold accents, desert tones, documentary palette',
      photographyStyle:
        'on-the-ground journalism, conflict coverage, human stories',
      mood: 'global perspective, investigative, underreported stories',
    },
  },
  {
    id: 'globalissues',
    name: 'globalissues',
    url: 'https://www.globalissues.org/news/feed',
    category: 'news',
    imageStyle: {
      style: 'social justice and global development',
      colorPalette: 'earthy humanitarian tones, documentary colors',
      photographyStyle: 'NGO documentary style, human impact photography',
      mood: 'advocacy, awareness, systemic analysis',
    },
  },
  {
    id: 'sportingnews',
    name: 'sportingnews',
    url: 'https://www.sportingnews.com/us/rss',
    category: 'sports',
    imageStyle: {
      style: 'American mainstream sports coverage',
      colorPalette: 'team colors, stadium lighting, classic sports palette',
      photographyStyle: 'action shots, press conference, game day atmosphere',
      mood: 'professional, comprehensive, fan-focused',
    },
  },
  {
    id: 'skysports',
    name: 'skysports',
    url: 'https://www.skysports.com/rss/12040',
    category: 'sports',
    imageStyle: {
      style: 'British sports broadcasting',
      colorPalette:
        'Sky blue accents, Premier League colors, broadcast quality',
      photographyStyle:
        'match coverage, sideline action, broadcast graphics style',
      mood: 'authoritative, live action, British football culture',
    },
  },
  {
    id: 'deadspin',
    name: 'deadspin',
    url: 'https://deadspin.com/rss',
    category: 'sports',
    imageStyle: {
      style: 'irreverent sports commentary',
      colorPalette: 'bold contrasts, internet culture colors',
      photographyStyle: 'meme-worthy moments, unusual angles, candid captures',
      mood: 'snarky, honest, anti-establishment sports',
    },
  },
  {
    id: 'politicoNews',
    name: 'Politico News',
    url: 'https://rss.politico.com/politics-news.xml',
    category: 'news',
    imageStyle: {
      style: 'Washington DC political journalism',
      colorPalette:
        'Capitol Hill colors, patriotic tones, power corridor aesthetic',
      photographyStyle:
        'political portraits, press briefings, legislative action',
      mood: 'insider, analytical, policy-focused',
    },
  },
  {
    id: 'totallandscapecare',
    name: 'Total Landscape Care',
    url: 'https://www.totallandscapecare.com/feed',
    category: 'home',
    imageStyle: {
      style: 'professional landscaping and outdoor design',
      colorPalette: 'lush greens, seasonal colors, outdoor textures',
      photographyStyle: 'before and after shots, landscape architecture',
      mood: 'professional, outdoor beauty, transformation',
    },
  },
  // Home (strengthening category)
  {
    id: 'younghouselove',
    name: 'Young House Love',
    url: 'https://www.younghouselove.com/feed/',
    category: 'home',
    imageStyle: {
      style: 'DIY home renovation and family living',
      colorPalette: 'modern farmhouse palette, bright and airy',
      photographyStyle: 'before and after reveals, in-progress shots',
      mood: 'approachable, family-friendly, achievable DIY',
    },
  },
  {
    id: 'familyhandyman',
    name: 'Family Handyman',
    url: 'https://www.familyhandyman.com/feed/',
    category: 'home',
    imageStyle: {
      style: 'practical home improvement and repairs',
      colorPalette: 'workshop tones, tool colors, instructional palette',
      photographyStyle: 'step-by-step how-to, tool close-ups, problem-solving',
      mood: 'helpful, practical, can-do spirit',
    },
  },
  {
    id: 'remodelista',
    name: 'Remodelista',
    url: 'https://www.remodelista.com/feed/',
    category: 'home',
    imageStyle: {
      style: 'high-end interior design and architecture',
      colorPalette: 'curated neutrals, designer palette, sophisticated tones',
      photographyStyle:
        'architectural photography, styled interiors, detail shots',
      mood: 'aspirational, curated, design-forward',
    },
  },
  // Fashion (strengthening category)
  {
    id: 'hypebeast',
    name: 'Hypebeast',
    url: 'https://hypebeast.com/feed',
    category: 'fashion',
    imageStyle: {
      style: 'streetwear and sneaker culture',
      colorPalette: 'urban neutrals, bold accent colors, concrete tones',
      photographyStyle: 'street photography, product flatlay, lookbook style',
      mood: 'hype, exclusive, urban cool',
      additionalKeywords:
        'supreme aesthetic, sneakerhead culture, limited edition drops',
    },
  },
  {
    id: 'whowhatwear',
    name: 'Who What Wear',
    url: 'https://www.whowhatwear.com/rss',
    category: 'fashion',
    imageStyle: {
      style: 'accessible celebrity and street style',
      colorPalette: 'trending seasonal colors, Instagram-worthy palette',
      photographyStyle: 'street style photography, outfit inspiration shots',
      mood: 'aspirational yet achievable, trend-focused, influencer aesthetic',
    },
  },
  {
    id: 'highsnobiety',
    name: 'Highsnobiety',
    url: 'https://www.highsnobiety.com/feed/',
    category: 'fashion',
    imageStyle: {
      style: 'luxury streetwear editorial',
      colorPalette:
        'sophisticated minimalism, designer palette, elevated street tones',
      photographyStyle: 'high-fashion meets street style, editorial campaigns',
      mood: 'elevated, curated, cultural commentary',
    },
  },
  // Entertainment (new category)
  {
    id: 'eonline',
    name: 'E! Online',
    url: 'https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml',
    category: 'entertainment',
    imageStyle: {
      style: 'celebrity news and pop culture',
      colorPalette: 'E! gold, glamorous pinks, paparazzi flash',
      photographyStyle:
        'red carpet coverage, celebrity candids, premiere events',
      mood: 'glamorous, gossipy, entertainment insider',
    },
  },
  {
    id: 'usweekly',
    name: 'Us Weekly',
    url: 'https://www.usmagazine.com/feed/',
    category: 'entertainment',
    imageStyle: {
      style: 'celebrity lifestyle and tabloid culture',
      colorPalette: 'bold tabloid colors, magazine cover aesthetic',
      photographyStyle:
        'paparazzi shots, celebrity lifestyle, just like us moments',
      mood: 'accessible celebrity, relatable gossip, weekly drama',
    },
  },
  // Science (new category)
  {
    id: 'arstechnica_science',
    name: 'Ars Technica Science',
    url: 'https://feeds.arstechnica.com/arstechnica/science',
    category: 'science',
    imageStyle: {
      style: 'tech-savvy science journalism',
      colorPalette: 'Ars orange accents, technical blues, circuit board greens',
      photographyStyle:
        'scientific visualization, tech-meets-science aesthetic',
      mood: 'nerdy, in-depth, technically accurate',
    },
  },
  {
    id: 'sciencedaily',
    name: 'Science Daily',
    url: 'https://www.sciencedaily.com/rss/all.xml',
    category: 'science',
    imageStyle: {
      style: 'academic research and discovery',
      colorPalette: 'laboratory whites, research institution blues',
      photographyStyle: 'research lab imagery, scientific diagrams, microscopy',
      mood: 'academic, discovery-focused, peer-reviewed',
    },
  },
  {
    id: 'physorg',
    name: 'Phys.org',
    url: 'https://phys.org/rss-feed/',
    category: 'science',
    imageStyle: {
      style: 'physics and space science',
      colorPalette: 'cosmic purples, quantum blues, particle physics colors',
      photographyStyle:
        'space imagery, particle visualizations, astronomical photography',
      mood: 'awe-inspiring, frontier science, universe exploration',
    },
  },
  // Gaming (new category)
  {
    id: 'kotaku',
    name: 'Kotaku',
    url: 'https://kotaku.com/rss',
    category: 'gaming',
    imageStyle: {
      style: 'gaming culture and industry commentary',
      colorPalette: 'gaming UI colors, neon accents, pixel art palette',
      photographyStyle: 'game screenshots, cosplay, gaming setup aesthetic',
      mood: 'critical, cultural commentary, gamer perspective',
    },
  },
  {
    id: 'polygon',
    name: 'Polygon',
    url: 'https://www.polygon.com/rss/index.xml',
    category: 'gaming',
    imageStyle: {
      style: 'artistic gaming and entertainment coverage',
      colorPalette: 'Polygon pink/purple gradients, modern design palette',
      photographyStyle: 'stylized game art, pop culture illustrations',
      mood: 'thoughtful, artistic, entertainment-focused',
    },
  },
  // Health (new category)
  {
    id: 'wellnessmama',
    name: 'Wellness Mama',
    url: 'https://wellnessmama.com/feed/',
    category: 'health',
    imageStyle: {
      style: 'natural family wellness and holistic health',
      colorPalette: 'natural greens, organic earth tones, herbal palette',
      photographyStyle: 'lifestyle wellness, natural remedies, family health',
      mood: 'nurturing, natural, mom-tested solutions',
    },
  },
  {
    id: 'medicinenet',
    name: 'MedicineNet',
    url: 'https://www.medicinenet.com/rss/dailyhealth.xml',
    category: 'health',
    imageStyle: {
      style: 'medical information and health education',
      colorPalette: 'clinical whites, medical blues, healthcare palette',
      photographyStyle:
        'medical illustrations, anatomical diagrams, doctor consultations',
      mood: 'authoritative, educational, doctor-approved',
    },
  },
  {
    id: 'healthcaredive',
    name: 'Healthcare Dive',
    url: 'https://www.healthcaredive.com/feeds/news/',
    category: 'health',
    imageStyle: {
      style: 'healthcare industry and business news',
      colorPalette: 'corporate healthcare colors, professional blues',
      photographyStyle:
        'hospital administration, healthcare business, policy imagery',
      mood: 'industry insider, business-focused, policy-aware',
    },
  },
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
  beforeSavedAt?: number;
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
  categories?: NewsCategory[];
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
