import type { D1Migration } from 'ugly-app/server';

/**
 * Index changes that `shared/collections.ts` cannot express on its own: the
 * framework only ever CREATEs declared indexes, so one removed from a
 * declaration stays in D1 and keeps costing a billed row write per upsert.
 *
 * - Builds idx_newsCluster_category_lastUpdatedAt here (same DDL the framework
 *   emits for the declaration) so the first request after deploy does not pay
 *   for it. It turns the cluster-assignment read from every cluster in the
 *   category (26.5k rows/call) into the ~72 h range.
 * - Drops the category-only index it supersedes, the never-usable score index
 *   (D1 sorts cannot use an index), and the `created` indexes, which index
 *   json_extract(data,'$.created'): `created` is a top-level column, so every
 *   entry was NULL. idx_newsArticle_scrapedAt had no reader.
 *
 * Idempotent: IF [NOT] EXISTS on every statement.
 */
export const newsIndexCleanup: D1Migration = {
  name: '002_news_index_cleanup',
  up: async (exec) => {
    await exec.run(
      `CREATE INDEX IF NOT EXISTS "idx_newsCluster_category_lastUpdatedAt" ON "newsCluster" ((json_extract(data,'$.category')), (json_extract(data,'$.lastUpdatedAt')) DESC)`,
    );
    for (const name of [
      'idx_newsCluster_category',
      'idx_newsCluster_score',
      'idx_file_created',
      'idx_newsArticle_created',
      'idx_newsArticle_scrapedAt',
    ]) {
      await exec.run(`DROP INDEX IF EXISTS "${name}"`);
    }
  },
};
