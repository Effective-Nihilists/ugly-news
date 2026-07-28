import { describe, expect, it } from 'vitest';
import {
  buildStancePrompt,
  parseStances,
  STANCE_SYSTEM_PROMPT,
} from '../../../shared/news/fact-stance';

const EXCERPTS = [
  {
    index: 0,
    outlet: 'Alpha News',
    title: 'Bill passes',
    text: 'The vote was 51-49.',
  },
  {
    index: 1,
    outlet: 'Beta Post',
    title: 'Vote fails',
    text: 'The measure did not pass.',
  },
];

describe('STANCE_SYSTEM_PROMPT', () => {
  it('forbids the model from ruling on truth', () => {
    // The whole anti-bias premise: the model reads, it does not adjudicate.
    expect(STANCE_SYSTEM_PROMPT).toMatch(
      /not decide whether the claim is true/i,
    );
    expect(STANCE_SYSTEM_PROMPT).toMatch(/never use your own knowledge/i);
  });

  it('defines silent as "does not address", so topical drift is not agreement', () => {
    expect(STANCE_SYSTEM_PROMPT).toMatch(/does not address this specific/i);
  });

  it('DEMANDS json, because the proxy does not enforce the schema', () => {
    // Verified live: a schema'd request to this model came back as prose and
    // JSON.parse threw. The schema field is advisory; the prompt is not.
    expect(STANCE_SYSTEM_PROMPT).toMatch(/only json/i);
    expect(STANCE_SYSTEM_PROMPT).toContain('"stances"');
  });
});

describe('buildStancePrompt', () => {
  it('numbers every excerpt and names its outlet', () => {
    const p = buildStancePrompt('The bill passed 51-49', EXCERPTS);
    expect(p).toContain('[0] Alpha News');
    expect(p).toContain('[1] Beta Post');
    expect(p).toContain('The bill passed 51-49');
  });

  it('caps each excerpt so one long article cannot crowd out the rest', () => {
    const long = [
      { index: 0, outlet: 'X', title: 'T', text: 'w'.repeat(50_000) },
    ];
    expect(buildStancePrompt('c', long).length).toBeLessThan(2000);
  });
});

describe('parseStances', () => {
  it('maps answers onto their excerpt index', () => {
    const out = parseStances(
      [
        { index: 1, stance: 'refutes' },
        { index: 0, stance: 'supports' },
      ],
      2,
    );
    expect(out).toEqual(['supports', 'refutes']);
  });

  it('defaults an OMITTED excerpt to silent, never to agreement', () => {
    expect(parseStances([{ index: 0, stance: 'supports' }], 3)).toEqual([
      'supports',
      'silent',
      'silent',
    ]);
  });

  it('treats an unrecognised stance as silent', () => {
    // A garbled answer must not be able to become a green verdict.
    expect(parseStances([{ index: 0, stance: 'probably yes' }], 1)).toEqual([
      'silent',
    ]);
  });

  it('ignores out-of-range and malformed entries', () => {
    const out = parseStances(
      [{ index: 99, stance: 'supports' }, null, 'nope', { stance: 'supports' }],
      2,
    );
    expect(out).toEqual(['silent', 'silent']);
  });

  it('returns all-silent for an empty answer', () => {
    expect(parseStances([], 2)).toEqual(['silent', 'silent']);
  });
});
