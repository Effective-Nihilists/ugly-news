/**
 * Local end-to-end harness for the "Three Ways" pipeline — runs the REAL code
 * paths (scrape → AI ad-filter/summarize → AI image → embed → cluster assign →
 * synthesize → satire) against an in-memory DB and the REAL ugly.bot AI proxy.
 * No Docker / Postgres needed.
 *
 *   AI auth: reads the project owner token from ~/.ugly-bot/<projectId>.json and
 *   sets AI_PROXY_TOKEN (genText/genImage) + UGLY_BOT_TOKEN (embedGen).
 *
 * Run:  npx tsx tests/integration/clusterPipeline.ts
 */
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── AI auth (must be set before any genText/embed call) ─────────────────────
const PROJECT_ID = 'ad0eu8yee9';
const token = (
  JSON.parse(
    readFileSync(join(homedir(), '.ugly-bot', `${PROJECT_ID}.json`), 'utf8'),
  ) as { token: string }
).token;
process.env['AI_PROXY_TOKEN'] = token;
process.env['UGLY_BOT_TOKEN'] = token;
// NOTE: ai.ts default is `api.ugly.bot` which does NOT resolve — the live host
// is `ugly.bot/v1/ai` (same default email.ts uses). Forcing it here.
process.env['AI_PROXY_URL'] = 'https://ugly.bot/v1/ai';

import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { NewsArticle, NewsCluster } from '../../shared/collections';
import type { NewsDb } from '../../server/news/db';
import { dispatchArticleScrape } from '../../server/news/scraper';
import {
  dispatchClusterSynthesize,
  dispatchClusterSatirize,
} from '../../server/news/cluster-jobs';

// ── Minimal in-memory NewsDb (supports the operators the pipeline uses) ──────
const nameByColl = new Map<unknown, string>();
for (const [k, v] of Object.entries(collections)) nameByColl.set(v, k);
const cname = (coll: unknown): string =>
  typeof coll === 'string'
    ? coll
    : (nameByColl.get(coll) ?? (coll as { name?: string })?.name ?? 'unknown');

type Doc = Record<string, unknown> & { _id: string };
const store = new Map<string, Map<string, Doc>>();
const col = (n: string): Map<string, Doc> =>
  store.get(n) ?? store.set(n, new Map()).get(n)!;

function matchVal(val: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    for (const [op, v] of Object.entries(cond as Record<string, unknown>)) {
      const num = typeof val === 'number' ? val : Number(val);
      if (op === '$gte' && !(num >= (v as number))) return false;
      else if (op === '$lte' && !(num <= (v as number))) return false;
      else if (op === '$gt' && !(num > (v as number))) return false;
      else if (op === '$lt' && !(num < (v as number))) return false;
      else if (op === '$in' && !(v as unknown[]).includes(val)) return false;
      else if (op === '$ne' && val === v) return false;
    }
    return true;
  }
  return val === cond;
}
const matchDoc = (doc: Doc, m: Record<string, unknown>): boolean =>
  Object.entries(m).every(([k, cond]) => matchVal(doc[k], cond));

