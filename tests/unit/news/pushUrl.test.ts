import { describe, it, expect } from 'vitest';
import { toAbsolutePushPath, absolutePushPath } from '../../../server/news/pushUrl';

/**
 * Push click-targets must be ABSOLUTE so the ugly-mobile iOS shell can host-match
 * the dock app on tap. ugly-news shipped a relative `path: 'podcast'` which has no
 * host and fell through to home (the reported bug). `toAbsolutePushPath` anchors a
 * relative target to the app origin; `absolutePushPath` uses the live origin
 * (PUBLIC_URL, else https://ugly.press).
 */
describe('toAbsolutePushPath', () => {
  const origin = 'https://ugly.press';

  it('anchors a bare page to the app origin', () => {
    expect(toAbsolutePushPath(origin, 'podcast')).toBe('https://ugly.press/podcast');
  });

  it('anchors a leading-slash path to the app origin', () => {
    expect(toAbsolutePushPath(origin, '/article/9')).toBe('https://ugly.press/article/9');
  });

  it('passes an already-absolute url through unchanged', () => {
    expect(toAbsolutePushPath(origin, 'https://ugly.press/podcast')).toBe(
      'https://ugly.press/podcast',
    );
  });

  it('returns the app home for an empty / missing target', () => {
    expect(toAbsolutePushPath(origin, '')).toBe('https://ugly.press');
    expect(toAbsolutePushPath(origin, undefined)).toBe('https://ugly.press');
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(toAbsolutePushPath('https://ugly.press/', 'podcast')).toBe(
      'https://ugly.press/podcast',
    );
  });
});

describe('absolutePushPath (live origin)', () => {
  it("anchors 'podcast' to the default ugly.press origin", () => {
    // No PUBLIC_URL/PROJECT_URL in the test env → canonical prod domain.
    expect(absolutePushPath('podcast')).toBe('https://ugly.press/podcast');
  });
});
