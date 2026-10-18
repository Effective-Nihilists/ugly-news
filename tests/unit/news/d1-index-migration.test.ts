import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SqliteExec } from 'ugly-app/server';
import { newsIndexCleanup } from '../../../server/migrations-d1/002_news_index_cleanup';

/**
 * The cluster-assignment read (server/news/cluster.ts) was 98% of ugly-news's
 * D1 rows read in Sept-Oct 2026: prod EXPLAIN showed
 * `SEARCH newsCluster USING INDEX idx_newsCluster_category (<expr>=?)`, i.e.
 * every cluster in the desk (26.5k rows/call) to find the 72 h window.
 */

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      run(...params: unknown[]): unknown;
    };
  };
};

// The exact statement the framework emits for the assignment getQuery.
const ASSIGN_SQL = `SELECT _id, data, created, updated, version FROM "newsCluster" WHERE json_extract(data,'$.category') = ? AND json_extract(data,'$.lastUpdatedAt') >= ? ORDER BY (CAST(json_extract(data,'$.lastUpdatedAt') AS TEXT) IS NULL) DESC, CAST(json_extract(data,'$.lastUpdatedAt') AS TEXT) DESC LIMIT ?`;

function prodShapedDb() {
  const db = new DatabaseSync(':memory:');
  for (const t of ['newsCluster', 'file', 'newsArticle']) {
    db.exec(`CREATE TABLE "${t}" (_id TEXT PRIMARY KEY, data TEXT NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL)`);
  }
  // The indexes prod has today (sqlite_master, 2026-10-17).
  db.exec(
    `CREATE INDEX "idx_newsCluster_category" ON "newsCluster" ((json_extract(data,'$.category')))`,
  );
  db.exec(
    `CREATE INDEX "idx_newsCluster_lastUpdatedAt" ON "newsCluster" ((json_extract(data,'$.lastUpdatedAt')) DESC)`,
  );
  db.exec(
    `CREATE INDEX "idx_newsCluster_score" ON "newsCluster" ((json_extract(data,'$.score')) DESC)`,
  );
  db.exec(
    `CREATE INDEX "idx_file_created" ON "file" ((json_extract(data,'$.created')) DESC)`,
  );
  db.exec(
    `CREATE INDEX "idx_newsArticle_created" ON "newsArticle" ((json_extract(data,'$.created')) DESC)`,
  );
  db.exec(
    `CREATE INDEX "idx_newsArticle_scrapedAt" ON "newsArticle" ((json_extract(data,'$.scrapedAt')) DESC)`,
  );
  const exec: SqliteExec = {
    all: async <T>(sql: string, params: readonly unknown[] = []) =>
      db.prepare(sql).all(...params) as T[],
    run: async (sql: string, params: readonly unknown[] = []) => {
      db.prepare(sql).run(...params);
    },
  };
  const plan = () =>
    db
      .prepare(`EXPLAIN QUERY PLAN ${ASSIGN_SQL}`)
      .all('world', 0, 50)
      .map((r) => String(r.detail))
      .join(' | ');
  const indexes = () =>
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`,
      )
      .all()
      .map((r) => r.name);
  return { exec, plan, indexes };
}

describe('002_news_index_cleanup', () => {
  it('turns the assignment read into a category + lastUpdatedAt range', async () => {
    const t = prodShapedDb();
    expect(t.plan()).toContain(
      'USING INDEX idx_newsCluster_category (<expr>=?)',
    );
    await newsIndexCleanup.up(t.exec);
    expect(t.plan()).toContain(
      'USING INDEX idx_newsCluster_category_lastUpdatedAt (<expr>=? AND <expr>>?)',
    );
  });

  it('drops the superseded and never-usable indexes, and is idempotent', async () => {
    const t = prodShapedDb();
    await newsIndexCleanup.up(t.exec);
    await newsIndexCleanup.up(t.exec);
    expect(t.indexes()).toEqual([
      'idx_newsCluster_category_lastUpdatedAt',
      'idx_newsCluster_lastUpdatedAt',
    ]);
  });
});
