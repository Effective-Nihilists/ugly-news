// The news "author" bot. News article files are owned by this user id, and the
// feed/search query filter on it. Host 2 of the daily podcast is also this bot.
// Value preserved from ugly.bot for data continuity.
export const uglyBotId = 'jY0oTxnxd3Ff5AQn6qpFJ';

// Small dependency-free helpers (ported from ugly.bot shared/Helper).
export function isDefined<T>(x: T | null | undefined): x is T {
  return x !== null && x !== undefined;
}

export function isStringEmpty(x: string | null | undefined): boolean {
  return x === null || x === undefined || x.trim().length === 0;
}
