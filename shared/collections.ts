import { z } from 'zod';
import type { InferDocType } from 'ugly-app/shared';
import { d1, defineCollections } from 'ugly-app/shared';
import {
  FileMarkdownSchema,
  NewsArticleSchema,
  NewsClusterSchema,
  NewsFeedDocSchema,
  NewsPodcastSchema,
  NewsSourceSchema,
  UserFilePreferenceSchema,
  UserNewsEmailPrefSchema,
  UserNewsPreferenceSchema,
  UserNewsReactionSchema,
  UserNewsReadSchema,
  UserNewsSavedSchema,
  UserNewsSourceFollowSchema,
} from './news/schemas';

// ─── Schemas & Types ─────────────────────────────────────────────────────────

export const TodoSchema = z.object({
  userId: z.string(),
  text: z.string(),
  done: z.boolean(),
});
export type Todo = InferDocType<typeof TodoSchema>;

export const ConversationSchema = z.object({
  type: z.string().default('ai-chat'),
  title: z.string().default(''),
});
export type Conversation = InferDocType<typeof ConversationSchema>;

export const MessageSchema = z.object({
  conversationId: z.string(),
  userId: z.string(),
  text: z.string(),
});
export type Message = InferDocType<typeof MessageSchema>;

export const CollabDocSchema = z.object({
  yjsState: z.string(),
  serialized: z.string().nullable(),
  lastSyncedAt: z.number(),
});
export type CollabDoc = InferDocType<typeof CollabDocSchema>;

