import {
  createApp,
  emailSend,
  flushPerf,
  pushSend,
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
import * as feed from './news/feed';
import * as podcast from './news/podcast';
import { newsDb, setNewsDb } from './news/db';
import { createCronHandlers } from './news/workers';
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

    sendPush: async (_userId, { targetUserId, title, body, path, query, imageUrl }) => {
      try {
        const result = await pushSend({ targetUserId, title, body, path, ...(query ? { query } : {}), ...(imageUrl ? { imageUrl } : {}) });
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
      await emailSend({ userId, subject, html, id });
      return { ok: true };
    },

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
    newsPodcastRegenerate: (_userId, input) =>
      Promise.resolve(podcast.newsPodcastRegenerate(input)),
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const convServer = enableConversations(configurator, {
      conversationCollection: 'conversation',
      messageCollection: 'message',
      aiChat: {
        async *onMessage(session, userMessage) {
          const data = await uglyBotRequest<{ message: { content: string } }>('textGen', {
            model: 'gemini_2_5_flash',
            messages: [
              ...session.messages.map((m) => ({ role: m.role, content: m.text })),
              { role: 'user', content: userMessage },
            ],
            options: { maxTokens: 512 },
          });
          yield data.message.content;
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
    // eslint-disable-next-line @typescript-eslint/require-await
    configurator.setOnAfterStart(async (db) => {
      convDeps.db = db;
      convServer.setDb(db);
      setNewsDb(db as unknown as Parameters<typeof setNewsDb>[0]);
    });
  },
);

// eslint-disable-next-line @typescript-eslint/dot-notation
const port = parseInt(process.env['PORT'] ?? '4321');
await app.start(port);
