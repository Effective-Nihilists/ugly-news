import { z } from 'zod';
import type { InferDocType } from 'ugly-app/shared';
import { defineCollections } from 'ugly-app/shared';
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
// After adding a collection, run: npm run db:schema-gen && npm run db:migrate
export const collections = defineCollections({
  todo: {
    schema: TodoSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: null, trackKeys: ['userId'] },
  },
  conversation: {
    schema: ConversationSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null },
  },
  message: {
    schema: MessageSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: 'conversation', trackKeys: ['conversationId'] },
  },
  collabDoc: {
    schema: CollabDocSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null },
  },

  // ─── News ──────────────────────────────────────────────────────────────
  // RSS feed registry (small, read often → cache; publicly readable).
  newsFeed: {
    schema: NewsFeedDocSchema,
    meta: { cache: true, trackable: false, public: true, cascadeFrom: null },
  },
  // Raw scraped articles (intermediate; the user-facing article is the `file`).
  newsArticle: {
    schema: NewsArticleSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null },
    indexes: [{ fields: { feedId: 1 } }, { fields: { scrapedAt: -1 } }],
  },
  // Outlet bias/factuality/ownership registry (small, read often → cache;
  // publicly readable so the bias bar + source chips can render unauthenticated).
  newsSource: {
    schema: NewsSourceSchema,
    meta: { cache: true, trackable: false, public: true, cascadeFrom: null },
  },
  // Story clusters — the "same story across many outlets" unit that powers The
  // Spread / The Blindspot / The Ugly Take. Publicly readable; trackable so the
  // home rail can live-update as coverage grows.
  newsCluster: {
    schema: NewsClusterSchema,
    meta: { cache: false, trackable: true, public: true, cascadeFrom: null },
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
      cache: false, trackable: true, public: true, cascadeFrom: null,
      // Postgres FTS (generated tsvector column) + pgvector (embedding column,
      // materialized from the doc's `embedding` field the scraper fills).
      search: { fields: ['title', 'text'], language: 'english' },
      vector: { dimensions: 512, from: 'embedding' },
    },
    indexes: [{ fields: { type: 1 } }, { fields: { feedId: 1 } }],
  },
  userFilePreference: {
    schema: UserFilePreferenceSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null, trackKeys: ['userId'] },
  },
  newsPodcast: {
    schema: NewsPodcastSchema,
    meta: { cache: false, trackable: true, public: true, cascadeFrom: null },
    indexes: [{ fields: { date: -1 } }],
  },
  // ─── Per-user news state ─────────────────────────────────────────────────
  userNewsRead: {
    schema: UserNewsReadSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null, trackKeys: ['userId'] },
    indexes: [{ fields: { userId: 1 } }],
  },
  userNewsSaved: {
    schema: UserNewsSavedSchema,
    meta: { cache: false, trackable: true, public: false, cascadeFrom: null, trackKeys: ['userId'] },
    indexes: [{ fields: { userId: 1, savedAt: -1 } }],
  },
  userNewsReaction: {
    schema: UserNewsReactionSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null, trackKeys: ['userId'] },
    indexes: [{ fields: { userId: 1 } }],
  },
  userNewsSourceFollow: {
    schema: UserNewsSourceFollowSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null, trackKeys: ['userId'] },
    indexes: [{ fields: { userId: 1 } }],
  },
  userNewsPreference: {
    schema: UserNewsPreferenceSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null, trackKeys: ['userId'] },
  },
  userNewsEmailPref: {
    schema: UserNewsEmailPrefSchema,
    meta: { cache: false, trackable: false, public: false, cascadeFrom: null, trackKeys: ['userId'] },
    indexes: [{ fields: { timezone: 1 } }],
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
export type UserNewsSourceFollow = InferDocType<typeof UserNewsSourceFollowSchema>;
export type UserNewsPreference = InferDocType<typeof UserNewsPreferenceSchema>;
export type UserNewsEmailPref = InferDocType<typeof UserNewsEmailPrefSchema>;
