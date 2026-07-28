import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateJson = vi.fn();
const createTextGen = vi.fn(() => ({ generateJson }));
vi.mock('ugly-app/server/adapter/workers', () => ({ createTextGen }));

const { factClaims } = await import('../../../server/news/fact');

const TEXT =
  'The Senate passed the bill 51-49 late Thursday. '.repeat(10) +
  'Analysts expect construction to begin next spring.';

const INPUT = { url: 'https://x.test/a', title: 'T', text: TEXT };

const ONE_CLAIM = {
  claims: [
    {
      text: 'The Senate passed the bill 51-49 late Thursday',
      class: 'attribution',
      checkable: true,
    },
  ],
};

describe('factClaims', () => {
  beforeEach(() => {
    generateJson.mockReset();
    createTextGen.mockClear();
  });

  it('returns validated claims from the model', async () => {
    generateJson.mockResolvedValue(ONE_CLAIM);
    const out = await factClaims('u1', INPUT);
    expect(out.claims).toHaveLength(1);
    expect(out.status).toBe('ok');
    expect(out.error).toBeNull();
  });

  it('drops a claim the model invented, even though the shape is valid', async () => {
    // Structured output guarantees the shape, never the honesty — an invented
    // span cannot be anchored, so it must not reach the page.
    generateJson.mockResolvedValue({
      claims: [
        {
          text: 'A sentence found nowhere in the article',
          class: 'causal',
          checkable: true,
        },
      ],
    });
    expect((await factClaims('u1', INPUT)).claims).toEqual([]);
  });

  it('does not call the model for text below the article floor', async () => {
    const out = await factClaims('u1', { ...INPUT, text: 'too short' });
    expect(out.claims).toEqual([]);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('bills the CALLING user, not the project owner', async () => {
    // createTextGen picks /user-billed/text from the session token in context;
    // passing the userId through is what ties the spend to the reader.
    generateJson.mockResolvedValue({ claims: [] });
    await factClaims('user-42', INPUT);
    expect(createTextGen.mock.calls[0]?.[0]).toBe('user-42');
  });

  it('reports signed-out instead of throwing when there is no session', async () => {
    generateJson.mockRejectedValue(
      new Error('[AiText] Request failed (401): unauthenticated'),
    );
    const out = await factClaims('u1', INPUT);
    expect(out.status).toBe('signed-out');
  });

  it('recognises the framework unauthenticated error by name too', async () => {
    generateJson.mockRejectedValue(new Error('UnauthenticatedAiCallError'));
    expect((await factClaims('u1', INPUT)).status).toBe('signed-out');
  });

  it('reports no-credit distinctly from signed-out', async () => {
    generateJson.mockRejectedValue(
      new Error('[AiText] Request failed (402): Insufficient balance'),
    );
    const out = await factClaims('u1', INPUT);
    expect(out.status).toBe('no-credit');
  });

  it('surfaces a thinking-only reply as an ERROR, not as an empty article', async () => {
    // The exact prod failure: this model sometimes returns reasoning content
    // and no text. Reporting that as "no claims" is a wrong answer wearing the
    // costume of a right one.
    generateJson.mockRejectedValue(
      new Error('[AiText] Proxy response missing content'),
    );
    const out = await factClaims('u1', INPUT);
    expect(out.status).toBe('ok');
    expect(out.claims).toEqual([]);
    expect(out.error).toContain('missing content');
  });

  it('never throws out of the handler', async () => {
    generateJson.mockRejectedValue(new Error('proxy exploded'));
    const out = await factClaims('u1', INPUT);
    expect(out.error).toContain('proxy exploded');
  });

  it('uses a NON-reasoning model at temperature 0', async () => {
    // Load-bearing: the proxy returns message.content as an array of parts for
    // thinking models, and ugly-app's response schema accepts only a string, so
    // a reasoning model fails every call with [schema-drift]. Verified live.
    generateJson.mockResolvedValue({ claims: [] });
    await factClaims('u1', INPUT);
    const opts = createTextGen.mock.calls[0]?.[1] as unknown as {
      model: string;
      temperature: number;
    };
    expect(opts.model).toBe('llama_4_scout');
    expect(opts.temperature).toBe(0);
  });
});
