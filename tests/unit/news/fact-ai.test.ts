import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserToken = vi.fn();
vi.mock('ugly-app/server/adapter/workers', () => ({ getUserToken }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { userBilledText, NotSignedInError, NoCreditError } = await import(
  '../../../server/news/fact-ai'
);

const MSG = [{ role: 'user' as const, content: 'hi' }];

describe('userBilledText', () => {
  beforeEach(() => {
    getUserToken.mockReset();
    fetchMock.mockReset();
  });

  it('throws NotSignedInError when there is no user token', async () => {
    getUserToken.mockReturnValue(null);
    await expect(userBilledText(MSG, { model: 'm' })).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws NotSignedInError for an empty-string token', async () => {
    getUserToken.mockReturnValue('');
    await expect(userBilledText(MSG, { model: 'm' })).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the user-billed endpoint with the user bearer', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: 'out' }) });
    const out = await userBilledText(MSG, { model: 'm' });
    expect(out).toBe('out');
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toBe('https://ugly.bot/v1/ai/user-billed/text');
    expect((call?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: 'Bearer user-tok',
    });
  });

  it('never falls back to the owner token', async () => {
    getUserToken.mockReturnValue(null);
    process.env['AI_PROXY_TOKEN'] = 'owner-tok';
    await expect(userBilledText(MSG, { model: 'm' })).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env['AI_PROXY_TOKEN'];
  });

  it('raises NoCreditError on 402 so the caller can route to billing', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => 'no balance',
    });
    await expect(userBilledText(MSG, { model: 'm' })).rejects.toBeInstanceOf(
      NoCreditError,
    );
  });

  it('raises NotSignedInError on 401 even when a token was present', async () => {
    getUserToken.mockReturnValue('stale-tok');
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => '' });
    await expect(userBilledText(MSG, { model: 'm' })).rejects.toBeInstanceOf(
      NotSignedInError,
    );
  });

  it('returns null on any other non-ok response rather than throwing', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    expect(await userBilledText(MSG, { model: 'm' })).toBeNull();
  });

  it('returns null when the proxy body has no text field', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await userBilledText(MSG, { model: 'm' })).toBeNull();
  });

  it('passes temperature and maxTokens through when given', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: 'x' }) });
    await userBilledText(MSG, { model: 'm', temperature: 0, maxTokens: 99 });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { options: Record<string, unknown> };
    expect(body.options).toMatchObject({ temperature: 0, maxTokens: 99 });
  });

  it('omits options that were not supplied', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: 'x' }) });
    await userBilledText(MSG, { model: 'm' });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { options: Record<string, unknown> };
    expect(body.options).toEqual({});
  });
});
