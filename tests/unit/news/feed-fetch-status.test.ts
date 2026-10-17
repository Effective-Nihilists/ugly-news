import { describe, expect, it } from 'vitest';
import { isTransientStatus } from '../../../server/news/download';

/**
 * Which HTTP statuses a feed fetch retries before the sweep gives up on it.
 *
 * Production evidence for the 404 case: "[NEWS] RSS feed download failed
 * [france24]: Error: HTTP 404" on 2026-10-14 09:26 UTC, the only such row in
 * 30 days across every build, for a URL that returns 200 (RSS 2.0) before and
 * after it and is the target of France 24's own section-feed redirects. A CDN
 * edge blip, not a moved feed; one attempt lost the whole feed for that sweep.
 */
describe('isTransientStatus (feed fetch)', () => {
  it('retries rate limits and server errors', () => {
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(522)).toBe(true);
  });

  it('retries a 404 (a CDN edge can serve one for a live feed)', () => {
    expect(isTransientStatus(404)).toBe(true);
  });

  it('does not retry a permanent client error', () => {
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(403)).toBe(false);
    expect(isTransientStatus(410)).toBe(false);
  });
});
