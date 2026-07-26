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
    // ai.ts holds pacing state (last-call timestamp + the serializing chain) at
    // module scope. Without a reset it leaks between tests, and the real-timer
    // cases below would each block on a genuine 2.4s gap.
    vi.resetModules();
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

// ── Burst pacing + rate-limit-aware backoff ────────────────────────────────
// The proxy limiter is a sliding 30-calls-per-60-seconds window per token
// (PER_TOKEN_BURST.ai, ugly-bot/server/proxy/tokens.ts). Retry alone only reacts
// AFTER rejection and, on the old ~7s ceiling, re-entered the same window — so a
// sweep lost ~200 calls/hour to "giving up". These cover both halves of the fix.
describe('AI proxy burst pacing', () => {
  beforeEach(() => {
    process.env.AI_PROXY_TOKEN = 'test-token';
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('serializes concurrent calls and spaces them under the 30/60s cap', async () => {
    vi.useFakeTimers();
    const firedAt: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        firedAt.push(Date.now());
        return textResponse('a real summary body');
      }),
    );
    const { genText } = await import('../../../server/news/ai');

    // Three scrapes landing at once — the shape a queue batch produces.
    const all = Promise.all([
      genText([{ role: 'user', content: 'a' }], { model: 'm' }),
      genText([{ role: 'user', content: 'b' }], { model: 'm' }),
      genText([{ role: 'user', content: 'c' }], { model: 'm' }),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(firedAt).toHaveLength(3);
    expect(firedAt[1]! - firedAt[0]!).toBeGreaterThanOrEqual(2400);
    expect(firedAt[2]! - firedAt[1]!).toBeGreaterThanOrEqual(2400);
  });

  it('backs off harder for 429 than for a 5xx blip', async () => {
    const spanFor = async (status: number): Promise<number[]> => {
      vi.resetModules();
      vi.useFakeTimers();
      const at: number[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          at.push(Date.now());
          return new Response('{}', { status });
        }),
      );
      const { genText } = await import('../../../server/news/ai');
      const p = genText([{ role: 'user', content: 'x' }], { model: 'm' });
      await vi.runAllTimersAsync();
      await p;
      vi.useRealTimers();
      vi.unstubAllGlobals();
      return at;
    };

    const rateLimited = await spanFor(429);
    const serverBlip = await spanFor(503);

    expect(rateLimited).toHaveLength(4);
    expect(serverBlip).toHaveLength(4);
    // Third gap: 429 waits base 8s; a 5xx caps at base 2s (+jitter, +pacing).
    expect(rateLimited[3]! - rateLimited[2]!).toBeGreaterThanOrEqual(8000);
    expect(serverBlip[3]! - serverBlip[2]!).toBeLessThan(8000);
  });
});
