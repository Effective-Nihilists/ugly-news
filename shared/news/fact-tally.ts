// The weighted stance tally: how a set of other outlets' positions on one
// claim becomes a single colour.
//
// Pure and dependency-free so the arithmetic is auditable on its own. Anything
// that touches a model or the corpus lives in server/news/fact.ts.

import type { Bias, BiasBucket, Factuality } from './schemas';

export type Stance = 'supports' | 'refutes' | 'mixed' | 'silent';

export interface StanceEntry {
  sourceId: string;
  name: string;
  bias: Bias;
  factuality: Factuality;
  stance: Stance;
  /** 0..1 — how much this outlet's vote is its OWN reporting. */
  independence: number;
}

export type Band = 'green' | 'yellow' | 'red' | 'unverified';
export type ForcedYellowReason = 'variance' | 'single-bucket' | null;

export interface Tally {
  score: number;
  band: Band;
  forcedYellowReason: ForcedYellowReason;
  counted: number;
}

/** Reliability, not agreement — a fringe outlet's vote counts for less. */
export function factualityWeight(f: Factuality): number {
  switch (f) {
    case 'very-low':
      return 0.2;
    case 'low':
      return 0.35;
    case 'mixed':
      return 0.55;
    case 'high':
      return 0.8;
    case 'very-high':
      return 0.95;
  }
}

/** The seven MBFC ratings collapsed onto the three sides of the room. */
export function biasBucket(b: Bias): BiasBucket {
  if (b === 'center') return 'center';
  return b === 'far-left' || b === 'left' || b === 'lean-left'
    ? 'left'
    : 'right';
}

/** Above this, agreement is strong enough to colour. */
const CONSENSUS = 0.75;
/** Each side carrying at least this share of weight is a real disagreement. */
const CONTESTED_SHARE = 0.25;

function direction(s: Stance): number {
  if (s === 'supports') return 1;
  if (s === 'refutes') return -1;
  return 0; // 'mixed' carries weight but no direction
}

const UNVERIFIED: Tally = {
  score: 0,
  band: 'unverified',
  forcedYellowReason: null,
  counted: 0,
};

/**
 * Silence is not agreement, so silent sources are excluded from BOTH the
 * numerator and the denominator. A claim nobody else covered comes back
 * `unverified`, never green — the single most important rule here, because
 * "no coverage" is exactly what a novel false claim looks like.
 */
export function tally(entries: readonly StanceEntry[]): Tally {
  const voting = entries.filter((x) => x.stance !== 'silent');
  if (voting.length === 0) return UNVERIFIED;

  let weighted = 0;
  let total = 0;
  let supportWeight = 0;
  let refuteWeight = 0;
  for (const x of voting) {
    const w = factualityWeight(x.factuality) * x.independence;
    total += w;
    weighted += w * direction(x.stance);
    if (x.stance === 'supports') supportWeight += w;
    if (x.stance === 'refutes') refuteWeight += w;
  }
  // Every source unrated (weight 0) is indistinguishable from no sources.
  if (total === 0) return { ...UNVERIFIED, counted: voting.length };

  const score = weighted / total;
  const counted = voting.length;

  let band: Band = 'yellow';
  if (score >= CONSENSUS) band = 'green';
  else if (score <= -CONSENSUS) band = 'red';

  // Both sides carrying real weight is a genuine dispute, and that is worth
  // saying whether or not the arithmetic had already landed on yellow — it is
  // the difference between "sources disagree" and "not enough agreement".
  const contested =
    supportWeight / total >= CONTESTED_SHARE &&
    refuteWeight / total >= CONTESTED_SHARE;

  // A one-sided sample only means anything where the arithmetic claimed
  // confidence; it cannot make an already-yellow verdict more cautious.
  if (band !== 'yellow') {
    const supporters = voting.filter((x) => x.stance === 'supports');
    const buckets = new Set(supporters.map((x) => biasBucket(x.bias)));
    // One outlet agreeing with itself is thin evidence, not a bias pattern.
    if (supporters.length >= 2 && buckets.size === 1) {
      return {
        score,
        band: 'yellow',
        forcedYellowReason: 'single-bucket',
        counted,
      };
    }
  }

  if (contested) {
    return { score, band: 'yellow', forcedYellowReason: 'variance', counted };
  }

  return { score, band, forcedYellowReason: null, counted };
}
