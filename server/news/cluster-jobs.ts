import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsCluster } from '../../shared/collections';
import {
  isSubstantiveSummary,
  toBiasBucket,
} from '../../shared/news/cluster-logic';
import { feedIdToSourceId, sourceById } from '../../shared/news/sourceBias';
import { uglyBotId } from '../../shared/news/Bot';
import type { BiasBucket } from '../../shared/news/schemas';
import type { NewsCategory } from '../../shared/news/types';
import {
  generateUglyPressImage,
  genText,
  truncateToApproximateTokens,
} from './ai';
import type { NewsDb } from './db';
import { enqueueTask } from './queue';

const SWEEP_WINDOW_MS = 72 * 60 * 60 * 1000;
const SYNTH_MAX_PER_SWEEP = 8; // cap AI spend per sweep
const SATIRE_MAX_PER_SWEEP = 8;
const SATIRE_MIN_ARTICLES = 3;

function distinctBuckets(b: NewsCluster['biasBreakdown']): number {
  return (b.left > 0 ? 1 : 0) + (b.center > 0 ? 1 : 0) + (b.right > 0 ? 1 : 0);
}

/** Bucket a file by its feed's source rating (unrated feeds → 'center'-ish but
 *  flagged separately by callers). */
function bucketForFeed(feedId: string): BiasBucket | 'unrated' {
  const sid = feedIdToSourceId[feedId];
  const src = sid ? sourceById[sid] : undefined;
  if (!src) return 'unrated';
  return toBiasBucket(src.biasScore);
}

/**
 * Scheduled sweep: pick clusters that have crossed the synthesis / satire gates
 * and fan out the (expensive) AI jobs. Gated + capped so cost stays bounded.
 */
export async function dispatchClusterSweep(
  db: NewsDb,
  now: number = Date.now(),
): Promise<void> {
  const recent = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [
      { $match: { lastUpdatedAt: { $gte: now - SWEEP_WINDOW_MS } } },
      { $sort: { score: -1 } },
    ],
    { limit: 200 },
  );

  // Synthesis: multi-side clusters missing a substantive neutral OR framing summary.
  // Keying on isSubstantiveSummary (not `=== null`) means clusters whose summaries the
  // AI proxy previously returned truncated/empty ("A **") get re-synthesized instead of
  // being stuck with garbage forever.
  const toSynth = recent
    .filter(
      (c) =>
        (!isSubstantiveSummary(c.neutralSummary) ||
          !isSubstantiveSummary(c.framingSummary)) &&
        c.articleCount >= 2 &&
        distinctBuckets(c.biasBreakdown) >= 2,
    )
    .slice(0, SYNTH_MAX_PER_SWEEP);

  // Satire: the most prominent clusters without an Ugly Take yet. Prefer ones
  // that already have a neutral summary (richer context → sharper jokes), but
  // fall back to title-only clusters so the satire desk is never starved.
  const eligible = recent.filter(
    (c) => c.uglyTakeFileId === null && c.articleCount >= SATIRE_MIN_ARTICLES,
  );
  const toSatire = [
    ...eligible.filter((c) => c.neutralSummary !== null),
    ...eligible.filter((c) => c.neutralSummary === null),
  ].slice(0, SATIRE_MAX_PER_SWEEP);

  // One serial work list instead of ~16 parallel queue messages. Synthesis
  // first so a fresh neutral summary can feed that cluster's satire prompt.
  const queue: SweepItem[] = [
    ...toSynth.map((c): SweepItem => ({ type: 'synth', clusterId: c._id })),
    ...toSatire.map((c): SweepItem => ({ type: 'satire', clusterId: c._id })),
  ];

  console.log(
    `[cluster-sweep] recent=${recent.length} queued synthesize=${toSynth.length} satirize=${toSatire.length} ` +
      `(synth ids: ${toSynth.map((c) => c._id).join(',') || '-'}; satire ids: ${toSatire.map((c) => c._id).join(',') || '-'})`,
  );

  if (queue.length > 0) await enqueueTask('clusterSweepStep', { queue });
}

export interface SweepItem {
  type: 'synth' | 'satire';
  clusterId: string;
}

/**
 * Process the head of the sweep work list, then re-enqueue the tail — a strictly
 * serial chain (concurrency 1) that replaces the old parallel fan-out, so the
 * hourly sweep never bursts the AI proxy.
 *
 * A failed item must not break the chain: the underlying dispatchers already
 * swallow AI failures (they leave the cluster for the next sweep), but we also
 * catch here so a thrown error can't bubble to the queue handler — which would
 * `m.retry()` the whole step and re-process the head. The chain always advances
 * by dropping the head and enqueuing the tail.
 */