// --- Collections ---
// meta options:
//   cache        – cache docs in memory LRU (good for small, frequently read collections)
//   trackable    – emit change events so clients can subscribe to real-time updates
//   public       – allow unauthenticated reads (use sparingly)
//   cascadeFrom  – name of a parent collection: when that parent is deleted, cascade here
//   trackKeys    – fields whose values are used as NATS routing keys for scoped trackDocs
//                  subscriptions. Example: trackKeys: ['chatId'] enables
//                  socket.trackDocs(collections.message, { keys: { chatId: '...' } }, cb)
//
// Every collection persists on Cloudflare D1 (SQLite). Unlike Neon's GIN
// fallback, D1 THROWS on a structured getDocs/find filter or sort over an
// undeclared index, so each field a non-ranked getDocs/find touches — plus every
// trackKey (clients subscribe by trackKey) — is indexed below. Ranked reads
// (getDocs { search } / { near }) and getQuery are index-exempt.
// `created`/`updated`/`_id`/`version` are top-level columns and never need one.
//
// After adding a collection, run: npm run db:schema-gen && npm run db:migrate
export const collections = defineCollections({
  todo: {
    schema: TodoSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: true,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    indexes: [{ fields: { userId: 1 } }],
  },
  conversation: {
    schema: ConversationSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
    },
  },
  message: {
    schema: MessageSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: 'conversation',
      trackKeys: ['conversationId'],
    },
    // trackKey conversationId; also the cascade-from-conversation child lookup.
    indexes: [{ fields: { conversationId: 1 } }],
  },
  collabDoc: {
    schema: CollabDocSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
    },
  },

  // ─── News ──────────────────────────────────────────────────────────────
  // RSS feed registry (small, read often → cache; publicly readable).
  newsFeed: {
    schema: NewsFeedDocSchema,
    meta: {
      db: d1,
      cache: true,
      trackable: false,
      public: true,
      cascadeFrom: null,
    },
  },
  // Raw scraped articles (intermediate; the user-facing article is the `file`).
  newsArticle: {
    schema: NewsArticleSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
    },
    // `created` (system column) index backs the retention prune's `created < cutoff`
    // filter (see server/news/retention.ts).
    indexes: [
      { fields: { feedId: 1 } },
      { fields: { scrapedAt: -1 } },
      { fields: { created: -1 } },
    ],
  },
  // Outlet bias/factuality/ownership registry (small, read often → cache;
  // publicly readable so the bias bar + source chips can render unauthenticated).
  newsSource: {
    schema: NewsSourceSchema,
    meta: {
      db: d1,
      cache: true,
      trackable: false,
      public: true,
      cascadeFrom: null,
    },
  },
  // Story clusters — the "same story across many outlets" unit that powers The
  // Spread / The Blindspot / The Ugly Take. Publicly readable; trackable so the
  // home rail can live-update as coverage grows.
  newsCluster: {
    schema: NewsClusterSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: true,
      public: true,
      cascadeFrom: null,
    },
    indexes: [
      { fields: { category: 1 } },
      { fields: { lastUpdatedAt: -1 } },
      { fields: { blindspotSide: 1 } },
      { fields: { score: -1 } },
    ],
  },
  // FileMarkdown — the user-facing article (feed ranking + podcast select + email key off this).
  file: {
    schema: FileMarkdownSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: true,
      public: true,
      cascadeFrom: null,
      // In-D1 SQLite FTS5 over title/text.
      search: { fields: ['title', 'text'], language: 'english' },
      // 512-dim article embedding OUT-OF-BAND in Cloudflare Vectorize (keyed by
      // _id), written via setDoc(..., { vec }); queried with getDocs({ near })
      // and read back with getVecs. `filterable` mirrors these fields as
      // Vectorize metadata so the ANN pre-filters on public/userId/type/category
      // and — crucially — the numeric `created` epoch-ms RANGE that bounds the
      // feed's two-week time window.
      vector: {
        dimensions: 512,
        filterable: ['public', 'userId', 'type', 'category', 'created'],
      },
    },
    // Structured (non-ranked) getDocs cover: feed/email candidate reads
    // { public, userId, embedded, created } and podcast selection { type, feedId }.
    // `created` is a top-level column (retention prune + sort), no index needed.
    indexes: [
      { fields: { type: 1 } },
      { fields: { feedId: 1 } },
      { fields: { created: -1 } },
      { fields: { public: 1, userId: 1, embedded: 1 } },
    ],
  },
  userFilePreference: {
    schema: UserFilePreferenceSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    indexes: [{ fields: { userId: 1 } }],
  },
  newsPodcast: {
    schema: NewsPodcastSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: true,
      public: true,
      cascadeFrom: null,
    },
    indexes: [{ fields: { date: -1 } }],
  },
  // ─── Per-user news state ─────────────────────────────────────────────────
  userNewsRead: {
    schema: UserNewsReadSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    indexes: [{ fields: { userId: 1 } }],
  },
  userNewsSaved: {
    schema: UserNewsSavedSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: true,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    indexes: [{ fields: { userId: 1, savedAt: -1 } }],
  },
  userNewsReaction: {
    schema: UserNewsReactionSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    indexes: [{ fields: { userId: 1 } }],
  },
  userNewsSourceFollow: {
    schema: UserNewsSourceFollowSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    indexes: [{ fields: { userId: 1 } }],
  },
  userNewsPreference: {
    schema: UserNewsPreferenceSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    indexes: [{ fields: { userId: 1 } }],
  },
  userNewsEmailPref: {
    schema: UserNewsEmailPrefSchema,
    meta: {
      db: d1,
      cache: false,
      trackable: false,
      public: false,
      cascadeFrom: null,
      trackKeys: ['userId'],
    },
    // userEmailHourly filters { timezone, emailAllowed }; podcast dispatch filters
    // { emailAllowed }; trackKey subscription reads by userId.
    indexes: [
      { fields: { timezone: 1, emailAllowed: 1 } },
      { fields: { userId: 1 } },
    ],
  },
});

export type AppCollections = typeof collections;

// Re-export news doc types for convenience.
export type NewsFeedDoc = InferDocType<typeof NewsFeedDocSchema>;
export type NewsArticle = InferDocType<typeof NewsArticleSchema>;
export type NewsSource = InferDocType<typeof NewsSourceSchema>;
export type NewsCluster = InferDocType<typeof NewsClusterSchema>;
export type FileMarkdown = InferDocType<typeof FileMarkdownSchema>;
export type UserFilePreference = InferDocType<typeof UserFilePreferenceSchema>;
export type NewsPodcast = InferDocType<typeof NewsPodcastSchema>;
export type UserNewsRead = InferDocType<typeof UserNewsReadSchema>;
export type UserNewsSaved = InferDocType<typeof UserNewsSavedSchema>;
export type UserNewsReaction = InferDocType<typeof UserNewsReactionSchema>;
export type UserNewsSourceFollow = InferDocType<
  typeof UserNewsSourceFollowSchema
>;
export type UserNewsPreference = InferDocType<typeof UserNewsPreferenceSchema>;
export type UserNewsEmailPref = InferDocType<typeof UserNewsEmailPrefSchema>;
