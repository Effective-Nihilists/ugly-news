import { authReq, req, z } from 'ugly-app/shared';
import {
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

// News request definitions. Spread into the app's defineRequests() registry.
export const newsRequestDefs = {
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
};