export async function dispatchClusterSweepStep(
  db: NewsDb,
  queue: SweepItem[],
): Promise<void> {
  const [head, ...rest] = queue;
  if (!head) return;

  try {
    if (head.type === 'synth') {
      await dispatchClusterSynthesize(db, head.clusterId);
    } else {
      await dispatchClusterSatirize(db, head.clusterId);
    }
  } catch (e) {
    console.error(
      `[cluster-sweep-step] ${head.type} ${head.clusterId} threw — dropping and continuing`,
      e,
    );
  }

  if (rest.length > 0) await enqueueTask('clusterSweepStep', { queue: rest });
}

const NEUTRAL_PROMPT = `You are a wire-service editor. From the same story reported by multiple outlets across the political spectrum, write a STRICTLY NEUTRAL "what happened" account.
- 2-3 short paragraphs, only facts every side agrees on. Preserve names, numbers, quotes.
- No adjectives of judgment, no spin, no "critics say". Just the events.
- Markdown allowed (**bold** key facts).`;

const FRAMING_PROMPT = `You compare how the LEFT, CENTER, and RIGHT frame the SAME story. Using the grouped coverage below, write a short markdown section with exactly three bolded lines:
**Left:** one sentence on the angle/emphasis left-leaning outlets take.
**Center:** one sentence on the center framing.
**Right:** one sentence on the right framing.
Be even-handed and specific about emphasis/word choice; do not take a side. If a side has no coverage, say "Largely uncovered."`;

/** Group member file summaries by bias bucket and build a prompt context block. */
function buildCoverageContext(
  files: (FileMarkdown & { _id: string })[],
): string {
  const groups: Record<string, string[]> = {
    Left: [],
    Center: [],
    Right: [],
    Other: [],
  };
  for (const f of files) {
    const bucket = f.feedId ? bucketForFeed(f.feedId) : 'unrated';
    const label =
      bucket === 'left'
        ? 'Left'
        : bucket === 'right'
          ? 'Right'
          : bucket === 'center'
            ? 'Center'
            : 'Other';
    const line = `- ${f.title ?? 'Untitled'}: ${truncateToApproximateTokens(f.text ?? f.markdown ?? '', 120)}`;
    groups[label]!.push(line);
  }
  return (['Left', 'Center', 'Right', 'Other'] as const)
    .filter((g) => groups[g]!.length > 0)
    .map((g) => `## ${g} coverage\n${groups[g]!.join('\n')}`)
    .join('\n\n');
}

/** Generate the neutral + framing summaries for a multi-side cluster. */
export async function dispatchClusterSynthesize(
  db: NewsDb,
  clusterId: string,
): Promise<void> {
  const cluster = await db.getDoc(collections.newsCluster, clusterId);
  if (!cluster) {
    console.warn(`[cluster-synth] cluster ${clusterId} not found — skipping`);
    return;
  }
  const c = cluster as NewsCluster & { _id: string };
  if (
    isSubstantiveSummary(c.neutralSummary) &&
    isSubstantiveSummary(c.framingSummary) &&
    c.synthesizedAt
  ) {
    console.log(`[cluster-synth] ${clusterId} already synthesized — skipping`);
    return;
  }

  const files = await db.getQuery<FileMarkdown & { _id: string }>('file', [
    { $match: { _id: { $in: c.fileIds.slice(0, 12) } } },
  ]);
  if (files.length === 0) {
    console.warn(
      `[cluster-synth] cluster ${clusterId} has no member files — skipping`,
    );
    return;
  }
  console.log(
    `[cluster-synth] synthesizing ${clusterId} "${c.title.slice(0, 60)}" from ${files.length} files`,
  );
  const context = buildCoverageContext(files);

  const [neutral, framing] = await Promise.all([
    genSummary(NEUTRAL_PROMPT, c.title, context, {
      temperature: 0.3,
      maxTokens: 500,
    }),
    genSummary(FRAMING_PROMPT, c.title, context, {
      temperature: 0.4,
      maxTokens: 320,
    }),
  ]);

  // Only persist substantive output; keep whatever was there otherwise (null or old
  // garbage — the sweep re-picks non-substantive clusters, so they retry next time).
  const nextNeutral = neutral ?? c.neutralSummary;
  const nextFraming = framing ?? c.framingSummary;
  const bothGood =
    isSubstantiveSummary(nextNeutral) && isSubstantiveSummary(nextFraming);
  if (!neutral && !framing) {
    console.error(
      `[cluster-synth] both summaries non-substantive for ${clusterId} after retry — AI proxy down/truncating; leaving for next sweep`,
    );
  } else {
    console.log(
      `[cluster-synth] ${clusterId}: neutral=${nextNeutral ? `${nextNeutral.length}c` : 'null'} framing=${nextFraming ? `${nextFraming.length}c` : 'null'} synthesized=${bothGood}`,
    );
  }

  // NO image generation here. Art used to be minted for every synthesized
  // cluster that lacked an RSS image — 272 flux calls / $4.25 a week — whether
  // or not the story was ever surfaced. It is now generated lazily off the
  // read path (see `dispatchClusterImageBackfill`), so a cluster nobody sees
  // costs nothing.
  const topImageUri = c.topImageUri;

  await db.setDoc(collections.newsCluster, {
    ...c,
    neutralSummary: nextNeutral,
    framingSummary: nextFraming,
    topImageUri,
    // Only mark synthesized once BOTH summaries are real, so a partial result stays
    // eligible for re-synthesis on the next sweep instead of being frozen as done.
    synthesizedAt: bothGood ? Date.now() : (c.synthesizedAt ?? null),
    ...dbDefaults(),
    created: (c as { created?: Date }).created ?? new Date(),
  });
}

