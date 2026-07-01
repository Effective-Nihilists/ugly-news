import { authReq, req, z } from 'ugly-app/shared';
import {
  BiasBreakdownSchema,
  BiasBucketSchema,
  BiasSchema,
  FactualitySchema,
  FileMarkdownSchema,
  NewsPodcastSchema,
  newsCategoryValues,
} from './schemas';

// A stored doc adds the DBObject fields (matches `InferDocType = z.infer<S> & DBObject`).
const dbObjectFields = {
  _id: z.string(),
  version: z.number(),
  created: z.date(),
  updated: z.date(),
};

const FeedFileSchema = FileMarkdownSchema.extend(dbObjectFields);

const NewsFeedItemSchema = z.object({
  file: FeedFileSchema,
  saved: z.boolean(),
  reaction: z.enum(['like', 'dislike']).nullable(),
});

const PodcastDocSchema = NewsPodcastSchema.extend(dbObjectFields);

const empty = z.object({});

// ── Public article shapes (no auth — power the public landing/feed) ────────
export const NewsCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  thumbnailUri: z.string().nullable(),
  category: z.string().nullable(),
  feedId: z.string().nullable(),
  createdMs: z.number(),
});
export const NewsArticleFullSchema = NewsCardSchema.extend({
  markdown: z.string(),
  sourceUri: z.string().nullable(),
  clusterId: z.string().nullable(),
});

// Lightweight podcast row for the public archive (no segments/visemes payload).
export const PodcastCardSchema = z.object({
  id: z.string(),
  date: z.string(),
  title: z.string(),
  description: z.string(),
  durationMs: z.number(),
  articleCount: z.number(),
  coverImageUri: z.string().nullable(),
});

// ── "Three Ways" cluster shapes (Ground-News-style coverage) ───────────────
export const ClusterCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  biasBreakdown: BiasBreakdownSchema,
  blindspotSide: BiasBucketSchema.nullable(),
  factualityAvg: z.number().nullable(),
  articleCount: z.number(),
  sourceCount: z.number(),
  topImageUri: z.string().nullable(),
  summary: z.string().nullable(),
  hasUglyTake: z.boolean(),
  lastUpdatedAt: z.number(),
});

const ClusterSourceSchema = z.object({
  sourceId: z.string(),
  name: z.string(),
  bias: BiasSchema,
  biasScore: z.number(),
  factuality: FactualitySchema,
  bucket: BiasBucketSchema,
});

const ClusterCoverageItemSchema = z.object({
  fileId: z.string(),
  title: z.string(),
  sourceId: z.string().nullable(),
  sourceName: z.string(),
  bucket: BiasBucketSchema.nullable(),
  factuality: FactualitySchema.nullable(),
  uri: z.string().nullable(),
});

const UglyTakeSchema = z.object({
  id: z.string(),
  title: z.string(),
  markdown: z.string(),
  imageUri: z.string().nullable(),
});

export const ClusterFullSchema = ClusterCardSchema.extend({
  neutralSummary: z.string().nullable(),
  framingSummary: z.string().nullable(),
  sources: z.array(ClusterSourceSchema),
  coverage: z.array(ClusterCoverageItemSchema),
  uglyTake: UglyTakeSchema.nullable(),
});

