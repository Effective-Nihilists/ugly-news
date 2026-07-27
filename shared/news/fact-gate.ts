// Tier 0 of the gate: decide from page shape alone whether this page is worth
// looking at. Pure — the DOM reading that produces PageSignals lives in the
// extension's probe, so this stays unit-testable in a node environment.
//
// A *positive* non-news signal stops the ladder. Absence of a signal is not a
// negative signal: an unrated domain publishing genuine reporting still gets
// through, it just resolves against weaker evidence later.

/** Everything tier 0 needs, already extracted from the document. */
export interface PageSignals {
  /** `<meta property="og:type">`, or null. */
  ogType: string | null;
  /** Every `@type` seen in JSON-LD blocks. May contain duplicates. */
  schemaTypes: string[];
  /** A byline was found (rel=author, .byline, schema author). */
  hasByline: boolean;
  /** `article:published_time` or schema datePublished, or null. */
  publishedTime: string | null;
  /** Visible words in the main text. */
  wordCount: number;
}

export type GateStop = 'commerce' | 'not-article' | 'too-short';

export interface GateVerdict {
  engage: boolean;
  /** null when engaging. */
  stop: GateStop | null;
  /** Always populated — dormant must be explainable, never silent. */
  reason: string;
}

/** Below this, an "article" is a stub, a nav page, or a paywall teaser. */
export const MIN_ARTICLE_WORDS = 150;

const COMMERCE_TYPES = new Set([
  'product',
  'productgroup',
  'offer',
  'aggregateoffer',
  'softwareapplication',
  'mobileapplication',
]);

const ARTICLE_TYPES = new Set([
  'article',
  'newsarticle',
  'reportagenewsarticle',
  'blogposting',
  'opinionnewsarticle',
  'analysisnewsarticle',
  'backgroundnewsarticle',
  'liveblogposting',
]);

export function classifyPage(signals: PageSignals): GateVerdict {
  const types = signals.schemaTypes.map((t) => t.toLowerCase());
  const ogType = signals.ogType === null ? null : signals.ogType.toLowerCase();

  // Commerce wins over everything: plenty of product pages also declare
  // og:type=article. We have no source base for marketing copy, so a positive
  // commerce signal ends it here.
  const commerce =
    (ogType !== null && COMMERCE_TYPES.has(ogType)) ||
    types.some((t) => COMMERCE_TYPES.has(t));
  if (commerce) {
    return {
      engage: false,
      stop: 'commerce',
      reason:
        'This is a product listing. The checker reads public-interest reporting and has no evidence base for marketing copy.',
    };
  }

  const declaredArticle =
    ogType === 'article' || types.some((t) => ARTICLE_TYPES.has(t));
  // Fallback for sites that publish no structured data at all: a byline AND a
  // publication date together are a reasonable article signature. Either alone
  // is not — plenty of product and profile pages carry one.
  const looksLikeArticle = signals.hasByline && signals.publishedTime !== null;

  if (!declaredArticle && !looksLikeArticle) {
    return {
      engage: false,
      stop: 'not-article',
      reason:
        'No article structure found — no article type, and no byline with a publication date.',
    };
  }

  if (signals.wordCount < MIN_ARTICLE_WORDS) {
    return {
      engage: false,
      stop: 'too-short',
      reason: `Only ${String(signals.wordCount)} words of body text — below the ${String(MIN_ARTICLE_WORDS)}-word floor for a checkable article.`,
    };
  }

  return {
    engage: true,
    stop: null,
    reason: declaredArticle
      ? 'Declared article type with enough body text.'
      : 'Byline and publication date with enough body text.',
  };
}
