import type { query as pgQuery } from 'ugly-app/server';

// Retention support — index the system `created` column on the two unbounded,
// time-series collections the daily `pruneOldNews` cron sweeps by age
// (see server/news/retention.ts). deleteQuery does not ASSERT on an unindexed
// filter, so the prune works without this, but the index backs the
// `created < cutoff` scan (perf) and any future getDocs-by-recency (D1 requires
// an index for filtered getDocs). newsCluster is pruned by `lastUpdatedAt`,
// which already has an index (see shared/collections.ts).
//
// `created` is a real TIMESTAMPTZ column (framework system column), so these are
// plain btree indexes on the column — not JSONB expression indexes. Small row
// counts (~45k) make CREATE INDEX effectively instantaneous.

export async function up(query: typeof pgQuery): Promise<void> {
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_newsArticle_created" ON "newsArticle" (created DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_file_created" ON "file" (created DESC)`,
  );
}
