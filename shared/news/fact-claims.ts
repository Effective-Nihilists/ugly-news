// Claim segmentation: prompt construction and response parsing.
// Pure so it unit-tests without a model call; the model call lives in
// server/news/fact.ts.

import { findFlexible } from './fact-anchor';

export const claimClasses = [
  'quantitative',
  'attribution',
  'causal',
  'predictive',
] as const;
export type ClaimClass = (typeof claimClasses)[number];

export interface RawClaim {
  text: string;
  class: ClaimClass;
  checkable: boolean;
}

/** One model call per article, so the ARTICLE is capped, not the claim count. */
const MAX_TEXT_CHARS = 24_000;

/** More than this on one page is noise no reader will work through. Raised
 *  once the cap, rather than the model, started being the binding limit. */
export const MAX_CLAIMS = 40;

/** Shorter spans anchor ambiguously — "the bill" occurs everywhere. */
const MIN_CLAIM_CHARS = 12;

export const CLAIM_SYSTEM_PROMPT = [
  'You extract factual claims from news articles.',
  'Return ONLY JSON: {"claims":[{"text":string,"class":string,"checkable":boolean}]}',
  'RULES:',
  '- "text" MUST be an exact substring of the article, copied character for character.',
  '- Do not paraphrase, do not fix typos, do not merge sentences.',
  '- class is one of: quantitative, attribution, causal, predictive.',
  '- checkable=false for opinion, hypotheticals, rhetorical questions and',
  '  forward-looking predictions. Those are never rated.',
  '- Be EXHAUSTIVE. Extract EVERY factual assertion, not a selection of the',
  '  most interesting ones. A typical news article contains 10-25 of them.',
  '- Include statistics, dates, quantities, named actions, attributed',
  '  statements, and cause-and-effect claims — each as its own entry.',
  '- Do not merge two assertions into one entry, and do not skip an assertion',
  '  because it seems minor or because a similar one appears earlier.',
].join('\n');

export function buildClaimPrompt(title: string, text: string): string {
  const body =
    text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  return `TITLE: ${title}\n\nARTICLE:\n${body}`;
}

function stripFences(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function toClass(v: unknown): ClaimClass {
  return typeof v === 'string' &&
    (claimClasses as readonly string[]).includes(v)
    ? (v as ClaimClass)
    : 'attribution';
}

/**
 * Parse, then verify every span against the article.
 *
 * A hallucinated span is worse than a missing one: it cannot be anchored, so it
 * would either vanish silently or, if we were sloppy downstream, highlight the
 * wrong text. Dropping it here is the cheapest place to catch it.
 */
export function parseClaims(
  modelOutput: string,
  articleText: string,
): RawClaim[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(modelOutput));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const rawList = (parsed as { claims?: unknown }).claims;
  if (!Array.isArray(rawList)) return [];
  return filterClaims(rawList, articleText);
}

/**
 * The validation half, shared by both paths into the model.
 *
 * Structured output guarantees the SHAPE but says nothing about whether a span
 * is really in the article — the model can still invent one, and that is the
 * failure that matters here.
 */
export function filterClaims(
  rawList: readonly unknown[],
  articleText: string,
): RawClaim[] {
  const seen = new Set<string>();
  const out: RawClaim[] = [];
  for (const item of rawList) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (text.length < MIN_CLAIM_CHARS) continue;
    // Whitespace-tolerant: HTML source is line-wrapped, so the article text has
    // newlines mid-sentence that the model will have normalised to spaces. A
    // literal includes() would drop most real claims.
    if (findFlexible(articleText, text).length === 0) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({
      text,
      class: toClass(rec.class),
      checkable: rec.checkable !== false,
    });
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}
