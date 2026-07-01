import type { query as pgQuery } from 'ugly-app/server';

// "Three Ways" rewrite — adds the source bias registry + story-cluster tables.
// Plain JSONB-backed tables (same shape as 002_news.ts); the cluster centroid is
// a plain JSON array (not a pgvector column) since assignment scans a small
// active window in TS. newsSource rows are seeded at startup from
// shared/news/sourceBias.ts, so this migration only creates the schema.

const TABLES = ['newsSource', 'newsCluster'];

export async function up(query: typeof pgQuery): Promise<void> {
  for (const t of TABLES) {
    await query(`CREATE TABLE IF NOT EXISTS "${t}" (
      _id      TEXT PRIMARY KEY,
      data     JSONB NOT NULL,
      created  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
      version  INTEGER NOT NULL DEFAULT 1
    )`);
    await query(`CREATE INDEX IF NOT EXISTS "idx_${t}_data" ON "${t}" USING GIN (data)`);
  }

  // Hot-path expression indexes for the cluster queries (Top Stories, Blindspot,
  // per-category browse).
  await query(`CREATE INDEX IF NOT EXISTS "idx_newsCluster_category" ON "newsCluster" ((data->>'category'))`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_newsCluster_blindspotSide" ON "newsCluster" ((data->>'blindspotSide'))`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_newsCluster_lastUpdatedAt" ON "newsCluster" (((data->>'lastUpdatedAt')::bigint))`);
  await query(`CREATE INDEX IF NOT EXISTS "idx_newsCluster_score" ON "newsCluster" (((data->>'score')::double precision))`);

  // file.clusterId — used to find a story's cluster from the article page.
  await query(`CREATE INDEX IF NOT EXISTS "idx_file_clusterId" ON "file" ((data->>'clusterId'))`);
}
