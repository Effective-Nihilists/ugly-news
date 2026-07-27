import { describe, expect, it } from 'vitest';
import {
  classifyPage,
  MIN_ARTICLE_WORDS,
  type PageSignals,
} from '../../../shared/news/fact-gate';

const base: PageSignals = {
  ogType: null,
  schemaTypes: [],
  hasByline: false,
  publishedTime: null,
  wordCount: 0,
};

describe('classifyPage', () => {
  it('engages on an og:type=article page with enough words', () => {
    const v = classifyPage({ ...base, ogType: 'article', wordCount: 600 });
    expect(v.engage).toBe(true);
    expect(v.stop).toBeNull();
  });

  it('engages on schema.org NewsArticle', () => {
    const v = classifyPage({
      ...base,
      schemaTypes: ['NewsArticle'],
      wordCount: 600,
    });
    expect(v.engage).toBe(true);
  });

  it('engages on schema.org Article and BlogPosting', () => {
    for (const t of ['Article', 'BlogPosting', 'ReportageNewsArticle']) {
      expect(
        classifyPage({ ...base, schemaTypes: [t], wordCount: 600 }).engage,
      ).toBe(true);
    }
  });

  it('stops on commerce even when the page also claims to be an article', () => {
    const v = classifyPage({
      ...base,
      ogType: 'article',
      schemaTypes: ['Product', 'Offer'],
      wordCount: 600,
    });
    expect(v.engage).toBe(false);
    expect(v.stop).toBe('commerce');
  });

  it('stops on commerce for Offer, AggregateOffer and SoftwareApplication', () => {
    for (const t of ['Offer', 'AggregateOffer', 'SoftwareApplication']) {
      const v = classifyPage({ ...base, schemaTypes: [t], wordCount: 600 });
      expect(v.stop).toBe('commerce');
    }
  });

  it('stops on commerce from og:type=product', () => {
    expect(
      classifyPage({ ...base, ogType: 'product', wordCount: 600 }).stop,
    ).toBe('commerce');
  });

  it('engages on the byline+date heuristic when no schema is present', () => {
    const v = classifyPage({
      ...base,
      hasByline: true,
      publishedTime: '2026-07-27T10:00:00Z',
      wordCount: 600,
    });
    expect(v.engage).toBe(true);
  });

  it('does not engage on a byline alone without a date', () => {
    const v = classifyPage({ ...base, hasByline: true, wordCount: 600 });
    expect(v.engage).toBe(false);
    expect(v.stop).toBe('not-article');
  });

  it('stops as not-article on a bare page', () => {
    const v = classifyPage({ ...base, wordCount: 600 });
    expect(v.stop).toBe('not-article');
  });

  it('stops as too-short when article-shaped but under the word floor', () => {
    const v = classifyPage({
      ...base,
      ogType: 'article',
      wordCount: MIN_ARTICLE_WORDS - 1,
    });
    expect(v.engage).toBe(false);
    expect(v.stop).toBe('too-short');
  });

  it('engages exactly at the word floor', () => {
    const v = classifyPage({
      ...base,
      ogType: 'article',
      wordCount: MIN_ARTICLE_WORDS,
    });
    expect(v.engage).toBe(true);
  });

  it('is case-insensitive about type names', () => {
    expect(
      classifyPage({ ...base, schemaTypes: ['newsarticle'], wordCount: 600 })
        .engage,
    ).toBe(true);
    expect(
      classifyPage({ ...base, schemaTypes: ['PRODUCT'], wordCount: 600 }).stop,
    ).toBe('commerce');
  });

  it('always explains itself', () => {
    for (const s of [
      { ...base, wordCount: 600 },
      { ...base, ogType: 'product', wordCount: 600 },
      { ...base, ogType: 'article', wordCount: 10 },
      { ...base, ogType: 'article', wordCount: 600 },
    ]) {
      expect(classifyPage(s).reason.length).toBeGreaterThan(0);
    }
  });
});
