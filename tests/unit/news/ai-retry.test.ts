import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ai.ts imports the workers adapter for storage/embeddings; stub it (unused in
// these text/retry paths, but the module-level import must resolve).
vi.mock('ugly-app/server/adapter/workers', () => ({
  getAdapter: () => ({
    storage: {
      put: async () => {},
      url: (_bucket: string, key: string) => `https://news.ugly.bot/r2/${key}`,
    },
  }),
  createEmbeddingClient: () => ({}),
}));

function textResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ message: { content } }), { status });
}

describe('AI proxy retry with backoff + jitter', () => {
  beforeEach(() => {
    process.env.AI_PROXY_TOKEN = 'test-token';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a 429 rate-limit response and succeeds on the next attempt', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
          })
        : textResponse(
            'A genuine neutral wire-service account of what happened.',
          );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { genText } = await import('../../../server/news/ai');

    const promise = genText([{ role: 'user', content: 'story' }], {
      model: 'deepseek_v4_flash',
    });
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(out).toBe(
      'A genuine neutral wire-service account of what happened.',
    );
    expect(calls).toBe(2);
  });

  it('gives up and returns null after exhausting retries on persistent 429', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { genText } = await import('../../../server/news/ai');

    const promise = genText([{ role: 'user', content: 'story' }], {
      model: 'gpt_4o',
    });
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(out).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4); // AI_MAX_ATTEMPTS
  });

  it('does NOT retry a permanent 4xx (fails fast on 400)', async () => {
    const fetchMock = vi.fn(
      async () => new Response('bad request', { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { genText } = await import('../../../server/news/ai');

    expect(
      await genText([{ role: 'user', content: 'x' }], { model: 'm' }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network errors and returns null when every attempt throws', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { genText } = await import('../../../server/news/ai');

    const promise = genText([{ role: 'user', content: 'x' }], { model: 'm' });
    await vi.runAllTimersAsync();
    expect(await promise).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns null without calling the proxy when the token is missing', async () => {
    delete process.env.AI_PROXY_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { genText } = await import('../../../server/news/ai');

    expect(
      await genText([{ role: 'user', content: 'x' }], { model: 'm' }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when a 200 response body cannot be parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );
    const { genText } = await import('../../../server/news/ai');
    expect(
      await genText([{ role: 'user', content: 'x' }], { model: 'm' }),
    ).toBeNull();
  });

  it('genImage also retries a 429 then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
          })
        : new Response(JSON.stringify({ url: 'https://cdn.example/img.png' }), {
            status: 200,
          });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { genImage } = await import('../../../server/news/ai');

    const promise = genImage('a satirical newspaper illustration');
    await vi.runAllTimersAsync();
    expect(await promise).toBe('https://cdn.example/img.png');
    expect(calls).toBe(2);
  });
});
