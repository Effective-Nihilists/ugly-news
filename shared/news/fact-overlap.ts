/**
 * Resolving overlapping claim spans.
 *
 * Telling the model to be exhaustive makes it emit nested assertions: the whole
 * sentence AND the statistic inside it. Both are genuine claims, but painting
 * both stacks two tints on the same words and leaves a click with no single
 * answer. The longest span wins — it carries the most context, and the figure
 * inside it is still covered.
 */

export interface Span {
  id: string;
  start: number;
  end: number;
}

function overlaps(a: Span, b: Span): boolean {
  // Abutting is not overlapping: [0,10) and [10,20) are adjacent sentences.
  return a.start < b.end && b.start < a.end;
}

export function pickNonOverlapping<T extends Span>(spans: readonly T[]): T[] {
  // Longest first, so the winner of any conflict is decided before its rivals
  // are considered. Ties fall back to position for a stable result.
  const byLength = [...spans].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: T[] = [];
  for (const s of byLength) {
    if (kept.some((k) => overlaps(k, s))) continue;
    kept.push(s);
  }
  // Painting and click resolution both read positionally.
  return kept.sort((a, b) => a.start - b.start);
}
