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
import { withD1Retry } from './d1-retry';

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
 *  - file        — user-facing markdown articles + their FTS/vector rows, by
 *                  system `created`. On D1 the framework's deleteQuery fans out
 *                  per-doc to Vectorize (deleteVector → deleteByIds), so the
 *                  external vector is removed with the row — no orphans.
 *  - newsCluster — story clusters, by domain `lastUpdatedAt` (bumped as fresh
 *                  coverage arrives, so a still-active cluster is retained even
 *                  if it was first seen >90d ago).
 *
 * NOT pruned by age (durable config + user state):
 *  - newsFeed, newsSource            — registry/config, read every request.
 *  - newsPodcast                     — the daily podcast archive (kept).
 *  - userNews* / userFilePreference  — per-user bookmarks, reads, reactions,
 *                                      follows, prefs, email prefs.
 *
 * Each sweep runs under `withD1Retry`: a cron task gets no platform retry (the
 * scheduled() dispatcher logs a failure once and the next chance is tomorrow),
 * and the 2026-10-10 10:04 UTC run died on its first statement with
 * "D1_ERROR: Network connection lost", a transport blip the next attempt
 * survives. The three sweeps are independent, so one collection's failure no
 * longer skips the others; the run still throws at the end so the worker-run
 * record and the errorLog show what was left behind.
 */
export async function runNewsRetention(
  db: NewsDb,
  now: number,
  deps: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const cutoff = now - RETENTION_MS;
  const sweeps: [string, () => Promise<unknown>][] = [
    [
      'newsArticle',
      () =>
        db.deleteQuery(collections.newsArticle, { created: { $lt: cutoff } }),
    ],
    [
      'file',
      () => db.deleteQuery(collections.file, { created: { $lt: cutoff } }),
    ],
    [
      'newsCluster',
      () =>
        db.deleteQuery(collections.newsCluster, {
          lastUpdatedAt: { $lt: cutoff },
        }),
    ],
  ];
  const failures: string[] = [];
  for (const [name, sweep] of sweeps) {
    try {
      await withD1Retry(sweep, deps);
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `[retention] ${failures.length}/${sweeps.length} prune sweeps failed after retries: ${failures.join('; ')}`,
    );
  }
}
