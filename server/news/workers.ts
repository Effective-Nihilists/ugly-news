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
import { runNewsRetention } from './retention';
import {
  dispatchClusterSatirize,
  dispatchClusterSweep,
  dispatchClusterSweepStep,
  dispatchClusterSynthesize,
} from './cluster-jobs';

// Build the worker handler map. Shared by the Node entry (server/index.ts) and
// the Cloudflare Workers entry (server/workers.ts) so cron + queue behavior is
// identical across runtimes.
export function createCronHandlers(getDb: () => NewsDb): WorkerHandlers<typeof cronTasks> {
  return {
    // ── Scheduled ──────────────────────────────────────────────────────────
    newsHourly: async () => {
      await newsRefreshAllFeeds();
      // Backstop: the standalone clusterSweep cron TRIGGER doesn't fire in prod
      // (only the pre-existing hourly schedule does), so drive it from here too.
      // Best-effort — a failure must not abort the feed refresh.
      await dispatchClusterSweep(getDb()).catch((e: unknown) => { console.error('[news] clusterSweep (hourly) failed', e); });
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
    clusterSweep: async () => {
      await dispatchClusterSweep(getDb());
    },
    pruneOldNews: async () => {
      await runNewsRetention(getDb(), Date.now());
    },

    // ── Queue-only jobs ──────────────────────────────────────────────────
    newsFeedDownload: async ({ feedId }) => {
      const feed = findFeed(feedId);
      if (feed) await dispatchNewsFeedDownload(getDb(), feed);
    },
    clusterSweepStep: async ({ queue }) => {
      await dispatchClusterSweepStep(getDb(), queue);
    },
    clusterSynthesize: async ({ clusterId }) => {
      await dispatchClusterSynthesize(getDb(), clusterId);
    },
    clusterSatirize: async ({ clusterId }) => {
      await dispatchClusterSatirize(getDb(), clusterId);
    },
    articleScrape: async ({ articleId }) => {
      await dispatchArticleScrape(getDb(), articleId);
      // Cluster similarity-calibration is emitted as `[cluster-sim]` console
      // lines during assignment (Workers logging barrel isn't bundle-safe here).
    },
    podcastGenerate: async ({ date, userId, replaceDefault }) => {
      await dispatchPodcastGenerate(getDb(), { date, userId, replaceDefault });
    },
    userPrivateNewsEmail: async ({ userId, now }) => {
      await dispatchUserPrivateNewsEmail(getDb(), { userId, now });
    },
  };
}
