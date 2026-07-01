import { describe, expect, it } from 'vitest';
import { SATIRE_MARK, composeTicker } from '../../../shared/news/satire-ui';

describe('composeTicker', () => {
  const STATIC = ['Left. Right. Ugly.', '60+ sources, zero hold music'];

  it('falls back to the static lines when there are no Ugly Takes', () => {
    expect(composeTicker(STATIC, [])).toEqual(STATIC);
  });

  it('marks each satire headline with the satire glyph', () => {
    const out = composeTicker([], ['Congress Declares War On Mondays']);
    expect(out).toEqual([`${SATIRE_MARK} Congress Declares War On Mondays`]);
  });

  it('places satire headlines before the static brand lines', () => {
    const out = composeTicker(STATIC, ['Nation Shrugs']);
    expect(out[0]).toBe(`${SATIRE_MARK} Nation Shrugs`);
    expect(out).toContain('Left. Right. Ugly.');
  });

  it('drops blank/whitespace-only satire headlines', () => {
    const out = composeTicker([], ['  ', '', 'Real One']);
    expect(out).toEqual([`${SATIRE_MARK} Real One`]);
  });

  it('dedupes repeated headlines case-insensitively', () => {
    const out = composeTicker(['Nation Shrugs'], ['Nation shrugs', 'Nation Shrugs']);
    // the two identical takes collapse to one satire-marked line; the static
    // line stays (different string once marked)
    expect(out.filter((l) => /shrugs/i.test(l))).toEqual([
      `${SATIRE_MARK} Nation shrugs`,
      'Nation Shrugs',
    ]);
  });

  it('caps the total number of lines', () => {
    const takes = Array.from({ length: 20 }, (_, i) => `Headline ${i}`);
    expect(composeTicker(STATIC, takes, { max: 6 })).toHaveLength(6);
  });
});
