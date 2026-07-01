// Pure helpers shared by the satire ("Ugly Take") surfaces. No DOM / DB deps so
// they're unit-testable and safe to import from client, server, and Worker code.

/** Glyph that marks a line as satire wherever real and fake headlines mix. */
export const SATIRE_MARK = '⌖';

/**
 * Build the home-page ticker line-up: the freshest Ugly Take headlines (clearly
 * marked as satire) followed by the static brand lines. When there are no takes
 * it degrades to just the static lines. Blank headlines are dropped and repeats
 * are de-duplicated case-insensitively; the result is capped at `max` lines.
 */
export function composeTicker(
  staticLines: string[],
  takeHeadlines: string[],
  opts: { max?: number } = {},
): string[] {
  const max = Math.max(opts.max ?? 10, 1);
  const marked = takeHeadlines
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) => `${SATIRE_MARK} ${h}`);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...marked, ...staticLines]) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.slice(0, max);
}
