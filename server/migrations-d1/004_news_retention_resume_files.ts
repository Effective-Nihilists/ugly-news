import type { D1Migration } from 'ugly-app/server';
import { enqueueTask } from '../news/queue';

/**
 * Restart the drain for the file sweep. The chain 003 started failed on its
 * first file batch: Vectorize rejects a delete of more than 100 ids ("code =
 * 40007 ... max id count is 100, got 200"), so the queue retried and dropped
 * it. Vector deletes are now chunked to 100.
 */
export const newsRetentionResumeFiles: D1Migration = {
  name: '004_news_retention_resume_files',
  up: async () => {
    await enqueueTask('pruneOldNewsStep', { round: 1 });
  },
};
