import { defineWorker, defineWorkers, z } from 'ugly-app/shared';

// News background workers.
//
// Workers WITH a `schedule` run on Cloudflare Cron Triggers (and Node's clock
// tick in dev). Workers WITHOUT a schedule are queue-only jobs, invoked via
// `getAdapter().schedule.enqueueWorker(name, input)` — used for per-feed /
// per-article / per-user fan-out.
export const cronTasks = defineWorkers({
  // ── Scheduled (cron) ───────────────────────────────────────────────────
  // Hourly: refresh all RSS feeds (enqueues one newsFeedDownload per feed).
  newsHourly: defineWorker({
    schedule: '0 * * * *',
    description: 'Hourly RSS refresh — enqueue a download job per feed',
  }),
  // Daily 10:00 UTC: generate the default daily news podcast.
  podcastDaily: defineWorker({
    schedule: '0 10 * * *',
    description: 'Generate the default daily news podcast',
    timeout: 60_000,
  }),
  // Hourly: enqueue the daily email for users whose local time is 8am now.
  userEmailHourly: defineWorker({
    schedule: '0 * * * *',
    description: 'Enqueue daily news email for users at 8am local time',
  }),
  // Hourly: gate + fan out cluster synthesis (neutral + framing) and the Ugly
  // Take satire for clusters that crossed the thresholds. Folded onto the same
  // 0 * * * * trigger as newsHourly/userEmailHourly so it adds ZERO extra Neon
  // wakes (was */30 → 48 wakes/day). The once-per-cluster synthesizedAt guard
  // makes the extra ≤30 min of latency harmless.
  clusterSweep: defineWorker({
    schedule: '0 * * * *',
    description: 'Enqueue synthesis + satire for qualifying story clusters',
    timeout: 30_000,
  }),

  // ── Queue-only jobs (fan-out) ────────────────────────────────────────────
  // The sweep used to enqueue all ~16 synth/satire jobs at once. The Cloudflare
  // queue consumer auto-scales concurrent invocations, so that burst hit the AI
  // proxy in parallel and drew 429s that outlasted the per-call backoff. Instead
  // the sweep now enqueues ONE `clusterSweepStep` carrying the whole work list;
  // each step does exactly one AI op and re-enqueues the remainder, so dispatch
  // is strictly serial (concurrency 1) with no burst, while each job keeps its
  // own 60s budget.
  clusterSweepStep: defineWorker({
    description: 'Process one queued cluster synth/satire op, then chain the rest',
    input: z.object({
      queue: z.array(
        z.object({ type: z.enum(['synth', 'satire']), clusterId: z.string() }),
      ),
    }),
    timeout: 60_000,
  }),
  clusterSynthesize: defineWorker({
    description: 'Generate neutral + per-side framing summaries for a cluster',
    input: z.object({ clusterId: z.string() }),
    timeout: 60_000,
  }),
  clusterSatirize: defineWorker({
    description: 'Generate the labeled Ugly Take satire companion for a cluster',
    input: z.object({ clusterId: z.string() }),
    timeout: 60_000,
  }),
  newsFeedDownload: defineWorker({
    description: 'Download + parse one RSS feed, create articles, enqueue scrapes',
    input: z.object({ feedId: z.string() }),
    timeout: 60_000,
  }),
  articleScrape: defineWorker({
    description: 'Scrape + summarize + image one article, create its file + bot comment',
    input: z.object({ articleId: z.string() }),
    timeout: 60_000,
  }),
  podcastGenerate: defineWorker({
    description: 'Generate a podcast (script + TTS audio + visemes) for a date',
    input: z.object({
      date: z.string(),
      userId: z.string().nullable(),
      replaceDefault: z.boolean().optional(),
    }),
    timeout: 120_000,
  }),
  userPrivateNewsEmail: defineWorker({
    description: 'Render + send the daily news email to one user',
    input: z.object({ userId: z.string(), now: z.number() }),
    timeout: 60_000,
  }),
});
