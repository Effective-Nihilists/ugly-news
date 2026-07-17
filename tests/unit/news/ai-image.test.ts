import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes } from '../../../shared/news/WAV';

// Fake same-origin public R2, mirroring getAdapter().storage.
const puts: Array<{ key: string; bytes: Uint8Array; mime: string }> = [];
vi.mock('ugly-app/server/adapter/workers', () => ({
  getAdapter: () => ({
    storage: {
      put: async (
        _bucket: string,
        key: string,
        bytes: Uint8Array,
        mime: string,
      ) => {
        puts.push({ key, bytes, mime });
      },
      url: (_bucket: string, key: string) => `https://news.ugly.bot/r2/${key}`,
    },
  }),
  // ai.ts also imports this; unused here.
  createEmbeddingClient: () => ({}),
}));

describe('genImage R2 hosting', () => {
  beforeEach(() => {
    puts.length = 0;
    process.env.AI_PROXY_TOKEN = 'test-token';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('re-hosts a base64 proxy response in public R2 and returns the same-origin URL (never a data: URI)', async () => {
    const b64 = Buffer.from(new Uint8Array([1, 2, 3, 4, 5])).toString('base64');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ base64: b64, mime: 'image/jpeg' }), {
            status: 200,
          }),
      ),
    );
    const { genImage } = await import('../../../server/news/ai');

    const url = await genImage('a satirical newspaper illustration');

    expect(url).toBe(
      'https://news.ugly.bot/r2/gen-images/' +
        hashHex([1, 2, 3, 4, 5]) +
        '.jpg',
    );
    expect(url).not.toContain('data:');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.mime).toBe('image/jpeg');
    expect([...puts[0]!.bytes]).toEqual([...base64ToBytes(b64)]);
  });

  it('passes through a url the proxy already hosts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ url: 'https://cdn.example/img.png' }), {
            status: 200,
          }),
      ),
    );
    const { genImage } = await import('../../../server/news/ai');
    expect(await genImage('x')).toBe('https://cdn.example/img.png');
    expect(puts).toHaveLength(0);
  });
});

function hashHex(bytes: number[]): string {
  // recompute the sha256 the impl uses, so the test asserts the real key
  const buf = require('node:crypto')
    .createHash('sha256')
    .update(Buffer.from(bytes))
    .digest('hex');
  return buf;
}
