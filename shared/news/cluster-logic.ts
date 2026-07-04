import { cosineSimilarity } from './ranking';
import type { BiasBreakdown, BiasBucket, Factuality } from './schemas';

// ============================================================================
// Pure clustering / bias logic — shared by the server clustering engine and the
// unit tests. No DB, no AI, no IO: deterministic functions over plain data.
// ============================================================================

// Three-way bucket from the −6..+6 lean score. The [-1, 1] band (inclusive) is
// "center"; outside it is left/right. Matches the seed scores in sourceBias.ts.
export function toBiasBucket(biasScore: number): BiasBucket {
  if (biasScore < -1) return 'left';
  if (biasScore > 1) return 'right';
  return 'center';
}

const FACTUALITY_SCORE: Record<Factuality, number> = {
  'very-low': 1,
  low: 2,
  mixed: 3,
  high: 4,
  'very-high': 5,
};

export function factualityToScore(f: Factuality): number {
  return FACTUALITY_SCORE[f];
}

/** Mean factuality (1..5) across rated sources, or null if none are rated. */
export function averageFactuality(facts: Factuality[]): number | null {
  if (facts.length === 0) return null;
  return facts.reduce((sum, f) => sum + factualityToScore(f), 0) / facts.length;
}

export interface MemberSourceRating {
  biasScore: number | null;
  factuality: Factuality | null;
}

/** Coverage distribution across L/C/R buckets. Percentages are over RATED
 *  sources only (unrated aggregators like Google News don't skew the bar). */
export function computeBiasBreakdown(members: MemberSourceRating[]): BiasBreakdown {
  let left = 0;
  let center = 0;
  let right = 0;
  let unrated = 0;
  for (const m of members) {
    if (m.biasScore === null) {
      unrated++;
      continue;
    }
    const bucket = toBiasBucket(m.biasScore);
    if (bucket === 'left') left++;
    else if (bucket === 'right') right++;
    else center++;
  }
  const total = left + center + right;
  const pct = (n: number): number => (total > 0 ? Math.round((n / total) * 100) : 0);
  return {
    left,
    center,
    right,
    unrated,
    total,
    leftPct: pct(left),
    centerPct: pct(center),
    rightPct: pct(right),
  };
}

export interface BlindspotOptions {
  /** Minimum rated sources before we'll call a blindspot at all. */
  minSources?: number;
  /** A side "dominates" at/above this % of rated coverage. */
  dominantPct?: number;
  /** The opposite side is "missing" at/below this % of rated coverage. */
  missingPct?: number;
}

/**
 * Returns the bucket that is effectively NOT covering a story (its "blindspot"),
 * or null when coverage is balanced / too thin. If the left dominates and the
 * right is absent, the RIGHT has the blindspot, and vice-versa.
 */
export function detectBlindspot(
  b: BiasBreakdown,
  opts: BlindspotOptions = {},
): BiasBucket | null {
  const minSources = opts.minSources ?? 3;
  const dominantPct = opts.dominantPct ?? 70;
  const missingPct = opts.missingPct ?? 10;
  if (b.total < minSources) return null;
  if (b.leftPct >= dominantPct && b.rightPct <= missingPct) return 'right';
  if (b.rightPct >= dominantPct && b.leftPct <= missingPct) return 'left';
  return null;
}

export interface ClusterCandidate {
  id: string;
  centroid: number[] | null;
}

/**
 * Find the most-similar cluster whose centroid clears `threshold` cosine against
 * the new article embedding, or null if none do. Candidates with a null or
 * length-mismatched centroid are skipped.
 */
export function assignToCluster(
  embedding: number[],
  candidates: ClusterCandidate[],
  threshold = 0.82,
): { clusterId: string; similarity: number } | null {
  let best: { clusterId: string; similarity: number } | null = null;
  for (const c of candidates) {
    if (c.centroid?.length !== embedding.length) continue;
    const similarity = cosineSimilarity(embedding, c.centroid);
    if (similarity >= threshold && (best === null || similarity > best.similarity)) {
      best = { clusterId: c.id, similarity };
    }
  }
  return best;
}

