/**
 * Build an ABSOLUTE push click-target so the ugly-mobile iOS shell can host-match
 * the dock app on tap.
 *
 * The legacy `pushSend` ships `path` verbatim; a relative value ("podcast",
 * "article/9") has no host, so on iOS it can't identify the app and falls through
 * to home (the reported bug). Anchoring to the app origin fixes routing
 * regardless of the browserApp registry's projectId mapping — the dock host-match
 * resolves the app from the URL.
 */

const CANONICAL_ORIGIN = 'https://ugly.press';

/** The app's public origin (worker secret PUBLIC_URL/PROJECT_URL, else prod). */
export function appOrigin(): string {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  // eslint-disable-next-line @typescript-eslint/dot-notation
  const u = env?.['PUBLIC_URL'] || env?.['PROJECT_URL'] || CANONICAL_ORIGIN;
  return u.replace(/\/$/, '');
}

/**
 * Join `origin` with a push click-target. Relative paths/pages are anchored to
 * the origin; an already-absolute url passes through; an empty/missing target
 * opens the app home. Pure (origin passed in) so it's unit-testable.
 */
export function toAbsolutePushPath(origin: string, path: string | undefined): string {
  const base = origin.replace(/\/$/, '');
  const p = (path ?? '').trim();
  if (p === '') return base;
  if (/^https?:\/\//.test(p)) return p;
  return `${base}/${p.replace(/^\//, '')}`;
}

/** Absolutize a click-target against the live app origin. */
export function absolutePushPath(path: string | undefined): string {
  return toAbsolutePushPath(appOrigin(), path);
}