const fakeDb = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async getDoc(coll: unknown, id: string) {
    return col(cname(coll)).get(id);
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async setDoc(coll: unknown, doc: Doc, opts?: { skipIfExists?: boolean }) {
    const c = col(cname(coll));
    if (opts?.skipIfExists && c.has(doc._id)) return;
    c.set(doc._id, doc);
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteDoc(coll: unknown, id: string) {
    col(cname(coll)).delete(id);
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async setDocFields(
    coll: unknown,
    id: string,
    fields: Record<string, unknown>,
  ) {
    const d = col(cname(coll)).get(id);
    if (d) Object.assign(d, fields);
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async getQuery(
    name: string,
    pipeline: Array<Record<string, unknown>>,
    opts?: { limit?: number; skip?: number },
  ) {
    let rows = [...col(name).values()];
    for (const stage of pipeline) {
      if (stage['$match'])
        rows = rows.filter((d) =>
          matchDoc(d, stage['$match'] as Record<string, unknown>),
        );
      if (stage['$sort']) {
        const [[f, dir]] = Object.entries(
          stage['$sort'] as Record<string, number>,
        );
        rows.sort(
          (a, b) => ((a[f!] as number) - (b[f!] as number)) * (dir as number),
        );
      }
    }
    const skip = opts?.skip ?? 0;
    return rows.slice(skip, opts?.limit ? skip + opts.limit : undefined);
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async getDocs(
    coll: unknown,
    filter: Record<string, unknown>,
    opts?: { sort?: Record<string, number>; limit?: number },
  ) {
    let rows = [...col(cname(coll)).values()].filter((d) =>
      matchDoc(d, filter),
    );
    if (opts?.sort) {
      const [[f, dir]] = Object.entries(opts.sort);
      rows.sort(
        (a, b) => ((a[f!] as number) - (b[f!] as number)) * (dir as number),
      );
    }
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  },
} as unknown as NewsDb;

// ── Seed 3 outlets covering the SAME event (left / center / right) ──────────
const EVENT = [
  {
    feedId: 'guardian_us',
    title:
      'Senate Passes $1.2 Trillion Spending Bill in Win for Working Families',
    body: 'The US Senate approved a $1.2 trillion spending package early Tuesday on a 51-49 vote after an all-night session. Supporters say the bill protects families with disaster relief and clean-energy investment. The Majority Leader called it a hard-won compromise. It now heads to the House.',
  },
  {
    feedId: 'nbcnews',
    title:
      'Senate Approves $1.2 Trillion Spending Bill 51-49 After Overnight Session',
    body: 'The Senate passed a $1.2 trillion spending bill on a 51-49 vote early Tuesday, funding the government through September. The package includes disaster relief, defense increases and contested energy provisions. It now moves to the House for a vote expected Friday.',
  },
  {
    feedId: 'foxnews_politics',
    title:
      'Senate Rams Through $1.2 Trillion Spending Bill Despite Deficit Warnings',
    body: 'The Senate passed a $1.2 trillion spending bill 51-49 early Tuesday over objections about the price tag and the deficit. Critics warned the energy provisions were buried in the package. Two members crossed the aisle. The bill now goes to the House.',
  },
];

async function seedAndScrape(): Promise<void> {
  for (let i = 0; i < EVENT.length; i++) {
    const e = EVENT[i]!;
    const _id = `art_${i}_${e.feedId}`;
    const article: NewsArticle & { _id: string } = {
      _id,
      feedId: e.feedId,
      title: e.title,
      contentHtml: '',
      contentMarkdown: e.body,
      uri: null,
      categories: ['politics'],
      imageUri: 'https://example.com/seed.jpg', // set → skip per-article image gen (saves cost)
      summary: null,
      summaryGeneratedAt: null,
      scrapeStatus: 'pending',
      scrapeError: null,
      scrapedAt: null,
      fileId: null,
      ...dbDefaults(),
    };
    await fakeDb.setDoc(collections.newsArticle, article as unknown as Doc);
    console.log(`\n[harness] scraping ${_id} (${e.feedId}) …`);
    await dispatchArticleScrape(fakeDb, _id);
  }
}

function pct(n: number, t: number): string {
  return t > 0 ? `${Math.round((n / t) * 100)}%` : '0%';
}

async function main(): Promise<void> {
  console.log(
    `[harness] AI proxy: ${process.env['AI_PROXY_URL']} (token ${token.slice(0, 6)}…)`,
  );
  await seedAndScrape();

  // Pairwise cosine of the 3 article embeddings (still in fake-DB JSON since the
  // pgvector materialize no-ops here) — to see how similar cross-spectrum framing
  // of the SAME event really is, and tune the join threshold.
  const files = [...col('file').values()] as unknown as Array<{
    _id: string;
    embedding?: number[];
  }>;
  const cos = (a: number[], b: number[]): number => {
    let d = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      d += a[i]! * b[i]!;
      na += a[i]! ** 2;
      nb += b[i]! ** 2;
    }
    return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  };
  console.log('\n[harness] pairwise cosine of the 3 same-event articles:');
  for (let i = 0; i < files.length; i++)
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i]!,
        b = files[j]!;
      if (a.embedding && b.embedding)
        console.log(
          `  ${a._id.replace('file_art_', '')} ↔ ${b._id.replace('file_art_', '')} = ${cos(a.embedding, b.embedding).toFixed(3)}`,
        );
    }

  const clusters = [...col('newsCluster').values()] as unknown as Array<
    NewsCluster & { _id: string }
  >;
  console.log(
    `\n[harness] ===== ${clusters.length} cluster(s) formed (threshold=${process.env['CLUSTER_SIM_THRESHOLD'] ?? '0.78'}) =====`,
  );
  for (const c of clusters) {
    const b = c.biasBreakdown;
    console.log(`\nCLUSTER ${c._id}`);
    console.log(`  title       : ${c.title}`);
    console.log(
      `  articles    : ${c.articleCount}  sources: ${c.sourceIds.join(', ')}`,
    );
    console.log(
      `  bias bar    : L ${pct(b.left, b.total)} / C ${pct(b.center, b.total)} / R ${pct(b.right, b.total)}  (counts ${b.left}/${b.center}/${b.right}, unrated ${b.unrated})`,
    );
    console.log(
      `  blindspot   : ${c.blindspotSide ?? 'none'}   factualityAvg: ${c.factualityAvg?.toFixed(2) ?? 'n/a'}`,
    );

    const buckets =
      (b.left > 0 ? 1 : 0) + (b.center > 0 ? 1 : 0) + (b.right > 0 ? 1 : 0);
    if (buckets >= 2 && c.articleCount >= 2) {
      console.log(`\n[harness] synthesizing + satirizing ${c._id} (real AI)…`);
      await dispatchClusterSynthesize(fakeDb, c._id);
      await dispatchClusterSatirize(fakeDb, c._id);
      const updated = (await fakeDb.getDoc(
        collections.newsCluster,
        c._id,
      )) as unknown as NewsCluster;
      console.log(
        `\n  --- NEUTRAL SUMMARY ---\n${(updated.neutralSummary ?? '(none)').slice(0, 600)}`,
      );
      console.log(
        `\n  --- FRAMING SUMMARY ---\n${(updated.framingSummary ?? '(none)').slice(0, 600)}`,
      );
      if (updated.uglyTakeFileId) {
        const sat = (await fakeDb.getDoc(
          collections.file,
          updated.uglyTakeFileId,
        )) as unknown as {
          title?: string;
          markdown?: string;
          public?: boolean;
          kind?: string;
        };
        console.log(
          `\n  --- UGLY TAKE (file ${updated.uglyTakeFileId}, kind=${sat.kind}, public=${sat.public}) ---`,
        );
        console.log(`  headline: ${sat.title}`);
        console.log(`${(sat.markdown ?? '').slice(0, 700)}`);
      }
    } else {
      console.log(
        `  (single-bucket or single-article cluster — synth/satire gate not met)`,
      );
    }
  }
  console.log(
    `\n[harness] done. files=${col('file').size} articles=${col('newsArticle').size} clusters=${col('newsCluster').size}`,
  );
}

main().catch((e) => {
  console.error('[harness] FATAL', e);
  process.exit(1);
});