/**
 * Incremental running mean of the cluster centroid. `memberCount` is the number
 * of members BEFORE adding this embedding. With no prior centroid, the new
 * embedding becomes the centroid.
 */
export function updateCentroid(
  centroid: number[] | null,
  memberCount: number,
  embedding: number[],
): number[] {
  if (centroid?.length !== embedding.length || memberCount <= 0) {
    return [...embedding];
  }
  const n = memberCount;
  return centroid.map((v, i) => (v * n + (embedding[i] ?? 0)) / (n + 1));
}

export interface ClusterTiming {
  firstSeenAt: number;
  lastUpdatedAt: number;
}

export interface JoinWindowOptions {
  /** A cluster stops accepting new members this long after it FIRST appeared,
   *  even if still active — so an ongoing story splits into day-over-day
   *  clusters instead of one ever-growing mega-cluster. */
  maxClusterAgeMs?: number;
  /** The joining article's own publish time must be within this of the
   *  cluster's last activity — so a backfilled/recurring same-topic story from
   *  a different time doesn't merge in. */
  maxArticleGapMs?: number;
}

const DEFAULT_MAX_CLUSTER_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const DEFAULT_MAX_ARTICLE_GAP_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Date gate applied BEFORE the cosine match: a cluster only accepts an article
 * when (B) the cluster isn't older than `maxClusterAgeMs` since `firstSeenAt`,
 * and (C) the article's own date is within `maxArticleGapMs` of the cluster's
 * last activity. Keeps "same topic, different event/day" from over-merging.
 */
export function clusterAcceptsArticle(
  timing: ClusterTiming,
  articleCreatedMs: number,
  now: number,
  opts: JoinWindowOptions = {},
): boolean {
  const maxAge = opts.maxClusterAgeMs ?? DEFAULT_MAX_CLUSTER_AGE_MS;
  const maxGap = opts.maxArticleGapMs ?? DEFAULT_MAX_ARTICLE_GAP_MS;
  if (now - timing.firstSeenAt > maxAge) return false;
  if (Math.abs(articleCreatedMs - timing.lastUpdatedAt) > maxGap) return false;
  return true;
}

export interface ClusterScoreInput {
  articleCount: number;
  /** Distinct bias buckets represented (1..3) — breadth across the spectrum. */
  distinctBuckets: number;
  ageHours: number;
  /** Likes + saves + views proxy. */
  engagement: number;
}

/** Ranking signal for Top Stories: coverage breadth + spectrum spread + recency
 *  + engagement. Higher = more prominent. */
export function computeClusterScore(input: ClusterScoreInput): number {
  const breadth = Math.log2(input.articleCount + 1) * 2;
  const spread = input.distinctBuckets;
  const recency = Math.max(0, 1 - input.ageHours / 48) * 3;
  const engagement = Math.log2(input.engagement + 1);
  return breadth + spread + recency + engagement;
}

/**
 * Minimum trimmed length for an AI-generated cluster summary to count as real
 * content. The synthesis proxy (deepseek_v4_flash) intermittently returns
 * truncated/empty output — observed prod values like "A **" (4c) and
 * "**Left:** Left-leaning outlets frame the" (40c) — while genuine summaries run
 * 139–1000c. Anything shorter is treated as MISSING so it neither renders on the
 * story page nor sticks in the DB (it gets re-synthesized on the next sweep).
 */
export const MIN_SUMMARY_CHARS = 80;

/** True when `s` is a substantive summary (see MIN_SUMMARY_CHARS), not truncated/empty. */
export function isSubstantiveSummary(s: string | null | undefined): boolean {
  return (s ?? '').trim().length >= MIN_SUMMARY_CHARS;
}
