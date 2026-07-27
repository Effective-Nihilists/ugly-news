import { describe, expect, it } from 'vitest';
import {
  buildSelector,
  resolveSelector,
} from '../../../shared/news/fact-anchor';

const QUOTE = 'The Senate passed the bill 51-49 late Thursday';
const TEXT =
  `Alpha beta gamma. ${QUOTE}. ` + `Delta epsilon. ${QUOTE} again.`;

describe('buildSelector', () => {
  it('captures prefix and suffix context', () => {
    const sel = buildSelector(TEXT, QUOTE);
    expect(sel).not.toBeNull();
    expect(sel?.exact).toContain('51-49');
    expect(sel?.prefix.endsWith('Alpha beta gamma. ')).toBe(true);
  });

  it('returns null when the text is absent', () => {
    expect(buildSelector(TEXT, 'nowhere to be found')).toBeNull();
  });

  it('can build a selector for a later occurrence', () => {
    const first = buildSelector(TEXT, QUOTE);
    const second = buildSelector(TEXT, QUOTE, 40);
    expect(first?.prefix).not.toBe(second?.prefix);
  });
});

describe('resolveSelector', () => {
  it('round-trips an unchanged document', () => {
    const sel = buildSelector(TEXT, QUOTE);
    const hit = resolveSelector(TEXT, sel!);
    expect(hit).not.toBeNull();
    expect(TEXT.slice(hit!.start, hit!.end)).toBe(sel!.exact);
  });

  it('disambiguates repeated text using context', () => {
    const second = buildSelector(TEXT, QUOTE, 40);
    const hit = resolveSelector(TEXT, second!);
    expect(hit!.start).toBeGreaterThan(50);
  });

  it('still resolves after unrelated text is inserted before it', () => {
    const sel = buildSelector(TEXT, QUOTE);
    const mutated = `AN AD APPEARED HERE. ${TEXT}`;
    const hit = resolveSelector(mutated, sel!);
    expect(mutated.slice(hit!.start, hit!.end)).toBe(sel!.exact);
  });

  it('resolves when surrounding context changed but the quote did not', () => {
    const sel = buildSelector(TEXT, QUOTE);
    const mutated = TEXT.replace('Alpha beta gamma.', 'Totally different lead-in.');
    const hit = resolveSelector(mutated, sel!);
    expect(mutated.slice(hit!.start, hit!.end)).toBe(sel!.exact);
  });

  it('returns null when the quote is gone entirely', () => {
    const sel = buildSelector(TEXT, QUOTE);
    expect(resolveSelector('completely different document', sel!)).toBeNull();
  });

  it('picks the FIRST occurrence when context matches it best', () => {
    const first = buildSelector(TEXT, QUOTE);
    const hit = resolveSelector(TEXT, first!);
    expect(hit!.start).toBe(TEXT.indexOf(QUOTE));
  });

  it('handles a quote at the very start of the document', () => {
    const text = `${QUOTE}. Trailing content follows here.`;
    const sel = buildSelector(text, QUOTE);
    expect(sel?.prefix).toBe('');
    const hit = resolveSelector(text, sel!);
    expect(hit).toEqual({ start: 0, end: QUOTE.length });
  });

  it('handles a quote at the very end of the document', () => {
    const text = `Leading content here. ${QUOTE}`;
    const sel = buildSelector(text, QUOTE);
    expect(sel?.suffix).toBe('');
    const hit = resolveSelector(text, sel!);
    expect(text.slice(hit!.start, hit!.end)).toBe(QUOTE);
  });
});