/** How many generations one page render may ask for. A rail serves up to 40
 *  cards; without a cap, a single cold read could fan out 40 flux calls. */
const ART_MAX_PER_READ = 3;

/** How long a stamped art request suppresses further requests. Long enough
 *  that a hot rail asks once, short enough that a failed generation retries
 *  the same day. */
const ART_RETRY_MS = 6 * 60 * 60 * 1000;

interface ArtCandidate {
  _id: string;
  topImageUri: string | null;
  topImageRequestedAt?: number | null;
}

/**
 * Read-path trigger: ask for generated art for any cluster about to be served
 * without an image. Stamps `topImageRequestedAt` BEFORE enqueuing so parallel
 * readers collapse to one generation, and caps the fan-out per render.
 *
 * Best-effort by contract — art is cosmetic, and a queue or DB hiccup must
 * never turn a page load into an error.
 */
export async function requestClusterArt(
  db: NewsDb,
  clusters: ArtCandidate[],
  now: number = Date.now(),
): Promise<void> {
  try {
    const wanted = clusters
      .filter(
        (c) =>
          !c.topImageUri &&
          (c.topImageRequestedAt == null ||
            now - c.topImageRequestedAt > ART_RETRY_MS),
      )
      .slice(0, ART_MAX_PER_READ);

    for (const c of wanted) {
      const doc = await db.getDoc(collections.newsCluster, c._id);
      if (!doc) continue;
      const full = doc as NewsCluster & { _id: string };
      // Re-check against the stored doc: another reader may have stamped it
      // between our list query and here.
      if (
        full.topImageUri ||
        (full.topImageRequestedAt != null &&
          now - full.topImageRequestedAt <= ART_RETRY_MS)
      ) {
        continue;
      }
      await db.setDoc(collections.newsCluster, {
        ...full,
        topImageRequestedAt: now,
        ...dbDefaults(),
        created: (full as { created?: Date }).created ?? new Date(),
      });
      await enqueueTask('clusterImageBackfill', { clusterId: c._id });
    }
  } catch (error) {
    console.warn('[cluster-art] request failed', error);
  }
}

/**
 * Queue worker: mint the "Ugly Press" image for one cluster.
 *
 * Re-checks `topImageUri` first — two readers can both enqueue before either
 * write lands, so this is the last guard against paying twice for one story.
 */
export async function dispatchClusterImageBackfill(
  db: NewsDb,
  clusterId: string,
): Promise<void> {
  const doc = await db.getDoc(collections.newsCluster, clusterId);
  if (!doc) return;
  const c = doc as NewsCluster & { _id: string };
  if (c.topImageUri) return;

  const topImageUri = await generateUglyPressImage(c.title, c.category);
  if (!topImageUri) {
    console.warn(`[cluster-art] generation returned nothing for ${clusterId}`);
    return;
  }
  await db.setDoc(collections.newsCluster, {
    ...c,
    topImageUri,
    ...dbDefaults(),
    created: (c as { created?: Date }).created ?? new Date(),
  });
  console.log(`[cluster-art] generated top image for ${clusterId}`);
}

/**
 * genText for a cluster summary, retried once when the proxy returns truncated/empty
 * output (see isSubstantiveSummary). Returns a substantive string, or null if both
 * attempts fail — in which case the caller leaves the cluster for the next sweep.
 */
async function genSummary(
  system: string,
  title: string,
  context: string,
  opts: { temperature: number; maxTokens: number },
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await genText(
      [
        { role: 'system', content: system },
        { role: 'user', content: `Story: ${title}\n\n${context}` },
      ],
      {
        // gpt-oss-120b, not deepseek_v4_flash: DeepSeek's Anthropic gateway
        // force-enables thinking with no way to bound it, so a summarization
        // call spent ~90% of its output budget reasoning and routinely
        // returned a stub — the "non-substantive summary (0c)" family this
        // very function retries around.
        model: 'gpt_oss_120b',
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      },
    );
    if (isSubstantiveSummary(out)) return out;
    if (attempt === 0) {
      console.warn(
        `[cluster-synth] non-substantive summary (${(out ?? '').length}c) — retrying once`,
      );
    }
  }
  return null;
}

