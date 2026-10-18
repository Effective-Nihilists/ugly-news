import type { D1Migration } from 'ugly-app/server';
import { enqueueTask } from '../news/queue';

/**
 * Start draining the retention backlog at deploy instead of at the next
 * 10:00 UTC cron. The prune never completed before the batched rewrite (the
 * 2026-10-14 run died after 364 s), so ~65k files, ~150k raw articles, ~100k
 * clusters and 58k dead bot-comment threads were past their horizon. This only
 * enqueues the first `pruneOldNewsStep`; each step is time-budgeted and chains
 * the next while rows remain. Re-running it (a failed `/_init`) starts a second
 * chain over the same rows, which converges: every step re-selects by horizon.
 */
export const newsRetentionBacklog: D1Migration = {
  name: '001_news_retention_backlog',
  up: async () => {
    await enqueueTask('pruneOldNewsStep', { round: 1 });
  },
};
