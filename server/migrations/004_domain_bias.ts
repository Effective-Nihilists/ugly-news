import type { query as pgQuery } from 'ugly-app/server';

// `domainBias` — IDIAP MBFC domain→bias/factuality ratings (~3,920 rows). Created
// empty here; the DATA is loaded straight into Neon out-of-band (NOT committed to
// git) and refreshed by re-running the loader. Keyed by bare domain (_id).
export async function up(query: typeof pgQuery): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS "domainBias" (
    _id         TEXT PRIMARY KEY,
    bias        TEXT,
    bias_score  DOUBLE PRECISION,
    factuality  TEXT,
    updated     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}
