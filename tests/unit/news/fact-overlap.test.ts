import { describe, expect, it } from 'vitest';
import { pickNonOverlapping } from '../../../shared/news/fact-overlap';

const sp = (id: string, start: number, end: number) => ({ id, start, end });

describe('pickNonOverlapping', () => {
  it('keeps spans that do not touch', () => {
    const out = pickNonOverlapping([sp('a', 0, 10), sp('b', 20, 30)]);
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('drops a span nested inside a longer one', () => {
    // "31 percent between 2019 and 2024" inside "Ridership on intercity rail
    // fell 31 percent between 2019 and 2024" — painting both would stack two
    // tints on the same words and make a click ambiguous.
    const out = pickNonOverlapping([sp('long', 0, 60), sp('inner', 20, 45)]);
    expect(out.map((s) => s.id)).toEqual(['long']);
  });

  it('prefers the LONGER span regardless of input order', () => {
    const a = pickNonOverlapping([sp('short', 5, 15), sp('long', 0, 60)]);
    const b = pickNonOverlapping([sp('long', 0, 60), sp('short', 5, 15)]);
    expect(a.map((s) => s.id)).toEqual(['long']);
    expect(b.map((s) => s.id)).toEqual(['long']);
  });

  it('drops a partially overlapping span, not just a nested one', () => {
    const out = pickNonOverlapping([sp('a', 0, 50), sp('b', 40, 90)]);
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('returns survivors in document order, not length order', () => {
    // Painting and clicking both read positionally; length order would put a
    // later sentence first and confuse every consumer downstream.
    const out = pickNonOverlapping([
      sp('mid', 100, 130),
      sp('first', 0, 80),
      sp('last', 200, 260),
    ]);
    expect(out.map((s) => s.id)).toEqual(['first', 'mid', 'last']);
  });

  it('treats abutting spans as non-overlapping', () => {
    const out = pickNonOverlapping([sp('a', 0, 10), sp('b', 10, 20)]);
    expect(out).toHaveLength(2);
  });

  it('handles an empty list', () => {
    expect(pickNonOverlapping([])).toEqual([]);
  });

  it('keeps the longest of several mutually overlapping spans', () => {
    const out = pickNonOverlapping([
      sp('a', 0, 20),
      sp('b', 5, 40),
      sp('c', 10, 25),
    ]);
    expect(out.map((s) => s.id)).toEqual(['b']);
  });
});
