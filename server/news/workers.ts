import type { WorkerHandlers } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { cronTasks } from '../../shared/cron';
import type { NewsDb } from './db';
import { dispatchNewsFeedDownload, findFeed, newsRefreshAllFeeds } from './download';
import { enqueueTask } from './queue';
import { todayDateString } from './podcast';
import { dispatchArticleScrape } from './scraper';
import { dispatchPodcastGenerate } from './podcast-generate';
import { dispatchUserPrivateNewsEmail, userEmailHourly } from './email';

// Build the worker handler map. Shared by the Node entry (server/index.ts) and
// the Cloudflare Workers entry (server/workers.ts) so cron + queue behavior is
// identical across runtimes.
export function createCronHandlers(getDb: () => NewsDb): WorkerHandlers<typeof cronTasks> {
  return {
    // ── Scheduled ──────────────────────────────────────────────────────────
    newsHourly: async () => {
      await newsRefreshAllFeeds();
    },
    podcastDaily: async () => {
      const date = todayDateString(Date.now());
      const existing = await getDb().getDoc(collections.newsPodcast, `${date}_default`);
      if (existing) return;
      await enqueueTask('podcastGenerate', { date, userId: null, replaceDefault: true });
    },
    userEmailHourly: async () => {
      await userEmailHourly(getDb(), Date.now());
    },

    // ── Queue-only jobs ──────────────────────────────────────────────────
    newsFeedDownload: async ({ feedId }) => {
      const feed = findFeed(feedId);
      if (feed) await dispatchNewsFeedDownload(getDb(), feed);
    },
    articleScrape: async ({ articleId }) => {
      await dispatchArticleScrape(getDb(), articleId);
      // Phase 3 wires the newsBot conversation/comment for this article's file.
    },
    podcastGenerate: async ({ date, userId, replaceDefault }) => {
      await dispatchPodcastGenerate(getDb(), { date, userId, replaceDefault });
    },
    userPrivateNewsEmail: async ({ userId, now }) => {
      await dispatchUserPrivateNewsEmail(getDb(), { userId, now });
    },
  };
}
