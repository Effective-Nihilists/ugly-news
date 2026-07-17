/**
 * Cloudflare Workers entry — bundled by `ugly-app build:workers` into
 * dist/worker/worker.js and deployed via the Studio publish flow.
 *
 * Mirrors server/index.ts's news handlers, but resolves the request-scoped
 * TypedDB from `getAppContext().typedDb` instead of a module singleton
 * (each Worker invocation binds the adapter/db to its `env`).
 */
import {
  CollectionDO,
  SessionDO,
  createWorkersApp,
  getAppContext,
} from 'ugly-app/server/adapter/workers';
import type { RequestHandlers } from 'ugly-app';
import { messages, requests } from '../shared/api';
import { collections } from '../shared/collections';
import { cronTasks } from '../shared/cron';
import { setNewsPush, type NewsDb } from './news/db';
import * as clusters from './news/clusters';
import * as emailPref from './news/emailPref';
import * as feed from './news/feed';
import * as podcast from './news/podcast';
import * as pub from './news/public';
import { createCronHandlers } from './news/workers';

function wdb(): NewsDb {
  const db = getAppContext().typedDb;
  if (!db) throw new Error('[news/workers] typedDb not ready');
  return db as NewsDb;
}

const requestHandlers: Partial<RequestHandlers<typeof requests>> = {
  newsLatest: (_userId, input) => pub.newsLatest(wdb(), input),
  newsArticleGet: (_userId, input) => pub.newsArticleGet(wdb(), input),
  newsArchive: (_userId, input) => pub.newsArchive(wdb(), input),
  newsPodcastArchive: (_userId, input) => pub.newsPodcastArchive(wdb(), input),
  newsTopStories: (_userId, input) => clusters.newsTopStories(wdb(), input),
  newsClusterGet: (_userId, input) => clusters.newsClusterGet(wdb(), input),
  newsBlindspot: (_userId, input) => clusters.newsBlindspot(wdb(), input),
  newsUglyTakes: (_userId, input) => clusters.newsUglyTakes(wdb(), input),
  newsClusterArchive: (_userId, input) =>
    clusters.newsClusterArchive(wdb(), input),
  newsMarkRead: (userId, input) => feed.newsMarkRead(wdb(), userId, input),
  newsMarkReadBulk: (userId, input) =>
    feed.newsMarkReadBulk(wdb(), userId, input),
  newsMarkUnread: (userId, input) => feed.newsMarkUnread(wdb(), userId, input),
  newsReadGetAll: (userId) => feed.newsReadGetAll(wdb(), userId),
  newsReadResetAll: (userId) => feed.newsReadResetAll(wdb(), userId),
  newsSave: (userId, input) => feed.newsSave(wdb(), userId, input),
  newsSavedGet: (userId, input) => feed.newsSavedGet(wdb(), userId, input),
  newsIsSaved: (userId, input) => feed.newsIsSaved(wdb(), userId, input),
  newsIsSavedBatch: (userId, input) =>
    feed.newsIsSavedBatch(wdb(), userId, input),
  newsFeedGet: (userId, input) => feed.newsFeedGet(wdb(), userId, input),
  newsSearch: (_userId, input) => feed.newsSearch(wdb(), input),
  newsReact: (userId, input) => feed.newsReact(wdb(), userId, input),
  newsSourceFollow: (userId, input) =>
    feed.newsSourceFollow(wdb(), userId, input),
  newsSourceGetFollowed: (userId, input) =>
    feed.newsSourceGetFollowed(wdb(), userId, input),
  newsReset: (userId) => feed.newsReset(wdb(), userId),
  newsPodcastGet: (_userId, input) => podcast.newsPodcastGet(wdb(), input),
  newsPodcastGetDefault: (_userId, input) =>
    podcast.newsPodcastGetDefault(wdb(), input),
  newsPodcastList: (_userId, input) => podcast.newsPodcastList(wdb(), input),
  newsPodcastInit: () => Promise.resolve(podcast.newsPodcastInit()),
  newsPodcastRegenerate: (userId, input) =>
    podcast.newsPodcastRegenerate(userId, input),
  newsEmailPrefGet: (userId) => emailPref.newsEmailPrefGet(wdb(), userId),
  newsEmailPrefSet: (userId, input) =>
    emailPref.newsEmailPrefSet(wdb(), userId, input),
};

const app = createWorkersApp(
  { requests, messages },
  requestHandlers,
  collections,
  (cfg) => {
    cfg.setWorkers(cronTasks, createCronHandlers(wdb));
  },
);

// Route-checked push binding — the podcast-ready cron (createCronHandlers) sends
// via newsPush() on Workers too, where there's no setOnAfterStart.
setNewsPush((input) =>
  app.pushSend(input as Parameters<typeof app.pushSend>[0]),
);

export default app;
export { CollectionDO, SessionDO };
