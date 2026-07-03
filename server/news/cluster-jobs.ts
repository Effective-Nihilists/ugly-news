import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsCluster } from '../../shared/collections';
import { toBiasBucket } from '../../shared/news/cluster-logic';
import { feedIdToSourceId, sourceById } from '../../shared/news/sourceBias';
import { uglyBotId } from '../../shared/news/Bot';
import type { BiasBucket } from '../../shared/news/schemas';
import type { NewsCategory } from '../../shared/news/types';
import { generateUglyPressImage, genText, truncateToApproximateTokens } from './ai';
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
export async function dispatchClusterSweep(db: NewsDb, now: number = Date.now()): Promise<void> {
  const recent = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [
      { $match: { lastUpdatedAt: { $gte: now - SWEEP_WINDOW_MS } } },
      { $sort: { score: -1 } },
    ],
    { limit: 200 },
  );

  // Synthesis: multi-side clusters that haven't been summarized yet.
  const toSynth = recent
    .filter((c) => c.neutralSummary === null && c.articleCount >= 2 && distinctBuckets(c.biasBreakdown) >= 2)
    .slice(0, SYNTH_MAX_PER_SWEEP);
  for (const c of toSynth) await enqueueTask('clusterSynthesize', { clusterId: c._id });

  // Satire: the most prominent clusters without an Ugly Take yet. Prefer ones
  // that already have a neutral summary (richer context → sharper jokes), but
  // fall back to title-only clusters so the satire desk is never starved.
  const eligible = recent.filter((c) => c.uglyTakeFileId === null && c.articleCount >= SATIRE_MIN_ARTICLES);
  const toSatire = [
    ...eligible.filter((c) => c.neutralSummary !== null),
    ...eligible.filter((c) => c.neutralSummary === null),
  ].slice(0, SATIRE_MAX_PER_SWEEP);
  for (const c of toSatire) await enqueueTask('clusterSatirize', { clusterId: c._id });

  console.log(
    `[cluster-sweep] recent=${recent.length} enqueued synthesize=${toSynth.length} satirize=${toSatire.length} ` +
      `(synth ids: ${toSynth.map((c) => c._id).join(',') || '-'}; satire ids: ${toSatire.map((c) => c._id).join(',') || '-'})`,
  );
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
function buildCoverageContext(files: (FileMarkdown & { _id: string })[]): string {
  const groups: Record<string, string[]> = { Left: [], Center: [], Right: [], Other: [] };
  for (const f of files) {
    const bucket = f.feedId ? bucketForFeed(f.feedId) : 'unrated';
    const label = bucket === 'left' ? 'Left' : bucket === 'right' ? 'Right' : bucket === 'center' ? 'Center' : 'Other';
    const line = `- ${f.title ?? 'Untitled'}: ${truncateToApproximateTokens(f.text ?? f.markdown ?? '', 120)}`;
    groups[label]!.push(line);
  }
  return (['Left', 'Center', 'Right', 'Other'] as const)
    .filter((g) => groups[g]!.length > 0)
    .map((g) => `## ${g} coverage\n${groups[g]!.join('\n')}`)
    .join('\n\n');
}

