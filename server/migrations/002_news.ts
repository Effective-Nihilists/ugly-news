import type { query as pgQuery } from 'ugly-app/server';

// News collections — creates tables + indexes for the migrated news feature.
// Mirrors the bootstrap pattern (one JSONB-backed table per collection) plus a
// few expression indexes for the hot feed / email / saved queries.

const TABLES = [
  'newsFeed',
  'newsArticle',
  'file',
  'userFilePreference',
  'newsPodcast',
  'userNewsRead',
  'userNewsSaved',
  'userNewsReaction',
  'userNewsSourceFollow',
  'userNewsPreference',
  'userNewsEmailPref',
];

export async function up(query: typeof pgQuery): Promise<void> {
  for (const t of TABLES) {
    await query(`CREATE TABLE IF NOT EXISTS "${t}" (
      _id      TEXT PRIMARY KEY,
      data     JSONB NOT NULL,
      created  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
      version  INTEGER NOT NULL DEFAULT 1
    )`);
    await query(
      `CREATE INDEX IF NOT EXISTS "idx_${t}_data" ON "${t}" USING GIN (data)`,
    );
  }

  // Hot-path expression indexes (JSONB field accessors used by the feed/email).
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_file_type" ON "file" ((data->>'type'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_file_feedId" ON "file" ((data->>'feedId'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_file_userId" ON "file" ((data->>'userId'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_newsArticle_feedId" ON "newsArticle" ((data->>'feedId'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_userNewsRead_userId" ON "userNewsRead" ((data->>'userId'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_userNewsSaved_userId" ON "userNewsSaved" ((data->>'userId'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_userNewsReaction_userId" ON "userNewsReaction" ((data->>'userId'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_userNewsSourceFollow_userId" ON "userNewsSourceFollow" ((data->>'userId'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_newsPodcast_date" ON "newsPodcast" ((data->>'date'))`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_userNewsEmailPref_timezone" ON "userNewsEmailPref" ((data->>'timezone'))`,
  );
}
