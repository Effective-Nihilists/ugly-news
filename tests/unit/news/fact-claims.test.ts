import { describe, expect, it } from 'vitest';
import {
  buildClaimPrompt,
  MAX_CLAIMS,
  parseClaims,
} from '../../../shared/news/fact-claims';

const ARTICLE =
  'The Senate passed the bill 51-49 late Thursday. ' +
  'Supporters called it the largest investment in decades. ' +
  'Analysts expect construction to begin next spring.';

describe('buildClaimPrompt', () => {
  it('includes the title and the text', () => {
    const p = buildClaimPrompt('Senate clears bill', ARTICLE);
    expect(p).toContain('Senate clears bill');
    expect(p).toContain('51-49');
  });

  it('truncates very long text so a single call cannot blow the budget', () => {
    const p = buildClaimPrompt('t', 'word '.repeat(20000));
    expect(p.length).toBeLessThan(60_000);
  });
});

describe('parseClaims', () => {
  it('parses a well-formed response', () => {
    const out = JSON.stringify({
      claims: [
        {
          text: 'The Senate passed the bill 51-49 late Thursday',
          class: 'attribution',
          checkable: true,
        },
        {
          text: 'Analysts expect construction to begin next spring',
          class: 'predictive',
          checkable: false,
        },
      ],
    });
    const claims = parseClaims(out, ARTICLE);
    expect(claims).toHaveLength(2);
    expect(claims[0]?.class).toBe('attribution');
    expect(claims[1]?.checkable).toBe(false);
  });

  it('strips markdown fences the model adds anyway', () => {
    const out =
      '```json\n{"claims":[{"text":"The Senate passed the bill 51-49 late Thursday","class":"attribution","checkable":true}]}\n```';
    expect(parseClaims(out, ARTICLE)).toHaveLength(1);
  });

  it('drops claims whose text is not actually in the article', () => {
    const out = JSON.stringify({
      claims: [
        {
          text: 'The Senate passed the bill 51-49 late Thursday',
          class: 'attribution',
          checkable: true,
        },
        {
          text: 'A completely invented sentence',
          class: 'attribution',
          checkable: true,
        },
      ],
    });
    // A hallucinated span cannot be anchored, so it is worse than useless.
    expect(parseClaims(out, ARTICLE)).toHaveLength(1);
  });

  it('coerces an unknown class to attribution rather than dropping the claim', () => {
    const out = JSON.stringify({
      claims: [
        {
          text: 'The Senate passed the bill 51-49 late Thursday',
          class: 'vibes',
          checkable: true,
        },
      ],
    });
    expect(parseClaims(out, ARTICLE)[0]?.class).toBe('attribution');
  });

  it('returns empty for malformed JSON rather than throwing', () => {
    expect(parseClaims('not json at all', ARTICLE)).toEqual([]);
    expect(parseClaims('', ARTICLE)).toEqual([]);
  });

  it('returns empty when claims is missing or not an array', () => {
    expect(parseClaims('{"claims":"nope"}', ARTICLE)).toEqual([]);
    expect(parseClaims('{}', ARTICLE)).toEqual([]);
    expect(parseClaims('null', ARTICLE)).toEqual([]);
  });

  it('deduplicates identical spans', () => {
    const one = {
      text: 'The Senate passed the bill 51-49 late Thursday',
      class: 'attribution',
      checkable: true,
    };
    expect(
      parseClaims(JSON.stringify({ claims: [one, one] }), ARTICLE),
    ).toHaveLength(1);
  });

  it('skips spans too short to anchor reliably', () => {
    const out = JSON.stringify({
      claims: [{ text: 'the bill', class: 'attribution', checkable: true }],
    });
    expect(parseClaims(out, ARTICLE)).toEqual([]);
  });

  it('defaults checkable to true when the model omits it', () => {
    const out = JSON.stringify({
      claims: [
        { text: 'The Senate passed the bill 51-49 late Thursday', class: 'attribution' },
      ],
    });
    expect(parseClaims(out, ARTICLE)[0]?.checkable).toBe(true);
  });

  it('caps the number of claims', () => {
    // Build MAX_CLAIMS + 5 genuinely distinct substrings of a long article.
    const words = Array.from(
      { length: MAX_CLAIMS + 5 },
      (_, i) => `Sentence number ${String(i)} asserts a checkable fact here.`,
    );
    const article = words.join(' ');
    const claims = words.map((text) => ({
      text,
      class: 'attribution',
      checkable: true,
    }));
    expect(
      parseClaims(JSON.stringify({ claims }), article).length,
    ).toBe(MAX_CLAIMS);
  });

  it('ignores non-object entries in the claims array', () => {
    const out = JSON.stringify({
      claims: [
        null,
        'a string',
        42,
        {
          text: 'The Senate passed the bill 51-49 late Thursday',
          class: 'attribution',
          checkable: true,
        },
      ],
    });
    expect(parseClaims(out, ARTICLE)).toHaveLength(1);
  });
});
