// W3C Web Annotation TextQuoteSelector — offset maths only.
//
// The quote plus its surrounding context is what survives ad reflow, lazy
// loading and SPA re-render: absolute offsets shift, but "this exact sentence,
// preceded by roughly this text" usually does not.
//
// Deliberately free of any DOM reference so it unit-tests in node. The Range
// walk that consumes these offsets lives in the extension's text-map.

export interface TextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

/** Enough context to disambiguate repeats without bloating what we store. */
const CONTEXT = 32;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match a quote across ANY whitespace run.
 *
 * HTML source is line-wrapped, so the DOM text of a sentence routinely reads
 * "the National\n        Transit". A model told to copy exactly will still
 * usually hand back "the National Transit". Requiring a literal match would
 * therefore drop most real claims — silently, which is the worst way to fail.
 */
function flexPattern(exact: string): RegExp {
  const parts = exact.trim().split(/\s+/).map(escapeRegex);
  return new RegExp(parts.join('\\s+'), 'g');
}

/** All occurrences of `exact`, tolerant of differing whitespace runs. */
export function findFlexible(
  text: string,
  exact: string,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = flexPattern(exact);
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length });
    // Zero-length matches cannot happen here, but guard the loop anyway.
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

export function buildSelector(
  text: string,
  exact: string,
  from = 0,
): TextQuoteSelector | null {
  const hit = findFlexible(text, exact).find((h) => h.start >= from);
  if (hit === undefined) return null;
  return {
    exact,
    prefix: text.slice(Math.max(0, hit.start - CONTEXT), hit.start),
    suffix: text.slice(hit.end, hit.end + CONTEXT),
  };
}

/**
 * Find every occurrence of `exact`, then pick the one whose neighbourhood best
 * matches the recorded context. A single occurrence wins outright; repeats are
 * scored by how many trailing prefix / leading suffix characters agree.
 */
export function resolveSelector(
  text: string,
  sel: TextQuoteSelector,
): { start: number; end: number } | null {
  const hits = findFlexible(text, sel.exact);
  const first = hits[0];
  if (first === undefined) return null;
  if (hits.length === 1) return first;

  let best = first;
  let bestScore = -1;
  for (const at of hits) {
    const before = text.slice(Math.max(0, at.start - CONTEXT), at.start);
    const after = text.slice(at.end, at.end + CONTEXT);
    const score =
      commonSuffix(before, sel.prefix) + commonPrefix(after, sel.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return best;
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
