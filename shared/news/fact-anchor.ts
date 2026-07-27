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

export function buildSelector(
  text: string,
  exact: string,
  from = 0,
): TextQuoteSelector | null {
  const start = text.indexOf(exact, from);
  if (start === -1) return null;
  return {
    exact,
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(start + exact.length, start + exact.length + CONTEXT),
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
  const hits: number[] = [];
  for (
    let i = text.indexOf(sel.exact);
    i !== -1;
    i = text.indexOf(sel.exact, i + 1)
  ) {
    hits.push(i);
  }
  if (hits.length === 0) return null;

  const first = hits[0];
  if (first === undefined) return null;
  if (hits.length === 1) {
    return { start: first, end: first + sel.exact.length };
  }

  let best = first;
  let bestScore = -1;
  for (const at of hits) {
    const before = text.slice(Math.max(0, at - CONTEXT), at);
    const after = text.slice(
      at + sel.exact.length,
      at + sel.exact.length + CONTEXT,
    );
    const score =
      commonSuffix(before, sel.prefix) + commonPrefix(after, sel.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return { start: best, end: best + sel.exact.length };
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
