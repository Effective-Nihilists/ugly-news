import type { InterestCluster } from './schemas';

// ============================================================================
// Personalized ranking + diversification.
// Pure functions — ported verbatim from ugly.bot to guarantee identical
// scoring/ordering for identical inputs (parity proof lives in the unit tests).
// ============================================================================

const TEMPORAL_DECAY_HALF_LIFE_DAYS = 30;

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Temporal decay factor for a cluster based on time since last use */
export function getTemporalDecayFactor(lastUsed: number, now: number): number {
  const daysSince = (now - lastUsed) / (1000 * 60 * 60 * 24);
  return Math.exp((-Math.LN2 * daysSince) / TEMPORAL_DECAY_HALF_LIFE_DAYS);
}

/**
 * Score a file based on user's interest clusters.
 * Returns a score where higher = more relevant.
 */
export function scoreFileForUser(
  fileEmbedding: number[],
  fileCreated: number,
  clusters: InterestCluster[],
  now: number,
): number {
  if (clusters.length === 0 || fileEmbedding.length === 0) {
    // No personalization data - use recency only
    const fileAgeHours = (now - fileCreated) / (1000 * 60 * 60);
    return fileAgeHours < 24 ? 0.2 * (1 - fileAgeHours / 24) : 0;
  }

  let bestScore = 0;

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(cluster.embedding, fileEmbedding);
    const decayFactor = getTemporalDecayFactor(cluster.lastUsed, now);
    // Log-normalize weight to prevent dominant clusters
    const weightFactor = Math.log2(cluster.weight + 1) / Math.log2(10);

    const score = similarity * weightFactor * decayFactor;
    if (score > bestScore) bestScore = score;
  }

  // Add recency boost for fresh files (up to 20% for < 24h old)
  const fileAgeHours = (now - fileCreated) / (1000 * 60 * 60);
  const recencyBoost = fileAgeHours < 24 ? 0.2 * (1 - fileAgeHours / 24) : 0;

  return bestScore + recencyBoost;
}

/** An article that can be ranked + diversified */
export interface RankableArticle {
  id: string;
  embedding: number[];
  created: number;
}

export interface RankedArticle {
  id: string;
  score: number;
}

/**
 * Exploration rate based on the user's interaction history.
 * New users get high exploration (diversity); established users get
 * more personalization. Returns 0.2 (established) to 1.0 (new).
 */
export function computeExplorationRate(clusters: InterestCluster[]): number {
  if (clusters.length === 0) {
    return 1.0; // Full exploration for new users
  }

  const totalWeight = clusters.reduce((sum, c) => sum + c.weight, 0);

  const TARGET_INTERACTIONS = 50;
  const confidence = Math.min(
    1,
    Math.log(totalWeight + 1) / Math.log(TARGET_INTERACTIONS + 1),
  );

  return Math.max(0.2, 1 - confidence);
}

interface ScoredCandidate {
  id: string;
  score: number;
  embedding: number[];
}

/**
 * Apply embedding-based diversification to scored candidates.
 * Penalizes candidates too similar to recently selected items.
 */
function diversifyByEmbedding(
  candidates: ScoredCandidate[],
  explorationRate: number,
  limit: number,
): ScoredCandidate[] {
  const SIMILARITY_THRESHOLD = 0.7;
  const RECENT_WINDOW_SIZE = 5;

  const result: ScoredCandidate[] = [];
  const used = new Set<string>();
  const recentEmbeddings: number[][] = [];

  while (result.length < limit && result.length < candidates.length) {
    let bestCandidate: ScoredCandidate | null = null;
    let bestAdjustedScore = -Infinity;

    for (const candidate of candidates) {
      if (used.has(candidate.id)) continue;

      let maxSimilarity = 0;
      for (const recentEmb of recentEmbeddings) {
        const sim = cosineSimilarity(candidate.embedding, recentEmb);
        if (sim > maxSimilarity) maxSimilarity = sim;
      }

      const diversityPenalty =
        maxSimilarity > SIMILARITY_THRESHOLD
          ? (maxSimilarity - SIMILARITY_THRESHOLD) * explorationRate
          : 0;

      const adjustedScore = candidate.score - diversityPenalty;

      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) break;

    result.push(bestCandidate);
    used.add(bestCandidate.id);

    recentEmbeddings.push(bestCandidate.embedding);
    if (recentEmbeddings.length > RECENT_WINDOW_SIZE) {
      recentEmbeddings.shift();
    }
  }

  return result;
}

/**
 * Score, rank, and diversify articles.
 * Used by both the news feed and the daily email for consistent behavior.
 */
export function rankAndDiversifyArticles(
  candidates: RankableArticle[],
  clusters: InterestCluster[],
  limit: number,
  now: number = Date.now(),
): RankedArticle[] {
  const scored: ScoredCandidate[] = candidates.map((c) => ({
    id: c.id,
    score: scoreFileForUser(c.embedding, c.created, clusters, now),
    embedding: c.embedding,
  }));

  scored.sort((a, b) => b.score - a.score);

  const explorationRate = computeExplorationRate(clusters);
  const diversified = diversifyByEmbedding(scored, explorationRate, limit);

  return diversified.map((c) => ({ id: c.id, score: c.score }));
}
