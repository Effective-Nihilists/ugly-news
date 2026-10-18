// Rolling retention for the unbounded, time-series news corpus.
//
// Every hourly feed refresh adds articles, files and clusters, so the daily
// cron prunes anything past its horizon. Without it the D1 database reached
// 4.95 GB by 2026-10-17 (D1 storage is billed past 5 GB per account) and every
// unindexed read got slower and dearer as the tables grew.
//
// Why raw SQL in bounded batches (and not `deleteQuery`):
// the framework's `deleteQuery` first SELECTs every matching doc in full, then
// deletes them one at a time, making one Vectorize call per file. The first
// real backlog (~65k files, ~150k articles, ~100k clusters) never finished: the
// 2026-10-14 10:01 UTC run died after 364 s with "D1_ERROR: Network connection
// lost" and nothing was pruned. Here every statement touches at most
// `batchSize` rows, selected by an indexed or rowid-ordered predicate, and the
// whole run stops at a time and batch budget. The caller re-enqueues a continuation
// (`pruneOldNewsStep`) while `done` is false, so a backlog drains across
// several bounded invocations instead of one unbounded one.
//
// Deleted rows are billed as rows written, so each row is deleted once: the
// horizons below are what the product reads, not a cap to be revisited.

import type { SqliteExec } from 'ugly-app/server';
import { withD1Retry } from './d1-retry';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The user-facing story archive (`file`): newsArchive browses and searches it. */
export const RETENTION_DAYS = 90;
export const RETENTION_MS = RETENTION_DAYS * DAY_MS;

/**
 * Raw ingest rows (`newsArticle`). Nothing user-facing lists them past the
 * scrape (the article page reads the `file`); they exist as the feed
 * download's dedupe ledger. download.ts skips feed items published before
 * this horizon, so an item still sitting in a feed is not re-ingested (and
 * re-scraped) after its ledger row is pruned.
 */
export const ARTICLE_RETENTION_DAYS = 30;
export const ARTICLE_RETENTION_MS = ARTICLE_RETENTION_DAYS * DAY_MS;

/** Multi-outlet story clusters: The Spread / archive, same horizon as files. */
export const CLUSTER_RETENTION_MS = RETENTION_MS;

/**
 * Single-article clusters. ~82% of all clusters are singletons, each carrying a
 * 9.5 KB centroid. A new article can only join a cluster inside the 72 h
 * assignment window, and the singleton never reaches Top Stories, Blindspot,
 * the email or the podcast (all require articleCount >= 2), so a week covers
 * the join window and the "full coverage" link from a fresh article.
 */
export const SINGLETON_CLUSTER_RETENTION_MS = 7 * DAY_MS;

export const DEFAULT_BATCH_SIZE = 200;
export const DEFAULT_BUDGET_MS = 60_000;
/**
 * Batches per invocation, independent of the clock. The first backlog drain
 * (deploy 1792287906020) deleted ~400k rows in ~2,000 statements inside ONE
 * queue invocation that never logged a finish: the 30 s CPU limit, not the
 * wall-clock budget, is what ends a long run, and a killed run records
 * nothing. 60 batches (12k rows) keeps a step far inside it.
 */
export const DEFAULT_MAX_BATCHES = 60;

/**
 * Vectorize rejects a larger delete: "VECTOR_DELETE_ERROR (code = 40007): too
 * many ids in payload; max id count is 100, got 200" (prod, 2026-10-18).
 */
export const VECTORIZE_MAX_DELETE_IDS = 100;

interface VectorDeleter {
  deleteByIds(name: string, ids: string[]): Promise<void>;
}

