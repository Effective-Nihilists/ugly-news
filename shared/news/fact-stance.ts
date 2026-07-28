// Stance extraction: what OTHER outlets' coverage says about one claim.
//
// Pure — prompt construction and response validation only. The retrieval and
// the model call live in server/news/fact.ts.
//
// The prompt deliberately never asks whether the claim is TRUE. The model's
// opinion of the world is exactly the bias this feature exists to avoid; its
// job here is reading comprehension over retrieved text, nothing more.

import type { Stance } from './fact-tally';

export interface StanceExcerpt {
  /** Position in the prompt list; the model answers by index. */
  index: number;
  outlet: string;
  title: string;
  text: string;
}

/** Enough to judge a stance, short enough to fit many sources in one call. */
const EXCERPT_CHARS = 500;

/**
 * The JSON instruction is LOAD-BEARING, not belt-and-braces.
 *
 * `generateJson` sends the schema to the proxy, but for this model the proxy
 * treats it as advisory — verified live, where a schema'd request came back as
 * prose and `JSON.parse` threw "Unexpected token 'H', \"Here are t\"...". The
 * format has to be demanded in the prompt, exactly as the claim prompt does.
 */
export const STANCE_SYSTEM_PROMPT = [
  'You compare a CLAIM against excerpts from other news outlets.',
  'For each numbered excerpt, decide what THAT EXCERPT does with the claim.',
  'Return ONLY JSON, with no prose before or after:',
  '{"stances":[{"index":number,"stance":string}]}',
  'stance is one of:',
  '- "supports"  the excerpt asserts the same thing',
  '- "refutes"   the excerpt asserts something incompatible with it',
  '- "mixed"     the excerpt partly agrees and partly disagrees',
  '- "silent"    the excerpt does not address the claim at all',
  'RULES:',
  '- Judge ONLY what the excerpt says. Never use your own knowledge.',
  '- Do NOT decide whether the claim is true. That is not your task.',
  '- An excerpt on the same general topic that does not address this specific',
  '  claim is "silent", not "supports".',
  '- Return one entry per excerpt, using its number.',
].join('\n');

export function buildStancePrompt(
  claim: string,
  excerpts: readonly StanceExcerpt[],
): string {
  const body = excerpts
    .map(
      (x) =>
        `[${String(x.index)}] ${x.outlet} — ${x.title}\n${x.text.slice(0, EXCERPT_CHARS)}`,
    )
    .join('\n\n');
  return `CLAIM: ${claim}\n\nEXCERPTS:\n${body}`;
}

const STANCES: readonly Stance[] = ['supports', 'refutes', 'mixed', 'silent'];

function toStance(v: unknown): Stance {
  // Anything unrecognised is treated as SILENT, never as agreement — an
  // unparseable answer must not be able to turn into a green verdict.
  return typeof v === 'string' && (STANCES as readonly string[]).includes(v)
    ? (v as Stance)
    : 'silent';
}

/**
 * Map the model's answers back onto excerpt indices.
 *
 * Any excerpt the model omitted stays silent by omission, for the same reason:
 * a missing answer is not evidence.
 */
export function parseStances(
  items: readonly unknown[],
  count: number,
): Stance[] {
  const out: Stance[] = Array.from({ length: count }, () => 'silent');
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as { index?: unknown; stance?: unknown };
    const i = typeof rec.index === 'number' ? rec.index : -1;
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    out[i] = toStance(rec.stance);
  }
  return out;
}
