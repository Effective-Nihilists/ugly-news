import type { D1Migration } from 'ugly-app/server';
import { enqueueTask } from '../news/queue';

/**
 * Restart the backlog drain. The chain 001 started was killed part-way (one
 * unbounded-by-CPU invocation; see DEFAULT_MAX_BATCHES in retention.ts): the
 * bot threads, clusters and raw articles were cleared, the ~59k files past
 * 90 days were not. Steps are now batch-capped, so this chain completes.
 */
export const newsRetentionResume: D1Migration = {
  name: '003_news_retention_resume',
  up: async () => {
    await enqueueTask('pruneOldNewsStep', { round: 1 });
  },
};
