import { describe, expect, it } from 'vitest';
import {
  badgeFor,
  BADGE_DORMANT,
  BADGE_ENGAGED,
} from '../../../extension/src/shared/badge';
import type { PageReport } from '../../../extension/src/shared/messages';

const engaged: PageReport = {
  verdict: { engage: true, stop: null, reason: 'ok' },
  rating: {
    id: 'fox',
    name: 'Fox News',
    bias: 'right',
    biasScore: 3.5,
    factuality: 'mixed',
    owner: 'Fox Corporation',
    country: 'US',
  },
  host: 'foxnews.com',
};

describe('badgeFor', () => {
  it('marks an engaged rated page with the engaged colour', () => {
    const b = badgeFor(engaged);
    expect(b.color).toBe(BADGE_ENGAGED);
    expect(b.title).toContain('Fox News');
  });

  it('names the publisher rating in the title', () => {
    expect(badgeFor(engaged).title).toContain('mixed');
  });

  it('signs a positive bias score', () => {
    expect(badgeFor(engaged).title).toContain('+3.5');
  });

  it('signs a negative bias score without doubling the minus', () => {
    const b = badgeFor({
      ...engaged,
      rating: { ...engaged.rating!, bias: 'center', biasScore: -0.5 },
    });
    expect(b.title).toContain('-0.5');
    expect(b.title).not.toContain('+-');
  });

  it('marks a dormant page with the dormant colour and no text', () => {
    const b = badgeFor({
      ...engaged,
      verdict: { engage: false, stop: 'commerce', reason: 'product listing' },
    });
    expect(b.color).toBe(BADGE_DORMANT);
    expect(b.text).toBe('');
    expect(b.title).toContain('Dormant');
    expect(b.title).toContain('product listing');
  });

  it('handles an engaged page from an unrated publisher', () => {
    const b = badgeFor({ ...engaged, rating: null });
    expect(b.color).toBe(BADGE_ENGAGED);
    expect(b.title).toContain('Unrated');
    expect(b.title).toContain('foxnews.com');
  });
});
