import { describe, expect, it, vi } from 'vitest';

let inFlight = 0;
let peak = 0;
const shareLink = vi.fn(async (opts: { target: string }) => {
  inFlight++;
  peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, 5));
  inFlight--;
  return `https://ugly.bot/l/${opts.target.length}`;
});
vi.mock('ugly-app/server/adapter/workers', () => ({
  shareLink,
  emailSend: vi.fn(),
}));

/**
 * 2026-10-13: one daily email fired ~15 linkCreate calls at once and ugly.bot
 * 500'd on D1 overload. Mints are now capped per isolate.
 */
describe('mintShareLink', () => {
  it('caps concurrent mints at 3 and still resolves every link', async () => {
    const { mintShareLink } = await import('../../../server/news/email');
    const urls = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        mintShareLink({ target: `https://ugly.press/story/${String(i)}` }),
      ),
    );
    expect(urls).toHaveLength(15);
    expect(urls.every((u) => u.startsWith('https://ugly.bot/l/'))).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(inFlight).toBe(0);
  });

  it('frees its slot when a mint throws', async () => {
    const { mintShareLink } = await import('../../../server/news/email');
    shareLink.mockRejectedValueOnce(new Error('boom'));
    await expect(mintShareLink({ target: 'https://x/a' })).rejects.toThrow();
    peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        mintShareLink({ target: `https://x/${String(i)}` }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
  });
});
