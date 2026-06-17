/**
 * Seed/verify data for app-store screenshots of the news feed and the 3D
 * podcast. See ugly-mobile/scripts/screenshots/SCREENSHOT.md.
 *
 * News content (the article feed and the daily `${date}_default` podcast) is
 * GLOBAL and produced by the app's crons — there is nothing per-user to fake,
 * and a podcast's audio/visemes can't be meaningfully fabricated. So this script:
 *  - Verifies the feed has recent published stories (the `file` markdown rows).
 *  - Verifies today's default podcast exists and finished generating
 *    (generationStatus = 'complete' + audioUri) so the 3D stage will play.
 *  - Seeds a few `userNewsSaved` rows for the screenshot user (pointed at the
 *    newest stories) so a saved/profile view also looks populated.
 *
 * The prod Neon connection is resolved the same way `ugly-app` publish does
 * (.uglyapp → publish-state.json), so no DATABASE_URL needs to be passed; set
 * one only to override. Requires SCREENSHOT_USER_ID.
 *
 * Run: SCREENSHOT_USER_ID="<id>" node_modules/.bin/tsx scripts/seed-screenshot-data.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdapter, query } from 'ugly-app/server';
import { dbDefaults } from 'ugly-app/shared';

/** Matches server/news/podcast.ts todayDateString — UTC YYYY-MM-DD. */
function todayDateString(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Resolve this project's prod Neon URL the way `ugly-app` publish does. */
function resolveProdDatabaseUrl(): string {
  if (process.env['DATABASE_URL']) return process.env['DATABASE_URL'];
  const { projectId } = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), '.uglyapp'), 'utf8'),
  ) as { projectId?: string };
  if (!projectId) throw new Error('.uglyapp has no projectId');
  const stateFile = path.join(os.homedir(), '.ugly-studio', 'projects', projectId, 'publish-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { neon?: { connectionString?: string } };
  const url = state.neon?.connectionString;
  if (!url) throw new Error(`No neon.connectionString in ${stateFile}`);
  return url;
}

async function main(): Promise<void> {
  const userId = process.env['SCREENSHOT_USER_ID'];
  if (!userId) throw new Error('SCREENSHOT_USER_ID not set');
  process.env['DATABASE_URL'] = resolveProdDatabaseUrl();

  createAdapter(); // Node adapter from process.env.DATABASE_URL

  // 1. Feed: confirm there are recent published markdown stories.
  const stories = await query<{ _id: string }>(
    `SELECT _id FROM "file"
       WHERE data->>'type' = 'markdown' AND data->>'feedId' IS NOT NULL
       ORDER BY created DESC LIMIT 8`,
  );
  if (stories.rows.length >= 3) {
    console.log(`[seed:news] feed OK: ${stories.rows.length} recent stories`);
  } else {
    console.warn(
      `[seed:news] WARNING: only ${stories.rows.length} stories found. The feed ` +
        `is filled by the hourly scraper cron — wait for it or trigger a fetch.`,
    );
  }

  // 2. Podcast: confirm today's default episode finished generating.
  const date = todayDateString(Date.now());
  const podcast = await query<{ status: string; audio: string }>(
    `SELECT data->>'generationStatus' AS status, data->>'audioUri' AS audio
       FROM "newsPodcast" WHERE _id = $1`,
    [`${date}_default`],
  );
  const pod = podcast.rows[0];
  if (pod?.status === 'complete' && pod.audio) {
    console.log(`[seed:news] podcast ready: ${date}_default`);
  } else {
    console.warn(
      `[seed:news] WARNING: podcast ${date}_default is ` +
        `${pod ? `'${pod.status}'` : 'missing'}. The 3D stage needs ` +
        `generationStatus='complete' + audioUri. Trigger the daily podcast ` +
        `generation on ugly.press before capturing the /podcast shot.`,
    );
  }

  // 3. Saved stories for the screenshot user (best-effort, points at newest).
  let saved = 0;
  for (const s of stories.rows.slice(0, 5)) {
    await query(
      `INSERT INTO "userNewsSaved" (_id, data, created, updated, version)
       VALUES ($1, $2::jsonb, now(), now(), 1)
       ON CONFLICT (_id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
      [
        `${userId}:${s._id}`,
        JSON.stringify({ userId, fileId: s._id, savedAt: Date.now(), ...dbDefaults() }),
      ],
    );
    saved++;
  }
  console.log(`[seed:news] seeded ${saved} saved stories`);

  console.log('[seed:news] done');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[seed:news] FAILED:', err);
    process.exit(1);
  },
);
