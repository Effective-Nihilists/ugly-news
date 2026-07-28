import { describe, expect, it } from 'vitest';
import {
  biasBucket,
  factualityWeight,
  tally,
  type StanceEntry,
} from '../../../shared/news/fact-tally';

const e = (
  sourceId: string,
  bias: StanceEntry['bias'],
  factuality: StanceEntry['factuality'],
  stance: StanceEntry['stance'],
  independence = 1,
): StanceEntry => ({
  sourceId,
  name: sourceId,
  bias,
  factuality,
  stance,
  independence,
});

describe('factualityWeight', () => {
  it('is monotonic from very-low to very-high', () => {
    const order = ['very-low', 'low', 'mixed', 'high', 'very-high'] as const;
    const weights = order.map(factualityWeight);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeGreaterThan(weights[i - 1]!);
    }
  });
});

describe('biasBucket', () => {
  it('collapses the seven ratings onto three sides', () => {
    expect(biasBucket('far-left')).toBe('left');
    expect(biasBucket('lean-left')).toBe('left');
    expect(biasBucket('center')).toBe('center');
    expect(biasBucket('lean-right')).toBe('right');
    expect(biasBucket('far-right')).toBe('right');
  });
});

describe('tally', () => {
  it('returns unverified with no entries', () => {
    expect(tally([]).band).toBe('unverified');
  });

  it('returns unverified when every source is silent', () => {
    // Silence is not agreement. A claim nobody else covered is unverified,
    // never green.
    const t = tally([
      e('a', 'center', 'high', 'silent'),
      e('b', 'left', 'high', 'silent'),
    ]);
    expect(t.band).toBe('unverified');
    expect(t.counted).toBe(0);
  });

  it('excludes silent sources from BOTH sides of the ratio', () => {
    const withSilent = tally([
      e('a', 'center', 'high', 'supports'),
      e('b', 'center', 'high', 'silent'),
    ]);
    const without = tally([e('a', 'center', 'high', 'supports')]);
    expect(withSilent.score).toBeCloseTo(without.score);
    expect(withSilent.counted).toBe(1);
  });

  it('greens a cross-spectrum consensus', () => {
    const t = tally([
      e('a', 'left', 'high', 'supports'),
      e('b', 'center', 'very-high', 'supports'),
      e('c', 'right', 'high', 'supports'),
    ]);
    expect(t.band).toBe('green');
    expect(t.forcedYellowReason).toBeNull();
  });

  it('FORCES yellow when every supporter sits in one bias bucket', () => {
    // The arithmetic says consensus; the sample says one side of the room.
    const t = tally([
      e('a', 'right', 'mixed', 'supports'),
      e('b', 'far-right', 'mixed', 'supports'),
      e('c', 'right', 'high', 'supports'),
    ]);
    expect(t.score).toBeGreaterThan(0.75);
    expect(t.band).toBe('yellow');
    expect(t.forcedYellowReason).toBe('single-bucket');
  });

  it('does NOT force single-bucket on a lone supporter', () => {
    // One source is not a bias pattern, it is just thin evidence.
    const t = tally([e('a', 'right', 'high', 'supports')]);
    expect(t.forcedYellowReason).toBeNull();
  });

  it('FORCES yellow on high stance variance', () => {
    const t = tally([
      e('a', 'left', 'high', 'supports'),
      e('b', 'center', 'very-high', 'refutes'),
      e('c', 'right', 'high', 'supports'),
      e('d', 'center', 'high', 'refutes'),
    ]);
    expect(t.band).toBe('yellow');
    expect(t.forcedYellowReason).toBe('variance');
  });

  it('reds a claim the highest-weighted sources refute', () => {
    const t = tally([
      e('a', 'center', 'very-high', 'refutes'),
      e('b', 'center', 'very-high', 'refutes'),
      e('c', 'left', 'high', 'refutes'),
      e('d', 'right', 'mixed', 'supports', 0.3),
    ]);
    expect(t.band).toBe('red');
  });

  it('lets the independence discount change the band', () => {
    const correlated = [
      e('a', 'center', 'very-high', 'refutes'),
      e('b', 'center', 'very-high', 'refutes'),
      e('c', 'right', 'mixed', 'supports', 0.3),
      e('d', 'right', 'mixed', 'supports', 0.3),
      e('f', 'right', 'mixed', 'supports', 0.3),
    ];
    const independent = correlated.map((x) => ({ ...x, independence: 1 }));
    expect(tally(correlated).score).toBeLessThan(tally(independent).score);
  });

  it('treats a mixed stance as weight without direction', () => {
    // A source that says "partly" must dilute a consensus, not vanish from it.
    const withMixed = tally([
      e('a', 'left', 'high', 'supports'),
      e('b', 'center', 'high', 'supports'),
      e('c', 'right', 'high', 'mixed'),
    ]);
    expect(withMixed.counted).toBe(3);
    expect(withMixed.score).toBeLessThan(1);
  });

  it('never returns a score outside [-1, 1]', () => {
    for (const t of [
      tally([e('a', 'left', 'very-high', 'supports')]),
      tally([e('a', 'left', 'very-low', 'refutes')]),
      tally([]),
    ]) {
      expect(t.score).toBeGreaterThanOrEqual(-1);
      expect(t.score).toBeLessThanOrEqual(1);
    }
  });

  it('ignores a zero-weight source rather than dividing by zero', () => {
    // Unrated sources arrive with weight 0; they must not produce NaN.
    const t = tally([e('a', 'center', 'high', 'supports', 0)]);
    expect(Number.isNaN(t.score)).toBe(false);
    expect(t.band).toBe('unverified');
  });
});
