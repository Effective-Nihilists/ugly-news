import type { WorkerHandlers } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { cronTasks } from '../../shared/cron';
import type { NewsDb } from './db';
import { dispatchNewsFeedDownload, findFeed, newsRefreshAllFeeds } from './download';
import { enqueueTask } from './queue';
import { todayDateString } from './podcast';

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
      // Phase 7: query users at 8am-local and enqueue userPrivateNewsEmail jobs.
      // TODO(Phase 7): implement timezone-aware fan-out.
    },

    // ── Queue-only jobs ──────────────────────────────────────────────────
    newsFeedDownload: async ({ feedId }) => {
      const feed = findFeed(feedId);
      if (feed) await dispatchNewsFeedDownload(getDb(), feed);
    },
    articleScrape: async ({ articleId }) => {
      // Phase 2b: scrape + summarize + image + create file + bot comment.
      // TODO(Phase 2b): const { dispatchArticleScrape } = await import('./scraper');
      console.warn('[news] articleScrape not yet implemented', articleId);
    },
    podcastGenerate: async ({ date, userId, replaceDefault }) => {
      // Phase 5: script + InWorld TTS + WAV + record.
      console.warn('[news] podcastGenerate not yet implemented', { date, userId, replaceDefault });
    },
    userPrivateNewsEmail: async ({ userId, now }) => {
      // Phase 7: render + send the daily email.
      console.warn('[news] userPrivateNewsEmail not yet implemented', { userId, now });
    },
  };
}
