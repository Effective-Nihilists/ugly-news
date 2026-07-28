import { describe, expect, it, vi } from 'vitest';

vi.mock('ugly-app/server/adapter/workers', () => ({ createTextGen: vi.fn() }));

const { independenceScores } = await import('../../../server/news/fact');

/** A unit-ish vector pointing mostly along `axis`, with a little noise. */
function vec(axis: number, jitter = 0): number[] {
  const v = new Array<number>(8).fill(0);
  v[axis] = 1;
  v[(axis + 1) % 8] = jitter;
  return v;
}

describe('independenceScores', () => {
  it('gives a lone story full weight', () => {
    expect(independenceScores([vec(0)])).toEqual([1]);
  });

  it('leaves genuinely distinct reporting undiscounted', () => {
    const out = independenceScores([vec(0), vec(1), vec(2)]);
    expect(out).toEqual([1, 1, 1]);
  });

  it('splits weight across near-identical copies of one story', () => {
    // Three mastheads running the same wire copy must count once between them,
    // not three times — that is how a single AP story becomes a "consensus".
    const out = independenceScores([vec(0), vec(0), vec(0)]);
    expect(out).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('discounts only the duplicated cluster, not the independent story', () => {
    const out = independenceScores([vec(0), vec(0), vec(3)]);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBe(1);
  });

  it('treats a missing vector as independent rather than dropping it', () => {
    expect(independenceScores([null, vec(0)])).toEqual([1, 1]);
  });

  it('does not collapse merely related coverage', () => {
    // Same topic, different reporting — similar but below the duplicate line.
    const a = [1, 0.35, 0, 0, 0, 0, 0, 0];
    const b = [1, -0.35, 0, 0, 0, 0, 0, 0];
    expect(independenceScores([a, b])).toEqual([1, 1]);
  });
});
