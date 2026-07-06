import {
  createApp,
  emailSend,
  flushPerf,
  recordFeedback,
  recordPerf,
  uglyBotRequest,
  type AppConfigurator,
  type InboundEmail,
  type RequestHandlers,
} from 'ugly-app';
import { enableConversations } from 'ugly-app/conversation/server';
import { enableCollab } from 'ugly-app/collab/server';
import { dbDefaults } from 'ugly-app/shared';
import { messages, requests } from '../shared/api';
import type { Todo } from '../shared/collections';
import { collections } from '../shared/collections';
import { resolveUserEmail } from './news/email';
import * as clusters from './news/clusters';
import * as emailPref from './news/emailPref';
import * as feed from './news/feed';
import * as podcast from './news/podcast';
import * as pub from './news/public';
import { newsDb, newsPush, setNewsDb, setNewsPush } from './news/db';
import { seedNewsSources } from './news/seedSources';
import { setPerfSink } from './news/perf';
import { createCronHandlers } from './news/workers';

// Node entry: wire the real (barrel-only) recordPerf into the worker-safe perf
// sink so cluster similarity-calibration samples are queryable via `ugly-app perf`.
setPerfSink(recordPerf);
import { cronTasks } from '../shared/cron';
import { experiments } from '../shared/experiments';
import en from '../shared/lang/en';
import es from '../shared/lang/es';
import { pages } from '../shared/pages';
import { stringsDef } from '../shared/strings';

const cronHandlers = createCronHandlers(newsDb);