const SATIRE_PROMPT = `You are a headline writer for "The Ugly Press" satire desk — deadpan, AP-style, in the tradition of The Onion. From a REAL news story, write a SATIRICAL companion piece that parodies how the news is reported. Rules:
- Output markdown. First line is the satirical headline as an H1 ("# ...").
- Then an AP-style dateline opener ("**CITY, ST—** ...").
- 2-3 short paragraphs. Deadpan; never wink at the reader; never say it's a joke.
- Invent plausible officials/experts with realistic titles and absurd quotes. Use "[name withheld]" rather than real people's names.
- End with a short "## American Voices" section: 3 fake man-on-the-street quotes, each with a Name and absurd Occupation.
- It must be unmistakably fiction in TONE while structurally mimicking a news article. Do NOT restate the real facts as if true.`;

/** Parse the H1 (or first line) as the satire headline. */
function satireTitle(markdown: string): string {
  const firstLine =
    markdown.split('\n').find((l) => l.trim().length > 0) ?? 'The Ugly Take';
  return (
    firstLine
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 200) || 'The Ugly Take'
  );
}

/**
 * Generate the labeled "Ugly Take" satirical companion for a cluster. The file
 * is stored public:false + kind:'satire' so it NEVER appears in the feed/search
 * (those filter public:true); only the cluster page reads it by id and renders
 * it behind the SATIRE stamp.
 */
export async function dispatchClusterSatirize(
  db: NewsDb,
  clusterId: string,
): Promise<void> {
  const cluster = await db.getDoc(collections.newsCluster, clusterId);
  if (!cluster) {
    console.warn(`[cluster-satire] cluster ${clusterId} not found — skipping`);
    return;
  }
  const c = cluster as NewsCluster & { _id: string };
  if (c.uglyTakeFileId) {
    console.log(
      `[cluster-satire] ${clusterId} already has Ugly Take ${c.uglyTakeFileId} — skipping`,
    );
    return;
  }

  console.log(
    `[cluster-satire] generating Ugly Take for ${clusterId} "${c.title.slice(0, 60)}"`,
  );
  const basis = c.neutralSummary ?? c.title;
  const markdown = await genText(
    [
      { role: 'system', content: SATIRE_PROMPT },
      {
        role: 'user',
        content: `Real story: ${c.title}\n\nWhat actually happened:\n${truncateToApproximateTokens(basis, 800)}`,
      },
    ],
    // Was gpt_4o ($2.50/$10 per 1M). 741 calls a week at $3.32 for files
    // stored public:false and reachable only from a cluster page.
    { model: 'gpt_oss_120b', temperature: 0.95, maxTokens: 700 },
  );
  if (!markdown) {
    console.error(
      `[cluster-satire] genText returned null for ${clusterId} — AI proxy down/rate-limited; no Ugly Take generated`,
    );
    return;
  }

  const now = Date.now();
  const title = satireTitle(markdown);
  const category: NewsCategory = c.category;
  // Reuse whatever image the cluster already has, or ship the satire without
  // one. This deliberately does NOT generate: art is minted lazily off the read
  // path now (requestClusterArt / dispatchClusterImageBackfill), and an Ugly
  // Take is stored `public: false` and reachable only from its cluster page —
  // so a generation here would be paid for an illustration almost nobody sees.
  // If the cluster gets art later, this file keeps rendering without it; that
  // is the intended trade.
  const image = c.topImageUri;

  const satireFileId = `satire_${c._id}`;
  const file: FileMarkdown & { _id: string } = {
    _id: satireFileId,
    type: 'markdown',
    kind: 'satire',
    userId: uglyBotId,
    markdown,
    title,
    text: title,
    thumbnail: image
      ? { type: 'public', uri: image, width: 1280, height: 720 }
      : null,
    tags: [category],
    sourceUri: null,
    feedId: null,
    category,
    clusterId: c._id,
    // public:false → excluded from every feed/search/archive query (they filter
    // public:true). Surfaced only via the cluster's uglyTakeFileId.
    public: false,
    indexable: false,
    indexed: false,
    likeCount: 0,
    dislikeCount: 0,
    viewCount: 0,
    conversationId: null,
    ...dbDefaults(),
  };
  await db.setDoc(collections.file, file);

  await db.setDoc(collections.newsCluster, {
    ...c,
    uglyTakeFileId: satireFileId,
    satirizedAt: now,
    ...dbDefaults(),
    created: (c as { created?: Date }).created ?? new Date(),
  });
  console.log(
    `[cluster-satire] done ${clusterId}: file=${satireFileId} title="${title.slice(0, 60)}" image=${image ? 'yes' : 'no'}`,
  );
}
