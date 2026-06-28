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
  .passthrough();
export type ImagePublic = z.infer<typeof ImagePublicSchema>;

// ─── News categories ───────────────────────────────────────────────────────

export const newsCategoryValues = [
  'fashion',
  'tech',
  'sports',
  'food',
  'music',
  'auto',
  'news',
  'home',
  'entertainment',
  'science',
  'gaming',
  'health',
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