// News request definitions. Spread into the app's defineRequests() registry.
export const newsRequestDefs = {
  // ─── "Three Ways" clusters (public) ──────────────────────────────────────
  newsTopStories: req({
    input: z.object({
      limit: z.number().min(1).max(40).default(12),
      category: z.enum(newsCategoryValues).optional(),
    }),
    output: z.object({ items: z.array(ClusterCardSchema) }),
    rateLimit: { max: 60, window: 60 },
  }),
  newsClusterGet: req({
    input: z.object({ id: z.string() }),
    output: z.object({ cluster: ClusterFullSchema.nullable() }),
    rateLimit: { max: 120, window: 60 },
  }),
  newsBlindspot: req({
    input: z.object({ limit: z.number().min(1).max(40).default(12) }),
    output: z.object({ items: z.array(ClusterCardSchema) }),
    rateLimit: { max: 60, window: 60 },
  }),
  newsClusterArchive: req({
    input: z.object({
      limit: z.number().min(1).max(60).default(30),
      skip: z.number().min(0).default(0),
      category: z.enum(newsCategoryValues).optional(),
    }),
    output: z.object({ items: z.array(ClusterCardSchema), hasMore: z.boolean() }),
    rateLimit: { max: 60, window: 60 },
  }),

  // ─── Public (no auth) — the landing/feed + article view ──────────────────
  newsLatest: req({
    input: z.object({
      limit: z.number().min(1).max(60).default(24),
      category: z.enum(newsCategoryValues).optional(),
    }),
    output: z.object({ items: z.array(NewsCardSchema) }),
  }),
  newsArticleGet: req({
    input: z.object({ id: z.string() }),
    output: z.object({ article: NewsArticleFullSchema.nullable() }),
  }),
  // Public archive: browse every published story newest-first, with optional
  // keyword filter (title/summary). Paginated via skip; client groups by date.
  newsArchive: req({
    input: z.object({
      query: z.string().optional(),
      limit: z.number().min(1).max(60).default(30),
      skip: z.number().min(0).default(0),
      category: z.enum(newsCategoryValues).optional(),
    }),
    output: z.object({ items: z.array(NewsCardSchema), hasMore: z.boolean() }),
    rateLimit: { max: 60, window: 60 },
  }),
  // Public archive: every past daily podcast newest-first (lightweight cards).
  newsPodcastArchive: req({
    input: z.object({
      limit: z.number().min(1).max(60).default(30),
      skip: z.number().min(0).default(0),
    }),
    output: z.object({ items: z.array(PodcastCardSchema), hasMore: z.boolean() }),
    rateLimit: { max: 60, window: 60 },
  }),

  // ─── Read tracking ───────────────────────────────────────────────────────
  newsMarkRead: authReq({
    input: z.object({ fileId: z.string() }),
    output: empty,
  }),
  newsMarkReadBulk: authReq({
    input: z.object({ fileIds: z.array(z.string()) }),
    output: empty,
  }),
  newsMarkUnread: authReq({
    input: z.object({ fileId: z.string() }),
    output: empty,
  }),
  newsReadGetAll: authReq({
    input: empty,
    output: z.object({ fileIds: z.array(z.string()) }),
  }),
  newsReadResetAll: authReq({
    input: empty,
    output: z.object({ deletedCount: z.number() }),
  }),

  // ─── Save / bookmark ───────────────────────────────────────────────────
  newsSave: authReq({
    input: z.object({ fileId: z.string(), saved: z.boolean() }),
    output: empty,
  }),
  newsSavedGet: authReq({
    input: z.object({ limit: z.number(), beforeSavedAt: z.number().optional() }),
    output: z.object({ items: z.array(z.string()), hasMore: z.boolean() }),
  }),
  newsIsSaved: authReq({
    input: z.object({ fileId: z.string() }),
    output: z.object({ saved: z.boolean() }),
  }),
  newsIsSavedBatch: authReq({
    input: z.object({ fileIds: z.array(z.string()) }),
    output: z.object({ savedFileIds: z.array(z.string()) }),
  }),

  // ─── Feed / search ────────────────────────────────────────────────────
  newsFeedGet: authReq({
    input: z.object({ limit: z.number() }),
    output: z.object({
      items: z.array(NewsFeedItemSchema),
      hasMore: z.boolean(),
    }),
  }),
  newsSearch: authReq({
    input: z.object({
      query: z.string(),
      limit: z.number(),
      categories: z.array(z.enum(newsCategoryValues)).optional(),
    }),
    output: z.object({ items: z.array(z.string()) }),
  }),

  // ─── Reactions / following ────────────────────────────────────────────
  newsReact: authReq({
    input: z.object({
      articleId: z.string(),
      reaction: z.enum(['like', 'dislike']).nullable(),
    }),
    output: z.object({ reaction: z.unknown().nullable() }),
  }),
  newsSourceFollow: authReq({
    input: z.object({ sourceId: z.string(), follow: z.boolean() }),
    output: z.object({ followed: z.boolean() }),
  }),
  newsSourceGetFollowed: authReq({
    input: empty,
    output: z.object({
      sources: z.array(
        z.object({
          sourceId: z.string(),
          category: z.enum(newsCategoryValues),
          name: z.string(),
        }),
      ),
    }),
  }),
  newsReset: authReq({ input: empty, output: empty }),

  // ─── Podcast ──────────────────────────────────────────────────────────
  newsPodcastGet: authReq({
    input: z.object({ podcastId: z.string().optional(), date: z.string().optional() }),
    output: z.object({ podcast: PodcastDocSchema.nullable() }),
  }),
  newsPodcastGetDefault: req({
    input: z.object({ date: z.string().optional() }),
    output: z.object({
      podcast: PodcastDocSchema.nullable(),
      host1AvatarUrl: z.string().nullable(),
      host2AvatarUrl: z.string().nullable(),
    }),
  }),
  newsPodcastList: authReq({
    input: z.object({ limit: z.number(), beforeDate: z.string().optional() }),
    output: z.object({
      items: z.array(PodcastDocSchema),
      hasMore: z.boolean(),
    }),
  }),
  newsPodcastInit: authReq({
    input: empty,
    output: z.object({ initialized: z.boolean() }),
  }),
  newsPodcastRegenerate: authReq({
    input: z.object({ date: z.string().optional(), replaceDefault: z.boolean().optional() }),
    output: z.object({ success: z.boolean(), podcastId: z.string() }),
    rateLimit: { max: 5, window: 300 },
  }),

  // ─── Daily-email subscription ───────────────────────────────────────────
  newsEmailPrefGet: authReq({
    input: empty,
    output: z.object({
      emailAllowed: z.boolean(),
      timezone: z.string(),
      lang: z.string(),
    }),
  }),
  newsEmailPrefSet: authReq({
    input: z.object({
      emailAllowed: z.boolean(),
      timezone: z.string(),
      lang: z.string().optional(),
    }),
    output: z.object({
      emailAllowed: z.boolean(),
      timezone: z.string(),
      lang: z.string(),
    }),
  }),
};
