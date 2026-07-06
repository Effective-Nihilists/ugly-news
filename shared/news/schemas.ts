import { z } from 'zod';
import type { TTSVisemeName } from 'ugly-app/shared';
import { visemeNames } from 'ugly-app/shared';

// ─── Image (self-contained, mirrors ugly.bot ImagePublic) ──────────────────

export const ImagePublicSchema = z
  .object({
    type: z.literal('public'),
    uri: z.string(),
    width: z.number(),
    height: z.number(),
    description: z.string().optional(),
    sizes: z.array(z.number()).optional(),
    blurhash: z.string().optional(),
  })
  .loose();
export type ImagePublic = z.infer<typeof ImagePublicSchema>;

// ─── News categories ───────────────────────────────────────────────────────

// Keep in sync with NewsCategory in shared/news/types.ts. Lifestyle desks were
// dropped in the "Three Ways" rewrite.
export const newsCategoryValues = [
  'politics',
  'world',
  'business',
  'tech',
  'science',
  'events',
] as const;

export const NewsCategorySchema = z.enum(newsCategoryValues);

// ─── Article + Feed + user-state schemas ──────────────────────────────────

export const NewsArticleSchema = z.object({
  contentHtml: z.string(),
  feedId: z.string(),
  title: z.string(),
  contentMarkdown: z.string(),
  uri: z.string().nullable(),
  categories: z.array(z.string()),
  imageUri: z.string().nullable(),
  summary: z.string().nullable(),
  summaryGeneratedAt: z.number().nullable(),
  scrapeStatus: z
    .enum(['pending', 'success', 'failed', 'skipped', 'ad'])
    .nullable(),
  scrapeError: z.string().nullable(),
  scrapedAt: z.number().nullable(),
  fileId: z.string().nullable(),
});

export const NewsFeedDocSchema = z.object({
  name: z.string(),
  url: z.string(),
  category: NewsCategorySchema,
  imageStyle: z
    .object({
      style: z.string(),
      colorPalette: z.string().optional(),
      photographyStyle: z.string().optional(),
      mood: z.string().optional(),
      additionalKeywords: z.string().optional(),
      negativePrompt: z.string().optional(),
    })
    .optional(),
});

// ─── Bias / factuality (Ground-News-style "see all sides") ─────────────────
// Seven-point political-lean scale, averaged from public AllSides / Ad Fontes /
// MBFC ratings (see shared/news/sourceBias.ts). `biasScore` is the numeric
// position on a −6 (far left) .. +6 (far right) line; the three-way bucket
// (left | center | right) used by the bias bar is derived from it.
export const biasValues = [
  'far-left',
  'left',
  'lean-left',
  'center',
  'lean-right',
  'right',
  'far-right',
] as const;
export const BiasSchema = z.enum(biasValues);
export type Bias = z.infer<typeof BiasSchema>;

export const factualityValues = ['very-low', 'low', 'mixed', 'high', 'very-high'] as const;
export const FactualitySchema = z.enum(factualityValues);
export type Factuality = z.infer<typeof FactualitySchema>;

// The three buckets the coverage bar renders (Left / Center / Right).
export const biasBucketValues = ['left', 'center', 'right'] as const;
export const BiasBucketSchema = z.enum(biasBucketValues);
export type BiasBucket = z.infer<typeof BiasBucketSchema>;

// A news outlet, with the bias/factuality/ownership metadata that powers The
// Spread + The Blindspot. One row per outlet; `feedIds` links to the RSS feeds
// in shared/news/types.ts that belong to it.
export const NewsSourceSchema = z.object({
  name: z.string(),
  homepage: z.string().nullable().default(null),
  domains: z.array(z.string()).default([]),
  feedIds: z.array(z.string()).default([]),
  bias: BiasSchema,
  biasScore: z.number(), // −6 (far left) .. +6 (far right)
  factuality: FactualitySchema,
  owner: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
});

// ─── Story cluster (the "same story, many outlets" unit) ───────────────────
// Coverage distribution across the three buckets, plus the percentages the bias
// bar renders. `total` excludes articles from sources we can't rate.
export const BiasBreakdownSchema = z.object({
  left: z.number().default(0),
  center: z.number().default(0),
  right: z.number().default(0),
  unrated: z.number().default(0),
  total: z.number().default(0),
  leftPct: z.number().default(0),
  centerPct: z.number().default(0),
  rightPct: z.number().default(0),
});
export type BiasBreakdown = z.infer<typeof BiasBreakdownSchema>;