export interface RetentionDeps {
  exec: SqliteExec;
  /** Cloudflare Vectorize store. Absent in local dev without a binding. */
  vectors?: VectorDeleter | null | undefined;
  now: number;
  batchSize?: number;
  budgetMs?: number;
  /** Hard cap on select+delete batches per run (CPU bound, see above). */
  maxBatches?: number;
  /** Monotonic-enough clock for the budget (injectable for tests). */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RetentionResult {
  /** Rows deleted this run, per sweep. */
  deleted: Record<string, number>;
  /** False when the budget ran out with rows still past their horizon. */
  done: boolean;
}

/** Bind an id list as ONE JSON param (D1 caps bound variables at 100). */
const ID_SET = '(SELECT value FROM json_each(?))';

interface Sweep {
  name: string;
  /** Up to `limit` ids that are past their horizon. */
  select: (limit: number) => Promise<string[]>;
  /** Delete exactly these ids (and anything derived from them). */
  remove: (ids: string[]) => Promise<void>;
}

async function selectIds(
  exec: SqliteExec,
  sql: string,
  params: unknown[],
): Promise<string[]> {
  const rows = await exec.all<{ _id: string }>(sql, params);
  return rows.map((r) => r._id);
}

function deleteByIds(exec: SqliteExec, table: string, ids: string[]) {
  return exec.run(`DELETE FROM "${table}" WHERE _id IN ${ID_SET}`, [
    JSON.stringify(ids),
  ]);
}

function isMissingTable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /no such table/i.test(msg);
}

/**
 * Files that must outlive the 90-day window: every story a published podcast
 * episode links to (the podcast archive is kept forever) and every story a
 * reader saved. A transient failure here throws, so the file sweep is skipped
 * rather than run without its protection list.
 */
