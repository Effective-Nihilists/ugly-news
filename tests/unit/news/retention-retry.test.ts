import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SqliteExec } from 'ugly-app/server';
import {
  ARTICLE_RETENTION_MS,
  RETENTION_MS,
  SINGLETON_CLUSTER_RETENTION_MS,
  runNewsRetention,
} from '../../../server/news/retention';

/**
 * Production evidence: the old prune (framework deleteQuery: read every match,
 * delete one by one, one Vectorize call per file) never finished. The
 * 2026-10-14 10:01 UTC run died after 364 s with "D1_ERROR: Network connection
 * lost" and the database reached 4.95 GB. These tests run the real SQL against
 * SQLite tables shaped exactly like prod's D1 (incl. the FTS5 mirror).
 */

// node:sqlite is loaded at runtime: Vite's resolver does not know the builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      run(...params: unknown[]): unknown;
    };
  };
};

const NOW = 1_792_300_000_000;
const DAY = 24 * 60 * 60 * 1000;
const TABLES = [
  'file',
  'newsArticle',
  'newsCluster',
  'conversation',
  'message',
  'newsPodcast',
  'userNewsSaved',
];

function makeDb() {
  const db = new DatabaseSync(':memory:');
  for (const t of TABLES) {
    db.exec(`CREATE TABLE "${t}" (_id TEXT PRIMARY KEY, data TEXT NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL)`);
  }
  db.exec(
    `CREATE INDEX "idx_newsCluster_lastUpdatedAt" ON "newsCluster" ((json_extract(data,'$.lastUpdatedAt')) DESC)`,
  );
  db.exec(
    `CREATE VIRTUAL TABLE "file_fts" USING fts5(_id UNINDEXED, "title", "text")`,
  );
  db.exec(
    `CREATE TABLE "file_ftsid" (rid INTEGER PRIMARY KEY, _id TEXT NOT NULL UNIQUE)`,
  );
  const statements: string[] = [];
  const exec: SqliteExec = {
    all: async <T>(sql: string, params: readonly unknown[] = []) => {
      statements.push(sql);
      return db.prepare(sql).all(...params) as T[];
    },
    run: async (sql: string, params: readonly unknown[] = []) => {
      statements.push(sql);
      db.prepare(sql).run(...params);
    },
  };
  const insert = (t: string, id: string, data: object, created: number) =>
    db
      .prepare(`INSERT INTO "${t}" VALUES (?, ?, ?, ?, 1)`)
      .run(id, JSON.stringify(data), created, created);
  const ids = (t: string) =>
    db
      .prepare(`SELECT _id FROM "${t}" ORDER BY _id`)
      .all()
      .map((r) => r._id);
  const addFile = (id: string, created: number) => {
    insert('file', id, { title: id, text: 'body' }, created);
    db.prepare(`INSERT INTO "file_ftsid" (_id) VALUES (?)`).run(id);
    const rid = db
      .prepare(`SELECT rid FROM "file_ftsid" WHERE _id = ?`)
      .all(id)[0]?.rid;
    db.prepare(
      `INSERT INTO "file_fts" (rowid, _id, title, text) VALUES (?, ?, ?, 'body')`,
    ).run(rid, id, id);
  };
  return { db, exec, insert, ids, addFile, statements };
}

function vectorSpy() {
  const deleted: string[] = [];
  return {
    deleted,
    vectors: {
      deleteByIds: async (name: string, ids: string[]) => {
        expect(name).toBe('file');
        deleted.push(...ids);
      },
    },
  };
}

