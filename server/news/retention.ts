// Rolling retention for the unbounded, time-series news corpus.
//
// News content grows forever (every hourly feed refresh adds articles, files,
// and clusters), so we enforce a rolling window and let the daily cron prune
// anything older than it. This keeps the database bounded and, crucially, well
// under Cloudflare D1's 10 GB ceiling for the upcoming D1 migration.
//
// D1-safe by construction: pruning uses ONLY the typed framework API
// (`deleteQuery` with a `$lt` epoch filter) — no `pgQuery` / raw SQL — so it
// keeps working unchanged after the Neon→D1 cutover. `created`/`updated` are the
// framework-maintained system columns; an epoch-ms number binds correctly on
// both Postgres (coerced number→timestamp) and D1.

import { collections } from '../../shared/collections';
import type { NewsDb } from './db';

/** Rolling retention window. Content older than this is pruned by the daily cron. */
export const RETENTION_DAYS = 90;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Prune every unbounded article-derived time-series collection older than the
 * retention cutoff. Idempotent — safe to run on any schedule; after the first
 * sweep each run only clears the rows that newly aged past the window.
 *
 * PRUNED (grows without bound):
 *  - newsArticle — raw scraped articles, by system `created` (scrape/insert time).
 *  - file        — user-facing markdown articles + their FTS/pgvector rows, by
 *                  system `created`. (On D1+Vectorize the row delete will NOT
 *                  remove the external Vectorize vector — see migration note.)
 *  - newsCluster — story clusters, by domain `lastUpdatedAt` (bumped as fresh
 *                  coverage arrives, so a still-active cluster is retained even
 *                  if it was first seen >90d ago).
 *
 * NOT pruned by age (durable config + user state):
 *  - newsFeed, newsSource            — registry/config, read every request.
 *  - newsPodcast                     — the daily podcast archive (kept).
 *  - userNews* / userFilePreference  — per-user bookmarks, reads, reactions,
 *                                      follows, prefs, email prefs.
 */
export async function runNewsRetention(db: NewsDb, now: number): Promise<void> {
  const cutoff = now - RETENTION_MS;
  await db.deleteQuery(collections.newsArticle, { created: { $lt: cutoff } });
  await db.deleteQuery(collections.file, { created: { $lt: cutoff } });
  await db.deleteQuery(collections.newsCluster, { lastUpdatedAt: { $lt: cutoff } });
}
