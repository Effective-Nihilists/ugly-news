import { describe, expect, it } from 'vitest';
import { MAX_CLAIMS } from '../../../shared/news/fact-claims';
import { newsRequestDefs } from '../../../shared/news/requests';

/**
 * These two numbers live in different files and MUST agree.
 *
 * When extraction was raised to 40 and factQuick's input schema stayed at 25, a
 * dense article 400'd the entire verdict call — so every claim stayed pending,
 * which renders grey, and nothing was clickable. The failure looked nothing
 * like its cause, which is exactly why it gets a test.
 */
describe('claim caps agree across the boundary', () => {
  it('factQuick accepts at least as many claims as extraction can produce', () => {
    const parsed = newsRequestDefs.factQuick.inputSchema.safeParse({
      claims: Array.from({ length: MAX_CLAIMS }, (_, i) => ({
        id: `c${String(i)}`,
        text: 'a claim long enough to be real',
      })),
    });
    expect(parsed.success).toBe(true);
  });

  it('still rejects an absurd payload', () => {
    const parsed = newsRequestDefs.factQuick.inputSchema.safeParse({
      claims: Array.from({ length: MAX_CLAIMS + 200 }, (_, i) => ({
        id: `c${String(i)}`,
        text: 'x',
      })),
    });
    expect(parsed.success).toBe(false);
  });
});
