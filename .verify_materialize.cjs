const { neon } = require('/Users/admin/Documents/GitHub/ugly-news/node_modules/@neondatabase/serverless');
const url = require('/Users/admin/.ugly-studio/projects/ad0eu8yee9/publish-state.json').neon.connectionString;
const sql = neon(url);
const MARK = '2026-06-27T20:00:00Z';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    const rows = await sql`select count(*)::int n,
        sum(case when embedding is not null then 1 else 0 end)::int col,
        sum(case when jsonb_typeof(data->'embedding')='array' then 1 else 0 end)::int blob
      from "file" where data->>'type'='markdown' and created > ${MARK}`;
    const r = rows[0];
    const now = new Date().toISOString().slice(11, 19);
    if (r.n >= 5) {
      console.log(`[${now}] RESULT: post-20:00 articles=${r.n}, COLUMN populated=${r.col}, data.embedding blob remaining=${r.blob}`);
      console.log(r.col > 0 && r.col >= r.n - 1
        ? 'FIX VERIFIED: fresh scrapes now materialize the pgvector embedding column.'
        : 'STILL BROKEN: column not populated on fresh scrapes.');
      const s = await sql`select created, (embedding is not null) col, jsonb_typeof(data->'embedding') blob, data->>'title' t
        from "file" where data->>'type'='markdown' and created > ${MARK} order by created desc limit 3`;
      for (const x of s) console.log('   ', x.created.toISOString().slice(11, 19), 'COLUMN=' + x.col, 'blob=' + x.blob, '|', (x.t || '').slice(0, 40));
      return;
    }
    console.log(`[${now}] waiting… post-20:00 articles so far: ${r.n}`);
    await sleep(120000);
  }
  console.log('TIMED OUT waiting for fresh articles.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