export const NewsClusterSchema = z.object({
  title: z.string(),
  category: NewsCategorySchema,
  // Running-mean centroid of member embeddings. Stored as a plain JSON array
  // (NOT a declared `vector` column): cluster counts in the active window are
  // small, so assignment does an in-TS cosine scan via shared/news/ranking.
  centroid: z.array(z.number()).nullable().default(null),
  fileIds: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
  feedIds: z.array(z.string()).default([]),
  articleCount: z.number().default(0),
  biasBreakdown: BiasBreakdownSchema,
  // Set when coverage is lopsided enough that one side is effectively missing.
  blindspotSide: BiasBucketSchema.nullable().default(null),
  // Mean factuality across rated member sources, 1 (very-low)..5 (very-high).
  factualityAvg: z.number().nullable().default(null),
  // AI-written, populated once a cluster spans ≥2 buckets (clusterSynthesize).
  neutralSummary: z.string().nullable().default(null),
  framingSummary: z.string().nullable().default(null),
  // The labeled Onion-style companion (a `file` with kind:'satire').
  uglyTakeFileId: z.string().nullable().default(null),
  topImageUri: z.string().nullable().default(null),
  // Ranking signal for Top Stories (coverage breadth + recency + engagement).
  score: z.number().default(0),
  synthesizedAt: z.number().nullable().default(null),
  satirizedAt: z.number().nullable().default(null),
  firstSeenAt: z.number(),
  lastUpdatedAt: z.number(),
});

export const UserNewsPreferenceSchema = z.object({
  userId: z.string(),
  embedding: z.array(z.number()).nullable(),
  likeCount: z.number(),
  updatedAt: z.number(),
});

export const UserNewsReactionSchema = z.object({
  userId: z.string(),
  articleId: z.string(),
  reaction: z.enum(['like', 'dislike']),
  reactedAt: z.number(),
});

export const UserNewsReadSchema = z.object({
  userId: z.string(),
  fileId: z.string(),
  readAt: z.number(),
});

export const UserNewsSavedSchema = z.object({
  userId: z.string(),
  fileId: z.string(),
  savedAt: z.number(),
});

export const UserNewsSourceFollowSchema = z.object({
  userId: z.string(),
  sourceId: z.string(),
  followedAt: z.number(),
});

// Per-user daily-email preferences (drives the 8am-local email cron).
export const UserNewsEmailPrefSchema = z.object({
  userId: z.string(),
  timezone: z.string(),
  emailAllowed: z.boolean(),
  lang: z.string().default('en'),
});

// ─── Podcast viseme / gesture / camera enums ───────────────────────────────

export const GestureHintSchema = z.object({
  gesture: z.enum([
    'handup',
    'index',
    'thumbup',
    'shrug',
    'side',
    'ok',
    'thumbdown',
    'namaste',
  ]),
  timing: z.enum(['start', 'mid', 'end']),
});

export const CameraShotSchema = z.enum(['normal', 'closeup']);
export const CameraEnergySchema = z.enum(['fast', 'normal', 'slow']);
export const SpeakerEmotionSchema = z.enum([
  'happy',
  'sad',
  'angry',
  'surprised',
  'fearful',
  'disgusted',
  'laughing',
  'whispering',
  'neutral',
]);
export const NonVerbalCueSchema = z.enum(['breathe', 'sigh', 'laugh', 'chuckle']);
export const ListenerReactionSchema = z.enum([
  'nod',
  'laugh',
  'shocked',
  'agree',
  'empathize',
  'bored',
]);

