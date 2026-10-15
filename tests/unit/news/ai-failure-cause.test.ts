import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenTextFailure } from '../../../server/news/ai';

vi.mock('ugly-app/server/adapter/workers', () => ({
  getAdapter: () => ({
    storage: { put: async () => {}, url: () => '' },
  }),
  createEmbeddingClient: () => ({}),
}));

/**
 * 2026-10-13: three "[cluster-*] … see the preceding [news/ai] line for the
 * cause" errors were persisted with no [news/ai] row anywhere, so the cause
 * was unknowable. genText now hands the cause to the caller.
 */
describe('genText onFailure', () => {
  beforeEach(() => {
    process.env.AI_PROXY_TOKEN = 'test-token';
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function run(response: () => Response): Promise<{
    out: string | null;
    failures: GenTextFailure[];
  }> {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    );
    const { genText } = await import('../../../server/news/ai');
    const failures: GenTextFailure[] = [];
    const p = genText([{ role: 'user', content: 'story' }], {
      model: 'gpt_oss_120b',
      onFailure: (f) => failures.push(f),
    });
    await vi.runAllTimersAsync();
    return { out: await p, failures };
  }

  it('reports an upstream 5xx as transport, with the status', async () => {
    const { out, failures } = await run(
      () => new Response('{"detail":"D1 DB is overloaded"}', { status: 500 }),
    );
    expect(out).toBeNull();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ kind: 'transport' });
    expect(failures[0]!.detail).toContain('500');
  });

  it('reports a 200 with an empty completion as empty', async () => {
    const { out, failures } = await run(
      () =>
        new Response(JSON.stringify({ message: { content: '' }, raw: {} }), {
          status: 200,
        }),
    );
    expect(out).toBeNull();
    expect(failures).toHaveLength(1);
    expect(['empty', 'parse']).toContain(failures[0]!.kind);
  });

  it('does not report on success', async () => {
    const { out, failures } = await run(
      () =>
        new Response(
          JSON.stringify({ message: { content: 'A real answer here.' } }),
          { status: 200 },
        ),
    );
    expect(out).toBe('A real answer here.');
    expect(failures).toHaveLength(0);
  });
});
