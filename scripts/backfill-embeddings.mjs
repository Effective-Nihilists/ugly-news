// One-time backfill: embed every news `file` (title + text) with OpenAI
// text-embedding-3-small @ 512 dims and write it into the pgvector `embedding`
// column (matches the collection's declared vector { dimensions: 512 }).
//
// Run from repo root:
//   OPENAI_API_KEY=... node scripts/backfill-embeddings.mjs
// (the connection string is read from /tmp/news-conn.txt — the prod Neon DB)
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error('OPENAI_API_KEY required'); process.exit(1); }

const sql = neon(readFileSync('/tmp/news-conn.txt', 'utf8').trim());
const MODEL = 'text-embedding-3-small';
const DIMS = 512;
const BATCH = 200; // OpenAI inputs per request

/** Embed an array of strings → array of 512-dim vectors (vector literals). */
async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMS }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  // data is returned in input order; map to pgvector literal strings.
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => `[${d.embedding.join(',')}]`);
}

let done = 0;
const t0 = Date.now();
for (;;) {
  const rows = await sql.query(
    `SELECT _id,
            coalesce(data->>'title','') AS title,
            coalesce(data->>'text','')  AS text
     FROM "file"
     WHERE data->>'type'='markdown' AND data->>'public'='true' AND embedding IS NULL
     LIMIT ${BATCH}`,
  );
  if (rows.length === 0) break;

  const inputs = rows.map((r) => `${r.title}\n\n${r.text}`.slice(0, 8000) || ' ');
  const vecs = await embedBatch(inputs);

  // One UPDATE for the whole batch via unnest(ids[], vecs[]).
  const ids = rows.map((r) => r._id);
  await sql.query(
    `UPDATE "file" AS f
       SET embedding = v.emb::vector
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS emb) AS v
      WHERE f._id = v.id`,
    [ids, vecs],
  );

  done += rows.length;
  const rate = done / ((Date.now() - t0) / 1000);
  console.log(`embedded ${done} (${rate.toFixed(0)}/s)`);
}

const remaining = await sql.query(
  `SELECT count(*)::int n FROM "file"
   WHERE data->>'type'='markdown' AND data->>'public'='true' AND embedding IS NULL`,
);
console.log(`\nDONE. backfilled ${done}; remaining NULL: ${remaining[0].n}; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
