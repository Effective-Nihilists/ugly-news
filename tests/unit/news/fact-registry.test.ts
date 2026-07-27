import { describe, expect, it } from 'vitest';
import {
  buildRegistryIndex,
  lookupRating,
  normalizeHost,
  type RegistryIndex,
} from '../../../shared/news/fact-registry';
import { newsSourceSeeds } from '../../../shared/news/sourceBias';

const index: RegistryIndex = buildRegistryIndex([
  {
    id: 'bbc',
    name: 'BBC News',
    homepage: 'https://www.bbc.com/news',
    domains: ['bbc.com', 'bbc.co.uk'],
    feedIds: ['bbc_world'],
    bias: 'center',
    biasScore: -0.5,
    factuality: 'high',
    owner: 'BBC (UK public)',
    country: 'UK',
  },
  {
    id: 'cnn',
    name: 'CNN',
    homepage: 'https://cnn.com',
    domains: ['cnn.com'],
    feedIds: ['cnn'],
    bias: 'lean-left',
    biasScore: -2,
    factuality: 'mixed',
    owner: 'Warner Bros. Discovery',
    country: 'US',
  },
]);

describe('normalizeHost', () => {
  it('lowercases and strips www', () => {
    expect(normalizeHost('WWW.BBC.CO.UK')).toBe('bbc.co.uk');
  });
  it('strips a trailing dot and port', () => {
    expect(normalizeHost('cnn.com.:8080')).toBe('cnn.com');
  });
  it('leaves a bare host alone', () => {
    expect(normalizeHost('cnn.com')).toBe('cnn.com');
  });
});

describe('lookupRating', () => {
  it('finds an exact domain', () => {
    expect(lookupRating('cnn.com', index)?.name).toBe('CNN');
  });

  it('finds via www', () => {
    expect(lookupRating('www.cnn.com', index)?.name).toBe('CNN');
  });

  it('falls back from a subdomain to the registered domain', () => {
    expect(lookupRating('edition.cnn.com', index)?.name).toBe('CNN');
  });

  it('handles a multi-label public suffix without a PSL', () => {
    // Walking suffixes longest-first finds bbc.co.uk before reaching co.uk,
    // and co.uk is never in the index, so no PSL is needed.
    expect(lookupRating('news.bbc.co.uk', index)?.name).toBe('BBC News');
  });

  it('returns null for an unknown host', () => {
    expect(lookupRating('example.com', index)).toBeNull();
  });

  it('does not match a domain that merely ends with a known one', () => {
    expect(lookupRating('notcnn.com', index)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(lookupRating('', index)).toBeNull();
  });

  it('carries bias, factuality, owner and country through', () => {
    const r = lookupRating('bbc.com', index);
    expect(r).not.toBeNull();
    expect(r?.bias).toBe('center');
    expect(r?.biasScore).toBe(-0.5);
    expect(r?.factuality).toBe('high');
    expect(r?.owner).toBe('BBC (UK public)');
    expect(r?.country).toBe('UK');
  });
});

describe('buildRegistryIndex over the real seeds', () => {
  it('indexes every domain of every seed', () => {
    const real = buildRegistryIndex(newsSourceSeeds);
    for (const seed of newsSourceSeeds) {
      for (const d of seed.domains) {
        expect(real[d]?.id).toBe(seed.id);
      }
    }
  });

  it('produces a non-trivial index', () => {
    expect(
      Object.keys(buildRegistryIndex(newsSourceSeeds)).length,
    ).toBeGreaterThan(50);
  });
});
