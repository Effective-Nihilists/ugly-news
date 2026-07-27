import { beforeEach, describe, expect, it, vi } from 'vitest';

const userBilledText = vi.fn();
class NotSignedInError extends Error {}
class NoCreditError extends Error {}
vi.mock('../../../server/news/fact-ai', () => ({
  userBilledText,
  NotSignedInError,
  NoCreditError,
}));

const { factClaims } = await import('../../../server/news/fact');

const TEXT =
  'The Senate passed the bill 51-49 late Thursday. '.repeat(10) +
  'Analysts expect construction to begin next spring.';

const INPUT = { url: 'https://x.test/a', title: 'T', text: TEXT };

describe('factClaims', () => {
  beforeEach(() => {
    userBilledText.mockReset();
  });

  it('returns parsed claims from the model', async () => {
    userBilledText.mockResolvedValue(
      JSON.stringify({
        claims: [
          {
            text: 'The Senate passed the bill 51-49 late Thursday',
            class: 'attribution',
            checkable: true,
          },
        ],
      }),
    );
    const out = await factClaims('u1', INPUT);
    expect(out.claims).toHaveLength(1);
    expect(out.status).toBe('ok');
    expect(userBilledText).toHaveBeenCalledOnce();
  });

  it('returns an empty list when the model returns null', async () => {
    userBilledText.mockResolvedValue(null);
    const out = await factClaims('u1', INPUT);
    expect(out.claims).toEqual([]);
    expect(out.status).toBe('ok');
  });

  it('does not call the model for text below the article floor', async () => {
    const out = await factClaims('u1', { ...INPUT, text: 'too short' });
    expect(out.claims).toEqual([]);
    expect(out.status).toBe('ok');
    expect(userBilledText).not.toHaveBeenCalled();
  });

  it('reports signed-out instead of throwing when there is no session', async () => {
    userBilledText.mockRejectedValue(new NotSignedInError());
    const out = await factClaims('u1', INPUT);
    expect(out.status).toBe('signed-out');
    expect(out.claims).toEqual([]);
  });

  it('reports no-credit distinctly from signed-out', async () => {
    userBilledText.mockRejectedValue(new NoCreditError());
    const out = await factClaims('u1', INPUT);
    expect(out.status).toBe('no-credit');
    expect(out.claims).toEqual([]);
  });

  it('rethrows anything that is not an actionable user state', async () => {
    userBilledText.mockRejectedValue(new Error('proxy exploded'));
    await expect(factClaims('u1', INPUT)).rejects.toThrow('proxy exploded');
  });

  it('uses the cheap structured-extraction model at temperature 0', async () => {
    userBilledText.mockResolvedValue('{"claims":[]}');
    await factClaims('u1', INPUT);
    const opts = userBilledText.mock.calls[0]?.[1] as {
      model: string;
      temperature: number;
    };
    expect(opts.model).toBe('deepseek_v4_flash');
    expect(opts.temperature).toBe(0);
  });
});