const app = createApp(
  { requests, messages },
  {
    createTodo: async (userId, { text }) => {
      const _id = crypto.randomUUID();
      const todo: Todo = { _id, userId, text, done: false, ...dbDefaults() };
      await app.db.setDoc(collections.todo, todo);
      return { id: _id };
    },

    toggleTodo: async (userId, { todoId }) => {
      const todo = await app.db.getDoc(collections.todo, todoId);
      if (!todo?.userId || todo.userId !== userId) throw new Error('Todo not found');
      const updated: Todo = { ...todo, done: !todo.done, ...dbDefaults() };
      await app.db.setDoc(collections.todo, updated);
      return { done: updated.done };
    },

    deleteTodo: async (userId, { todoId }) => {
      const todo = await app.db.getDoc(collections.todo, todoId);
      if (!todo?.userId || todo.userId !== userId) throw new Error('Todo not found');
      await app.db.deleteDoc(collections.todo, todoId);
      return { ok: true };
    },

    sendPush: async (_userId, { targetUserId, title, body, page, query, imageUrl }): Promise<{ sent: boolean }> => {
      try {
        // Route-checked send via the injected push (see setNewsPush below); the
        // framework resolves `page` against the route table and builds the
        // absolute URL. A raw/absolute path can no longer be sent.
        const result = await newsPush()({
          targetUserId,
          title,
          body,
          page,
          ...(query ? { query } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        });
        return { sent: result.sent };
      } catch (e) {
        console.error(e);
        return { sent: false };
      }
    },

    triggerTestError: (_userId, { message }) => {
      const msg = message ?? 'Test server error triggered intentionally';
      throw new Error(msg);
    },

    testWorkerThrow: (_userId, { message }) => {
      const msg = message ?? 'Worker task exception test';
      throw new Error(msg);
    },

    testWorkerDbMutation: async (userId, { text }): Promise<{ id: string; verified: boolean }> => {
      const _id = `worker-test-${crypto.randomUUID()}`;
      const todo: Todo = { _id, userId, text, done: false, ...dbDefaults() };
      await app.db.setDoc(collections.todo, todo);
      const readBack = await app.db.getDoc(collections.todo, _id);
      const verified = readBack?._id === _id && readBack?.text === text;
      await app.db.deleteDoc(collections.todo, _id);
      return { id: _id, verified };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    testWorkerConsoleError: async (_userId, { message }) => {
      const msg = message ?? `[WorkerTest] console.error test ${Date.now()}`;
      console.error(msg);
      return { logged: true };
    },

    triggerTestPerf: async (userId, { operation, durationMs }) => {
      recordPerf(operation, durationMs, userId);
      await flushPerf();
      return { ok: true };
    },

    triggerTestFeedback: async (userId, { type, description }) => {
      await recordFeedback({ type, description, userId });
      return { ok: true };
    },

    sendTestEmail: async (_userId, { userId, subject, html, id }) => {
      // Resolve the recipient (centralized userId→email proxy was removed) then
      // send by `to` address via Cloudflare Email Sending.
      const to = await resolveUserEmail(userId);
      if (!to) return { ok: false };
      await emailSend({ to, subject, html, id });
      return { ok: true };
    },

    // ─── News: public (no auth) ──────────────────────────────────────────
    newsLatest: (_userId, input) => pub.newsLatest(newsDb(), input),
    newsArticleGet: (_userId, input) => pub.newsArticleGet(newsDb(), input),
    newsArchive: (_userId, input) => pub.newsArchive(newsDb(), input),
    newsPodcastArchive: (_userId, input) => pub.newsPodcastArchive(newsDb(), input),

    // ─── News: "Three Ways" clusters (public) ────────────────────────────
    newsTopStories: (_userId, input) => clusters.newsTopStories(newsDb(), input),
    newsClusterGet: (_userId, input) => clusters.newsClusterGet(newsDb(), input),
    newsBlindspot: (_userId, input) => clusters.newsBlindspot(newsDb(), input),
    newsUglyTakes: (_userId, input) => clusters.newsUglyTakes(newsDb(), input),
    newsClusterArchive: (_userId, input) => clusters.newsClusterArchive(newsDb(), input),

    // ─── News: read tracking ─────────────────────────────────────────────
    newsMarkRead: (userId, input) => feed.newsMarkRead(newsDb(), userId, input),
    newsMarkReadBulk: (userId, input) => feed.newsMarkReadBulk(newsDb(), userId, input),
    newsMarkUnread: (userId, input) => feed.newsMarkUnread(newsDb(), userId, input),
    newsReadGetAll: (userId) => feed.newsReadGetAll(newsDb(), userId),
    newsReadResetAll: (userId) => feed.newsReadResetAll(newsDb(), userId),

    // ─── News: save / bookmark ───────────────────────────────────────────
    newsSave: (userId, input) => feed.newsSave(newsDb(), userId, input),
    newsSavedGet: (userId, input) => feed.newsSavedGet(newsDb(), userId, input),
    newsIsSaved: (userId, input) => feed.newsIsSaved(newsDb(), userId, input),
    newsIsSavedBatch: (userId, input) => feed.newsIsSavedBatch(newsDb(), userId, input),

    // ─── News: feed / search ─────────────────────────────────────────────
    newsFeedGet: (userId, input) => feed.newsFeedGet(newsDb(), userId, input),
    newsSearch: (_userId, input) => feed.newsSearch(newsDb(), input),

    // ─── News: reactions / following ─────────────────────────────────────
    newsReact: (userId, input) => feed.newsReact(newsDb(), userId, input),
    newsSourceFollow: (userId, input) => feed.newsSourceFollow(newsDb(), userId, input),
    newsSourceGetFollowed: (userId, input) => feed.newsSourceGetFollowed(newsDb(), userId, input),
    newsReset: (userId) => feed.newsReset(newsDb(), userId),

    // ─── News: podcast ───────────────────────────────────────────────────
    newsPodcastGet: (_userId, input) => podcast.newsPodcastGet(newsDb(), input),
    newsPodcastGetDefault: (_userId, input) => podcast.newsPodcastGetDefault(newsDb(), input),
    newsPodcastList: (_userId, input) => podcast.newsPodcastList(newsDb(), input),
    newsPodcastInit: () => Promise.resolve(podcast.newsPodcastInit()),
    newsPodcastRegenerate: (userId, input) => podcast.newsPodcastRegenerate(userId, input),

    // ─── News: daily-email subscription ──────────────────────────────────
    newsEmailPrefGet: (userId) => emailPref.newsEmailPrefGet(newsDb(), userId),
    newsEmailPrefSet: (userId, input) => emailPref.newsEmailPrefSet(newsDb(), userId, input),
  } satisfies RequestHandlers<typeof requests>,
  collections,
  (configurator: AppConfigurator) => {
    configurator.setPages({ pages });
    configurator.setExperiments(experiments);
    const tables: Record<string, Record<string, string>> = {
      en: en as unknown as Record<string, string>,
      es: es as unknown as Record<string, string>,
    };
    configurator.setStrings({
      defaultLang: stringsDef.defaultLang,
      langs: stringsDef.langs,
      criticalKeys: stringsDef.criticalKeys,
      getTable: (lang) => tables[lang] ?? tables[stringsDef.defaultLang]!,
    });
    configurator.setWorkers(cronTasks, cronHandlers);
    configurator.setOnEmail(async (inbound: InboundEmail) => {
      await Promise.resolve();
      console.log('[Email] Received:', { from: inbound.from, id: inbound.id, subject: inbound.subject });
    });

    // ── Conversations (AI chat) ────────────────────────────────────────────
    // Note: ConversationDeps.db is set lazily since `app` isn't assigned yet during createApp.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convDeps: any = { db: null, collections: {}, userGet: () => null, userPrivateGet: () => null };
     
    const convServer = enableConversations(configurator, {
      conversationCollection: 'conversation',
      messageCollection: 'message',
      aiChat: {
        async *onMessage(session, userMessage) {
          const data = await uglyBotRequest('textGen', {
            model: 'gemini_2_5_flash',
            messages: [
              ...session.messages.map((m) => ({
                role: m.role,
                content: m.text,
              })),
              { role: 'user' as const, content: userMessage },
            ],
            options: { maxTokens: 512 },
          });
          const content = data?.message.content;
          yield typeof content === 'string' ? content : '';
        },
      },
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    }, convDeps);

    // ── Collaborative editing ──────────────────────────────────────────────
    enableCollab(configurator, {
      async loadState(docId) {
        try {
          const doc = await app.db.getDoc(collections.collabDoc, docId);
          return doc?.yjsState ?? null;
        } catch { return null; }
      },
      async saveState(docId, state, serialized) {
        await app.db.setDoc(collections.collabDoc, {
          _id: docId,
          yjsState: state.yjsState,
          serialized,
          lastSyncedAt: state.lastSyncedAt,
          ...dbDefaults(),
        });
      },
    });

    // Set db after app is initialized (app isn't available during createApp)
    configurator.setOnAfterStart(async (db) => {
      convDeps.db = db;
      convServer.setDb(db);
      const newsDbHandle = db as unknown as Parameters<typeof setNewsDb>[0];
      setNewsDb(newsDbHandle);
      // Seed the outlet bias registry from the curated table (idempotent).
      await seedNewsSources(newsDbHandle).catch((err: unknown) => {
        console.warn('[news] seedNewsSources failed', err);
      });
    });
  },
);

// Route-checked push binding — placed after `app` is fully defined so its type
// is resolved (referencing `app.pushSend` inside createApp would be circular).
// The sendPush handler + notifyPodcastReady send through newsPush().
setNewsPush((input) => app.pushSend(input as Parameters<typeof app.pushSend>[0]));

// eslint-disable-next-line @typescript-eslint/dot-notation
const port = parseInt(process.env['PORT'] ?? '4321');
await app.start(port);
