import { describe, expect, it } from 'vitest';
import {
  assignToCluster,
  averageFactuality,
  clusterAcceptsArticle,
  computeBiasBreakdown,
  computeClusterScore,
  detectBlindspot,
  toBiasBucket,
  updateCentroid,
} from '../../../shared/news/cluster-logic';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('toBiasBucket', () => {
  it('maps clearly-left scores to left', () => {
    expect(toBiasBucket(-3.5)).toBe('left');
    expect(toBiasBucket(-1.5)).toBe('left');
  });
  it('maps clearly-right scores to right', () => {
    expect(toBiasBucket(3.5)).toBe('right');
    expect(toBiasBucket(1.5)).toBe('right');
  });
  it('treats the [-1, 1] band (inclusive) as center', () => {
    expect(toBiasBucket(0)).toBe('center');
    expect(toBiasBucket(-1)).toBe('center');
    expect(toBiasBucket(1)).toBe('center');
  });
});

describe('computeBiasBreakdown', () => {
  it('counts buckets and computes percentages over RATED sources only', () => {
    const b = computeBiasBreakdown([
      { biasScore: -2.5, factuality: 'high' }, // left
      { biasScore: -1.5, factuality: 'high' }, // left
      { biasScore: 0, factuality: 'high' }, // center
      { biasScore: 3.5, factuality: 'mixed' }, // right
      { biasScore: null, factuality: null }, // unrated → excluded from pct
    ]);
    expect(b.left).toBe(2);
    expect(b.center).toBe(1);
    expect(b.right).toBe(1);
    expect(b.unrated).toBe(1);
    expect(b.total).toBe(4); // rated only
    expect(b.leftPct).toBe(50);
    expect(b.centerPct).toBe(25);
    expect(b.rightPct).toBe(25);
  });
  it('returns all-zero percentages when there are no rated sources', () => {
    const b = computeBiasBreakdown([{ biasScore: null, factuality: null }]);
    expect(b.total).toBe(0);
    expect(b.leftPct).toBe(0);
    expect(b.rightPct).toBe(0);
  });
});

describe('detectBlindspot', () => {
  it('flags a RIGHT blindspot when the left dominates and the right is absent', () => {
    // 14 left, 3 center, 1 right → right is barely covering it
    const members = [
      ...Array(14).fill({ biasScore: -2, factuality: 'high' }),
      ...Array(3).fill({ biasScore: 0, factuality: 'high' }),
      ...Array(1).fill({ biasScore: 3, factuality: 'mixed' }),
    ];
    const b = computeBiasBreakdown(members);
    expect(detectBlindspot(b)).toBe('right');
  });
  it('flags a LEFT blindspot when the right dominates and the left is absent', () => {
    const members = [
      ...Array(11).fill({ biasScore: 3, factuality: 'mixed' }),
      ...Array(2).fill({ biasScore: 0, factuality: 'high' }),
    ];
    const b = computeBiasBreakdown(members);
    expect(detectBlindspot(b)).toBe('left');
  });
  it('returns null for balanced coverage', () => {
    const members = [
      ...Array(5).fill({ biasScore: -2, factuality: 'high' }),
      ...Array(5).fill({ biasScore: 3, factuality: 'mixed' }),
    ];
    expect(detectBlindspot(computeBiasBreakdown(members))).toBeNull();
  });
  it('returns null when there are too few sources to judge', () => {
    const members = [{ biasScore: -2, factuality: 'high' }];
    expect(detectBlindspot(computeBiasBreakdown(members))).toBeNull();
  });
});

describe('assignToCluster', () => {
  const A = [1, 0, 0];
  it('returns the most-similar cluster above threshold', () => {
    const res = assignToCluster(
      A,
      [
        { id: 'c1', centroid: [0.9, 0.1, 0] }, // very similar
        { id: 'c2', centroid: [0, 1, 0] }, // orthogonal
      ],
      0.82,
    );
    expect(res?.clusterId).toBe('c1');
  });
  it('returns null when nothing clears the threshold', () => {
    const res = assignToCluster(A, [{ id: 'c2', centroid: [0, 1, 0] }], 0.82);
    expect(res).toBeNull();
  });
  it('skips candidates with null or mismatched-length centroids', () => {
    const res = assignToCluster(A, [
      { id: 'c1', centroid: null },
      { id: 'c2', centroid: [1, 0] },
    ]);
    expect(res).toBeNull();
  });
});

describe('updateCentroid', () => {
  it('returns a copy of the embedding when there is no prior centroid', () => {
    expect(updateCentroid(null, 0, [1, 2, 3])).toEqual([1, 2, 3]);
  });
  it('computes the running mean given the prior member count', () => {
    // prior centroid [0,0,0] from 1 member, adding [2,2,2] → mean [1,1,1]
    expect(updateCentroid([0, 0, 0], 1, [2, 2, 2])).toEqual([1, 1, 1]);
  });
});

describe('averageFactuality', () => {
  it('averages factuality tiers on a 1..5 scale', () => {
    // high(4) + very-high(5) → 4.5
    expect(averageFactuality(['high', 'very-high'])).toBe(4.5);
  });
  it('returns null with no rated sources', () => {
    expect(averageFactuality([])).toBeNull();
  });
});

describe('clusterAcceptsArticle (date gating)', () => {
  const now = 1_000 * DAY; // arbitrary fixed "now"
  it('accepts a fresh article into a recently-active young cluster', () => {
    const timing = { firstSeenAt: now - 6 * HOUR, lastUpdatedAt: now - 1 * HOUR };
    expect(clusterAcceptsArticle(timing, now, now)).toBe(true);
  });
  it('rejects a cluster older than the max age (anchored to firstSeenAt)', () => {
    // active 1h ago, but it first appeared 6 days ago → too old to keep growing
    const timing = { firstSeenAt: now - 6 * DAY, lastUpdatedAt: now - 1 * HOUR };
    expect(clusterAcceptsArticle(timing, now, now)).toBe(false);
  });
  it('rejects an article whose own date is far from the cluster activity', () => {
    const timing = { firstSeenAt: now - 6 * HOUR, lastUpdatedAt: now - 1 * HOUR };
    // a 5-day-old backfilled article should not merge into a current cluster
    expect(clusterAcceptsArticle(timing, now - 5 * DAY, now)).toBe(false);
  });
  it('honors custom windows', () => {
    const timing = { firstSeenAt: now - 2 * DAY, lastUpdatedAt: now - 2 * HOUR };
    expect(clusterAcceptsArticle(timing, now, now, { maxClusterAgeMs: 1 * DAY })).toBe(false);
    expect(clusterAcceptsArticle(timing, now, now, { maxClusterAgeMs: 3 * DAY })).toBe(true);
  });
});

describe('computeClusterScore', () => {
  it('ranks a broad, multi-side, fresh, engaged cluster above a narrow stale one', () => {
    const big = computeClusterScore({ articleCount: 30, distinctBuckets: 3, ageHours: 1, engagement: 50 });
    const small = computeClusterScore({ articleCount: 2, distinctBuckets: 1, ageHours: 40, engagement: 0 });
    expect(big).toBeGreaterThan(small);
  });
});