export async function protectedFileIds(exec: SqliteExec): Promise<string[]> {
  const out = new Set<string>();
  const queries = [
    `SELECT DISTINCT json_extract(a.value,'$.fileId') AS id
       FROM "newsPodcast" p, json_each(p.data,'$.articles') a`,
    `SELECT DISTINCT json_extract(data,'$.fileId') AS id FROM "userNewsSaved"`,
  ];
  for (const sql of queries) {
    try {
      const rows = await exec.all<{ id: unknown }>(sql);
      for (const r of rows) if (typeof r.id === 'string') out.add(r.id);
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  return [...out];
}

function buildSweeps(
  deps: RetentionDeps,
  run: <T>(op: () => Promise<T>) => Promise<T>,
): Sweep[] {
  const { exec, vectors, now } = deps;
  const fileCutoff = now - RETENTION_MS;
  const articleCutoff = now - ARTICLE_RETENTION_MS;
  const clusterCutoff = now - CLUSTER_RETENTION_MS;
  const singletonCutoff = now - SINGLETON_CLUSTER_RETENTION_MS;
  let keepFiles: string[] | null = null;

  return [
    // Legacy newsBot opening comments: one conversation (`_id` = the file id)
    // plus one message (`msg_<fileId>_0`) per scraped article. The writer was
    // removed in 497179f (nothing ever rendered them); 58,340 threads remained.
    // `_id` range scans on the primary key: no rows outside the prefix are read.
    {
      name: 'message',
      select: (limit) =>
        run(() =>
          selectIds(
            exec,
            `SELECT _id FROM "message" WHERE _id >= 'msg_file_' AND _id < 'msg_file\`' LIMIT ?`,
            [limit],
          ),
        ),
      remove: (ids) => run(() => deleteByIds(exec, 'message', ids)),
    },
    {
      name: 'conversation',
      select: (limit) =>
        run(() =>
          selectIds(
            exec,
            `SELECT _id FROM "conversation" WHERE _id >= 'file_' AND _id < 'file\`' LIMIT ?`,
            [limit],
          ),
        ),
      remove: (ids) => run(() => deleteByIds(exec, 'conversation', ids)),
    },
    // Clusters past the archive horizon: a range on idx_newsCluster_lastUpdatedAt.
    {
      name: 'newsCluster',
      select: (limit) =>
        run(() =>
          selectIds(
            exec,
            `SELECT _id FROM "newsCluster" WHERE json_extract(data,'$.lastUpdatedAt') < ? LIMIT ?`,
            [clusterCutoff, limit],
          ),
        ),
      remove: (ids) => run(() => deleteByIds(exec, 'newsCluster', ids)),
    },
    // Singletons past the join window (same index range, articleCount residual).
    {
      name: 'newsClusterSingleton',
      select: (limit) =>
        run(() =>
          selectIds(
            exec,
            `SELECT _id FROM "newsCluster"
              WHERE json_extract(data,'$.lastUpdatedAt') < ?
                AND COALESCE(json_extract(data,'$.articleCount'), 0) < 2
              LIMIT ?`,
            [singletonCutoff, limit],
          ),
        ),
      remove: (ids) => run(() => deleteByIds(exec, 'newsCluster', ids)),
    },
    // `created` is the item's PUBLISH date (download.ts), so a 2006 item an
    // outlet re-served is old here even though it was inserted this year.
    {
      name: 'newsArticle',
      select: (limit) =>
        run(() =>
          selectIds(
            exec,
            `SELECT _id FROM "newsArticle" WHERE created < ? LIMIT ?`,
            [articleCutoff, limit],
          ),
        ),
      remove: (ids) => run(() => deleteByIds(exec, 'newsArticle', ids)),
    },
    // Files also own an FTS5 mirror (file_fts + file_ftsid) and a Vectorize
    // vector. Derived rows go first and the row itself last, so a failure
    // part-way leaves the row matching and the next batch redoes the rest.
    {
      name: 'file',
      select: async (limit) => {
        keepFiles ??= await run(() => protectedFileIds(exec));
        return run(() =>
          selectIds(
            exec,
            `SELECT _id FROM "file" WHERE created < ? AND _id NOT IN ${ID_SET} LIMIT ?`,
            [fileCutoff, JSON.stringify(keepFiles), limit],
          ),
        );
      },
      remove: async (ids) => {
        const idsJson = JSON.stringify(ids);
        await run(async () => {
          try {
            await exec.run(
              `DELETE FROM "file_fts" WHERE rowid IN (SELECT rid FROM "file_ftsid" WHERE _id IN ${ID_SET})`,
              [idsJson],
            );
            await exec.run(`DELETE FROM "file_ftsid" WHERE _id IN ${ID_SET}`, [
              idsJson,
            ]);
          } catch (error) {
            if (!isMissingTable(error)) throw error;
          }
        });
        if (vectors) {
          for (let i = 0; i < ids.length; i += VECTORIZE_MAX_DELETE_IDS) {
            await vectors.deleteByIds(
              'file',
              ids.slice(i, i + VECTORIZE_MAX_DELETE_IDS),
            );
          }
        }
        await run(() => deleteByIds(exec, 'file', ids));
      },
    },
  ];
}

/**
 * Delete everything past its horizon, in batches, until done or out of budget.
 * Idempotent: after the backlog is gone a daily run only removes the rows that
 * newly aged out. Sweeps are independent; a sweep that fails is reported in
 * the thrown error after the others have run, so the worker-run record and the
 * errorLog show what was left behind.
 */
export async function runNewsRetention(
  deps: RetentionDeps,
): Promise<RetentionResult> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  let batches = 0;
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const run = <T>(op: () => Promise<T>) =>
    withD1Retry(op, deps.sleep ? { sleep: deps.sleep } : {});

  const deleted: Record<string, number> = {};
  const failures: string[] = [];
  let done = true;

  for (const sweep of buildSweeps(deps, run)) {
    let count = 0;
    try {
      for (;;) {
        if (clock() - started >= budgetMs || batches >= maxBatches) {
          done = false;
          break;
        }
        const ids = await sweep.select(batchSize);
        if (ids.length > 0) {
          batches += 1;
          await sweep.remove(ids);
          count += ids.length;
        }
        if (ids.length < batchSize) break;
      }
    } catch (error) {
      failures.push(
        `${sweep.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    deleted[sweep.name] = count;
    if (!done) break;
  }

  console.log(
    `[retention] deleted ${JSON.stringify(deleted)} in ${clock() - started} ms, done=${done}`,
  );
  if (failures.length > 0) {
    throw new Error(
      `[retention] ${failures.length} prune sweep(s) failed after retries: ${failures.join('; ')}`,
    );
  }
  return { deleted, done };
}
