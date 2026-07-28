import { describe, expect, it } from 'vitest';
import {
  rowMath,
  type PopoverSource,
} from '../../../extension/src/content/popover';

const s = (
  name: string,
  factuality: string,
  stance: PopoverSource['stance'],
  independence = 1,
): PopoverSource => ({
  name,
  bias: 'center',
  factuality,
  stance,
  independence,
});

describe('rowMath', () => {
  it('weights each row by factuality times independence', () => {
    const m = rowMath([s('A', 'high', 'supports')]);
    expect(m.rows[0]?.weight).toBeCloseTo(0.8);
    expect(m.rows[0]?.contribution).toBeCloseTo(0.8);
  });

  it('halves the weight of a duplicated source', () => {
    const m = rowMath([s('A', 'high', 'supports', 0.5)]);
    expect(m.rows[0]?.weight).toBeCloseTo(0.4);
  });

  it('signs a refutation negative', () => {
    expect(rowMath([s('A', 'high', 'refutes')]).score).toBeCloseTo(-1);
  });

  it('gives a mixed stance weight but no direction', () => {
    const m = rowMath([s('A', 'high', 'supports'), s('B', 'high', 'mixed')]);
    expect(m.sumWeight).toBeCloseTo(1.6);
    expect(m.sumSigned).toBeCloseTo(0.8);
    expect(m.score).toBeCloseTo(0.5);
  });

  it('the displayed score is exactly the rendered rows divided out', () => {
    // The one invariant this function exists for: a verdict whose shown
    // working does not add up is worse than one showing no working at all.
    const rows = [
      s('A', 'very-high', 'supports'),
      s('B', 'mixed', 'refutes', 0.5),
      s('C', 'low', 'supports'),
    ];
    const m = rowMath(rows);
    const sumW = m.rows.reduce((a, r) => a + r.weight, 0);
    const sumS = m.rows.reduce((a, r) => a + r.contribution, 0);
    expect(m.sumWeight).toBeCloseTo(sumW);
    expect(m.sumSigned).toBeCloseTo(sumS);
    expect(m.score).toBeCloseTo(sumS / sumW);
  });

  it('does not divide by zero when every row is weightless', () => {
    const m = rowMath([s('A', 'high', 'supports', 0)]);
    expect(m.score).toBe(0);
    expect(Number.isNaN(m.score)).toBe(false);
  });

  it('returns zero for no rows at all', () => {
    expect(rowMath([]).score).toBe(0);
  });
});