describe('runNewsRetention', () => {
  it('deletes each collection past its own horizon and keeps the rest', async () => {
    const t = makeDb();
    const old = NOW - RETENTION_MS - DAY;
    const fresh = NOW - DAY;
    t.addFile('file_old', old);
    t.addFile('file_new', fresh);
    t.addFile('file_podcast', old);
    t.addFile('file_saved', old);
    t.insert(
      'newsPodcast',
      '2026-07-01_default',
      { articles: [{ fileId: 'file_podcast' }] },
      old,
    );
    t.insert(
      'userNewsSaved',
      'u_file_saved',
      { userId: 'u', fileId: 'file_saved' },
      old,
    );
    t.insert('newsArticle', 'a_old', {}, NOW - ARTICLE_RETENTION_MS - DAY);
    t.insert('newsArticle', 'a_new', {}, fresh);
    t.insert(
      'newsCluster',
      'c_ancient_multi',
      { lastUpdatedAt: old, articleCount: 5 },
      old,
    );
    t.insert(
      'newsCluster',
      'c_multi',
      { lastUpdatedAt: NOW - 30 * DAY, articleCount: 3 },
      old,
    );
    t.insert(
      'newsCluster',
      'c_single_old',
      {
        lastUpdatedAt: NOW - SINGLETON_CLUSTER_RETENTION_MS - DAY,
        articleCount: 1,
      },
      old,
    );
    t.insert(
      'newsCluster',
      'c_single_new',
      { lastUpdatedAt: fresh, articleCount: 1 },
      fresh,
    );
    t.insert('conversation', 'file_old', { type: 'news' }, fresh);
    t.insert('conversation', 'user_thread', { type: 'ai-chat' }, fresh);
    t.insert(
      'message',
      'msg_file_old_0',
      { conversationId: 'file_old' },
      fresh,
    );
    t.insert('message', 'msg_user_1', { conversationId: 'user_thread' }, fresh);
    const v = vectorSpy();

    const result = await runNewsRetention({
      exec: t.exec,
      vectors: v.vectors,
      now: NOW,
    });

    expect(result.done).toBe(true);
    expect(t.ids('file')).toEqual(['file_new', 'file_podcast', 'file_saved']);
    expect(t.ids('file_ftsid')).toEqual([
      'file_new',
      'file_podcast',
      'file_saved',
    ]);
    expect(
      t.db
        .prepare(`SELECT _id FROM file_fts ORDER BY _id`)
        .all()
        .map((r) => r._id),
    ).toEqual(['file_new', 'file_podcast', 'file_saved']);
    expect(v.deleted).toEqual(['file_old']);
    expect(t.ids('newsArticle')).toEqual(['a_new']);
    expect(t.ids('newsCluster')).toEqual(['c_multi', 'c_single_new']);
    expect(t.ids('conversation')).toEqual(['user_thread']);
    expect(t.ids('message')).toEqual(['msg_user_1']);
    expect(result.deleted).toMatchObject({
      message: 1,
      conversation: 1,
      newsCluster: 1,
      newsClusterSingleton: 1,
      newsArticle: 1,
      file: 1,
    });
  });

  it('works in batches and never deletes more than one batch per statement', async () => {
    const t = makeDb();
    for (let i = 0; i < 25; i++) {
      t.insert(
        'newsArticle',
        `a${String(i).padStart(2, '0')}`,
        {},
        NOW - ARTICLE_RETENTION_MS - DAY,
      );
    }
    const deletes: number[] = [];
    const exec: SqliteExec = {
      all: t.exec.all,
      run: async (sql, params = []) => {
        if (sql.startsWith('DELETE FROM "newsArticle"')) {
          deletes.push((JSON.parse(String(params[0])) as string[]).length);
        }
        await t.exec.run(sql, params);
      },
    };
    const result = await runNewsRetention({ exec, now: NOW, batchSize: 10 });
    expect(deletes).toEqual([10, 10, 5]);
    expect(t.ids('newsArticle')).toEqual([]);
    expect(result).toMatchObject({ done: true, deleted: { newsArticle: 25 } });
  });

  it('stops at the time budget and reports not done so the caller chains a step', async () => {
    const t = makeDb();
    for (let i = 0; i < 30; i++) {
      t.insert('message', `msg_file_${String(i).padStart(2, '0')}_0`, {}, NOW);
    }
    let tick = 0;
    const result = await runNewsRetention({
      exec: t.exec,
      now: NOW,
      batchSize: 10,
      budgetMs: 2,
      clock: () => tick++,
    });
    expect(result.done).toBe(false);
    expect(result.deleted.message).toBe(10);
    expect(t.ids('message')).toHaveLength(20);
  });

  it('caps batches per run regardless of the clock (CPU-bound queue step)', async () => {
    const t = makeDb();
    for (let i = 0; i < 50; i++) {
      t.insert(
        'newsArticle',
        `a${String(i).padStart(2, '0')}`,
        {},
        NOW - ARTICLE_RETENTION_MS - DAY,
      );
    }
    const result = await runNewsRetention({
      exec: t.exec,
      now: NOW,
      batchSize: 10,
      maxBatches: 3,
      clock: () => 0,
    });
    expect(result.done).toBe(false);
    expect(result.deleted.newsArticle).toBe(30);
    expect(t.ids('newsArticle')).toHaveLength(20);
  });

  it('retries a lost connection, keeps going on a failing sweep, then reports it', async () => {
    const t = makeDb();
    t.insert('newsArticle', 'a_old', {}, NOW - ARTICLE_RETENTION_MS - DAY);
    t.insert('newsCluster', 'c_old', { lastUpdatedAt: 1, articleCount: 4 }, 1);
    let lost = 1;
    const exec: SqliteExec = {
      all: async (sql, params) => {
        if (sql.includes('FROM "message"') && lost-- > 0) {
          throw new Error('D1_ERROR: Network connection lost.');
        }
        if (sql.includes('FROM "conversation"')) {
          throw new TypeError('deterministic failure');
        }
        return t.exec.all(sql, params);
      },
      run: t.exec.run,
    };
    await expect(
      runNewsRetention({ exec, now: NOW, sleep: async () => {} }),
    ).rejects.toThrow(
      /1 prune sweep\(s\) failed after retries: conversation: deterministic failure/,
    );
    // The other sweeps still ran.
    expect(t.ids('newsArticle')).toEqual([]);
    expect(t.ids('newsCluster')).toEqual([]);
  });

  it('skips the file sweep when its protection list cannot be read', async () => {
    const t = makeDb();
    t.addFile('file_old', NOW - RETENTION_MS - DAY);
    const exec: SqliteExec = {
      all: async (sql, params) => {
        if (sql.includes('"newsPodcast"')) throw new Error('SQLITE_BUSY');
        return t.exec.all(sql, params);
      },
      run: t.exec.run,
    };
    await expect(runNewsRetention({ exec, now: NOW })).rejects.toThrow(
      /file: SQLITE_BUSY/,
    );
    expect(t.ids('file')).toEqual(['file_old']);
  });

  it('uses only bounded, indexed or primary-key predicates', async () => {
    const t = makeDb();
    await runNewsRetention({ exec: t.exec, now: NOW });
    const selects = t.statements.filter((s) => s.startsWith('SELECT _id FROM'));
    for (const sql of selects) expect(sql).toMatch(/LIMIT \?$/);
    const plan = t.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT _id FROM "newsCluster" WHERE json_extract(data,'$.lastUpdatedAt') < ? LIMIT ?`,
      )
      .all(1, 1)
      .map((r) => String(r.detail));
    expect(plan.join(' ')).toMatch(/USING INDEX idx_newsCluster_lastUpdatedAt/);
    const msgPlan = t.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT _id FROM "message" WHERE _id >= 'msg_file_' AND _id < 'msg_file\`' LIMIT ?`,
      )
      .all(1)
      .map((r) => String(r.detail));
    expect(msgPlan.join(' ')).toMatch(
      /SEARCH message USING (COVERING )?INDEX sqlite_autoindex_message_1 \(_id>\? AND _id<\?\)/,
    );
  });
});