/** Generate the neutral + framing summaries for a multi-side cluster. */
export async function dispatchClusterSynthesize(db: NewsDb, clusterId: string): Promise<void> {
  const cluster = await db.getDoc(collections.newsCluster, clusterId);
  if (!cluster) {
    console.warn(`[cluster-synth] cluster ${clusterId} not found — skipping`);
    return;
  }
  const c = cluster as NewsCluster & { _id: string };
  if (c.neutralSummary && c.synthesizedAt) {
    console.log(`[cluster-synth] ${clusterId} already synthesized — skipping`);
    return;
  }

  const files = await db.getQuery<FileMarkdown & { _id: string }>('file', [
    { $match: { _id: { $in: c.fileIds.slice(0, 12) } } },
  ]);
  if (files.length === 0) {
    console.warn(`[cluster-synth] cluster ${clusterId} has no member files — skipping`);
    return;
  }
  console.log(`[cluster-synth] synthesizing ${clusterId} "${c.title.slice(0, 60)}" from ${files.length} files`);
  const context = buildCoverageContext(files);

  const [neutral, framing] = await Promise.all([
    genText(
      [
        { role: 'system', content: NEUTRAL_PROMPT },
        { role: 'user', content: `Story: ${c.title}\n\n${context}` },
      ],
      { model: 'deepseek_v4_flash', temperature: 0.3, maxTokens: 500 },
    ),
    genText(
      [
        { role: 'system', content: FRAMING_PROMPT },
        { role: 'user', content: `Story: ${c.title}\n\n${context}` },
      ],
      { model: 'deepseek_v4_flash', temperature: 0.4, maxTokens: 320 },
    ),
  ]);

  if (!neutral && !framing) {
    console.error(`[cluster-synth] BOTH genText calls returned null for ${clusterId} — AI proxy down or rate-limited; leaving cluster unsynthesized`);
  } else {
    console.log(`[cluster-synth] done ${clusterId}: neutral=${neutral ? `${neutral.length}c` : 'null'} framing=${framing ? `${framing.length}c` : 'null'}`);
  }

  // Backfill ONE generated "Ugly Press" image for the story, only when no member
  // article supplied an RSS image. This is the single place a generated news
  // image is actually shown (the top-stories rail's topImageUri), so we spend
  // one generation per qualifying story instead of one per scraped article. The
  // synthesized-guard (early-return above) keeps this once-per-cluster.
  let topImageUri = c.topImageUri;
  if (!topImageUri) {
    topImageUri = await generateUglyPressImage(c.title, c.category);
    if (topImageUri) console.log(`[cluster-synth] generated top image for ${clusterId}`);
  }

  await db.setDoc(collections.newsCluster, {
    ...c,
    neutralSummary: neutral ?? c.neutralSummary,
    framingSummary: framing ?? c.framingSummary,
    topImageUri,
    synthesizedAt: Date.now(),
    ...dbDefaults(),
    created: (c as { created?: Date }).created ?? new Date(),
  });
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
  const firstLine = markdown.split('\n').find((l) => l.trim().length > 0) ?? 'The Ugly Take';
  return firstLine.replace(/^#+\s*/, '').trim().slice(0, 200) || 'The Ugly Take';
}

/**
 * Generate the labeled "Ugly Take" satirical companion for a cluster. The file
 * is stored public:false + kind:'satire' so it NEVER appears in the feed/search
 * (those filter public:true); only the cluster page reads it by id and renders
 * it behind the SATIRE stamp.
 */
export async function dispatchClusterSatirize(db: NewsDb, clusterId: string): Promise<void> {
  const cluster = await db.getDoc(collections.newsCluster, clusterId);
  if (!cluster) {
    console.warn(`[cluster-satire] cluster ${clusterId} not found — skipping`);
    return;
  }
  const c = cluster as NewsCluster & { _id: string };
  if (c.uglyTakeFileId) {
    console.log(`[cluster-satire] ${clusterId} already has Ugly Take ${c.uglyTakeFileId} — skipping`);
    return;
  }

  console.log(`[cluster-satire] generating Ugly Take for ${clusterId} "${c.title.slice(0, 60)}"`);
  const basis = c.neutralSummary ?? c.title;
  const markdown = await genText(
    [
      { role: 'system', content: SATIRE_PROMPT },
      { role: 'user', content: `Real story: ${c.title}\n\nWhat actually happened:\n${truncateToApproximateTokens(basis, 800)}` },
    ],
    { model: 'gpt_4o', temperature: 0.95, maxTokens: 700 },
  );
  if (!markdown) {
    console.error(`[cluster-satire] genText returned null for ${clusterId} — AI proxy down/rate-limited; no Ugly Take generated`);
    return;
  }

  const now = Date.now();
  const title = satireTitle(markdown);
  const category: NewsCategory = c.category;
  // Reuse the cluster's top image (guaranteed by dispatchClusterSynthesize for
  // qualifying clusters) rather than minting a second one. Only generate here if
  // it's still missing — satire can fire before synthesis for some clusters.
  const image = c.topImageUri ?? (await generateUglyPressImage(title, category));

  const satireFileId = `satire_${c._id}`;
  const file: FileMarkdown & { _id: string } = {
    _id: satireFileId,
    type: 'markdown',
    kind: 'satire',
    userId: uglyBotId,
    markdown,
    title,
    text: title,
    thumbnail: image ? { type: 'public', uri: image, width: 1280, height: 720 } : null,
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
    embedding: null,
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
  console.log(`[cluster-satire] done ${clusterId}: file=${satireFileId} title="${title.slice(0, 60)}" image=${image ? 'yes' : 'no'}`);
}