const AudioWordSchema = z.object({
  text: z.string(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
});

const TTSVisemeNameSchema = z.enum(
  visemeNames as unknown as [string, ...string[]],
) as unknown as z.ZodType<TTSVisemeName>;

const ARKitMouthShapesSchema = z.object({
  jawOpen: z.number(),
  jawForward: z.number(),
  mouthFunnel: z.number(),
  mouthPucker: z.number(),
  mouthClose: z.number(),
  mouthStretchLeft: z.number(),
  mouthStretchRight: z.number(),
  mouthPressLeft: z.number(),
  mouthPressRight: z.number(),
});

// Podcast-specific schemas with required speakerId
export const PodcastVisemeSchema = z.object({
  name: TTSVisemeNameSchema,
  startMs: z.number(),
  durationMs: z.number(),
  intensity: z.number(),
  speakerId: z.string(),
  arkit: ARKitMouthShapesSchema.optional(),
});

export const PodcastSubtitleSchema = z.object({
  text: z.string(),
  speakerId: z.string(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  words: z.array(AudioWordSchema).optional(),
});

// ─── NewsPodcast (video + social-media fields dropped per ugly-news scope) ──

export const NewsPodcastSchema = z.object({
  date: z.string(),
  title: z.string(),
  description: z.string(),
  userId: z.string().nullable(),
  host1BotId: z.string(),
  host2BotId: z.string(),
  articles: z.array(
    z.object({
      fileId: z.string(),
      title: z.string(),
      imageUri: z.string().nullable(),
      image: ImagePublicSchema.nullable(),
      startTimeMs: z.number(),
      endTimeMs: z.number(),
    }),
  ),
  segments: z.array(
    z.object({
      speakerId: z.string(),
      speakerName: z.string(),
      text: z.string(),
      startTimeMs: z.number(),
      endTimeMs: z.number(),
      articleRef: z.string().optional(),
      gestureHint: GestureHintSchema.optional(),
      cameraShot: CameraShotSchema.optional(),
      cameraEnergy: CameraEnergySchema.optional(),
      listenerReaction: ListenerReactionSchema.optional(),
      speakerEmotion: SpeakerEmotionSchema.optional(),
      nonVerbalCue: NonVerbalCueSchema.optional(),
    }),
  ),
  audioUri: z.string(),
  durationMs: z.number(),
  visemes: z.array(PodcastVisemeSchema),
  subtitles: z.array(PodcastSubtitleSchema),
  // Optional "song mode" fields. Server-side song/AvatarScript generation was
  // dropped in the migration, but the client podcast player still references
  // these (they stay undefined for normal news podcasts → the standard
  // talking/dancing path runs).
  songMode: z.boolean().optional(),
  songBpm: z.number().optional(),
  beatOffsetMs: z.number().optional(),
  danceGroup: z.enum(['chill', 'groove', 'hype', 'silly']).optional(),
  backgroundUri: z.string().nullable().optional(),
  generationStatus: z.enum(['pending', 'generating', 'complete', 'failed']),
  generationError: z.string().nullable(),
  generatedAt: z.number(),
  // Set once the "new episode" push fan-out has run for this (default) episode,
  // so a manual regenerate doesn't re-notify subscribers. Null/absent = unsent.
  pushedAt: z.number().nullable().optional(),
});

// ─── FileMarkdown (news-scoped subset of ugly.bot's File union) ────────────
// News only ever creates/reads `type: 'markdown'` files. We model just that.

export const FileMarkdownSchema = z.object({
  userId: z.string(),
  type: z.literal('markdown'),
  markdown: z.string(),
  uris: z.array(z.string()).optional(),
  // Display / feed metadata
  title: z.string().nullable().optional(),
  thumbnail: ImagePublicSchema.nullable().optional(),
  text: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  // Source attribution
  sourceUri: z.string().nullable().optional(),
  feedId: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  // Search / ranking
  indexable: z.boolean().default(true),
  indexed: z.boolean().default(false),
  embedding: z.array(z.number()).nullable().optional(),
  public: z.boolean().default(true),
  // Engagement counters (for ranking + email "trending")
  likeCount: z.number().default(0),
  dislikeCount: z.number().default(0),
  viewCount: z.number().default(0),
  conversationId: z.string().nullable().optional(),
  // ─── "Three Ways" linkage ────────────────────────────────────────────────
  // The story cluster this article belongs to (set by the clustering engine).
  clusterId: z.string().nullable().optional(),
  // 'article' = real summarized news (default). 'satire' = the labeled Ugly
  // Take companion — excluded from the normal feed/search, only surfaced via
  // its cluster's `uglyTakeFileId`.
  kind: z.enum(['article', 'satire']).default('article').optional(),
});

// Interest cluster: a centroid of liked-article embeddings, weighted + time-decayed.
export const InterestClusterSchema = z.object({
  id: z.string(),
  embedding: z.array(z.number()),
  weight: z.number(),
  lastUsed: z.number(),
});
export type InterestCluster = z.infer<typeof InterestClusterSchema>;

export const UserFilePreferenceSchema = z.object({
  userId: z.string(),
  clusters: z.array(InterestClusterSchema),
  embedding: z.array(z.number()).nullable(),
  likeCount: z.number().default(0),
  dislikeCount: z.number().default(0),
  updatedAt: z.number(),
});
