import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ai.ts imports the workers adapter at module scope for storage/embeddings;
// neither is touched by the text path, but the import must resolve.
vi.mock('ugly-app/server/adapter/workers', () => ({
  getAdapter: () => ({
    storage: {
      put: async () => {},
      url: (_bucket: string, key: string) => `https://news.ugly.bot/r2/${key}`,
    },
  }),
  createEmbeddingClient: () => ({}),
}));

import { extractText, genText } from '../../../server/news/ai';

// ── Pure shape parsing ─────────────────────────────────────────────────────
//
// Every case here is a shape the ugly.bot proxy has actually been observed to
// return (or that its upstreams document). The two that cost us production
// output are called out by the prod log line that recorded them.
describe('extractText: response shapes the proxy returns', () => {
  it('reads a plain string completion', () => {
    const got = extractText({ message: { content: '  a real summary  ' } });
    expect(got).toMatchObject({
      text: 'a real summary',
      source: 'message.content',
      cause: 'ok',
    });
  });

  it('reads the text part of a reasoning response that also thought', () => {
    // The shape a reasoning model returns when it had budget left to answer.
    const got = extractText({
      message: {
        content: [
          { type: 'thinking', thinking: 'weighing the sources…' },
          { type: 'text', text: 'The council voted 7-2 to approve the levy.' },
        ],
      },
    });
    expect(got.text).toBe('The council voted 7-2 to approve the levy.');
    expect(got.cause).toBe('ok');
  });

  it('joins multiple text parts in order', () => {
    const got = extractText({
      message: {
        content: [
          { type: 'text', text: 'First half. ' },
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Second half.' },
        ],
      },
    });
    expect(got.text).toBe('First half. Second half.');
  });

  it('reports thinking-only (the prod "types=thinking thinkingChars=1515" row)', () => {
    // 2026-08-14 04:36, model=gpt_oss_120b: 1515 chars of reasoning, no answer.
    const got = extractText({
      message: { content: [{ type: 'thinking', thinking: 'x'.repeat(1515) }] },
      raw: {},
      usage: {},
    });
    expect(got.text).toBe('');
    expect(got.cause).toBe('thinking-only');
    expect(got.thinkingChars).toBe(1515);
  });

  it('never returns reasoning as the answer, however the part spells it', () => {
    // Some OpenAI-compatible gateways put the trace in `reasoning`, and some
    // carry it in `text` under a thinking type — returning either would print
    // a chain of thought on the story page.
    for (const part of [
      { type: 'reasoning', reasoning: 'y'.repeat(40) },
      { type: 'thinking', text: 'y'.repeat(40) },
      { type: 'reasoning_content', content: 'y'.repeat(40) },
    ]) {
      const got = extractText({ message: { content: [part] } });
      expect(got.text).toBe('');
      expect(got.cause).toBe('thinking-only');
    }
  });

  it('recovers the answer from `raw` when the normalized field is empty', () => {
    // 2026-09-13 13:19, model=gpt_oss_120b:
    //   shape=keys=message,raw,usage reason=none content=string(0)
    // The envelope named `raw` right there and we never looked inside it.
    const got = extractText({
      message: { content: '' },
      raw: {
        choices: [
          {
            message: {
              content: 'Regulators opened an inquiry on Tuesday.',
              reasoning: 'the user wants a news summary…',
            },
          },
        ],
      },
      usage: { total_tokens: 812 },
    });
    expect(got.text).toBe('Regulators opened an inquiry on Tuesday.');
    expect(got.source).toBe('raw.choices[0].message.content');
    expect(got.cause).toBe('ok');
  });

  it('parses `raw` when the proxy hands it back as a JSON string', () => {
    const got = extractText({
      message: { content: '' },
      raw: JSON.stringify({ choices: [{ text: 'Wire copy body.' }] }),
    });
    expect(got.text).toBe('Wire copy body.');
    expect(got.source).toBe('raw.choices[0].text');
  });

  it('reads the Anthropic-format raw payload', () => {
    const got = extractText({
      message: {},
      raw: {
        content: [
          { type: 'thinking', thinking: 'z'.repeat(9) },
          { type: 'text', text: 'Anthropic-shaped answer.' },
        ],
      },
    });
    expect(got.text).toBe('Anthropic-shaped answer.');
    expect(got.source).toBe('raw.content');
  });

  it('reads the Google generateContent raw payload', () => {
    const got = extractText({
      message: { content: [] },
      raw: {
        candidates: [{ content: { parts: [{ text: 'Gemini answer.' }] } }],
      },
    });
    expect(got.text).toBe('Gemini answer.');
    expect(got.source).toBe('raw.candidates[0].content.parts');
  });

  it('reads the OpenAI Responses raw payload', () => {
    const got = extractText({
      message: { content: '' },
      raw: {
        output: [
          { content: [{ type: 'output_text', text: 'Responses-API answer.' }] },
        ],
      },
    });
    expect(got.text).toBe('Responses-API answer.');
    expect(got.source).toBe('raw.output[0].content');
  });

  it('falls back to top-level content / response / text fields', () => {
    expect(extractText({ content: 'top-level content' }).text).toBe(
      'top-level content',
    );
    expect(extractText({ response: 'top-level response' }).text).toBe(
      'top-level response',
    );
    expect(extractText({ message: {}, text: 'top-level text' }).text).toBe(
      'top-level text',
    );
  });

  it('unwraps a part whose own `content` nests the text', () => {
    const got = extractText({
      message: {
        content: [{ type: 'message', content: [{ text: 'nested' }] }],
      },
    });
    expect(got.text).toBe('nested');
  });

  it('calls a present-but-empty completion provider-empty, not a parse failure', () => {
    expect(extractText({ message: { content: '   ' } }).cause).toBe(
      'provider-empty',
    );
    expect(extractText({ message: { content: [] } }).cause).toBe(
      'provider-empty',
    );
  });

  it('calls a body with no answer field at all an unrecognized shape', () => {
    // The signal that the proxy envelope changed — distinct from a provider
    // that answered with nothing, because retrying it is pointless.
    expect(extractText({ usage: { total_tokens: 3 } }).cause).toBe(
      'unrecognized-shape',
    );
    expect(extractText(null).cause).toBe('unrecognized-shape');
    expect(extractText('a bare string body').cause).toBe('unrecognized-shape');
  });

  it('survives junk parts without throwing', () => {
    const got = extractText({
      message: { content: [null, 42, { type: 'text' }, { text: 'kept' }] },
    });
    expect(got.text).toBe('kept');
  });
});

// ── genText behaviour around empty completions ─────────────────────────────
describe('genText: empty-completion retry and honest diagnostics', () => {
  beforeEach(() => {
    process.env.AI_PROXY_TOKEN = 'test-token';
    // ai.ts keeps the pacing gate (last-call timestamp + serializing chain) at
    // module scope; reset it so each test starts from a clean gap.
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Run `genText` against a scripted sequence of proxy responses. */
  async function run(
    bodies: unknown[],
    opts: { model: string; maxTokens?: number } = { model: 'gpt_oss_120b' },
  ): Promise<{
    out: string | null;
    sent: { options: { maxTokens?: number; reasoningEffort?: string } }[];
    warnings: string[];
  }> {
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    const sent: {
      options: { maxTokens?: number; reasoningEffort?: string };
    }[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(
          JSON.parse(String(init.body)) as {
            options: { maxTokens?: number; reasoningEffort?: string };
          },
        );
        const body = bodies[Math.min(call, bodies.length - 1)];
        call += 1;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.useFakeTimers();
    const mod = await import('../../../server/news/ai');
    const promise = mod.genText([{ role: 'user', content: 'story' }], opts);
    await vi.runAllTimersAsync();
    return { out: await promise, sent, warnings };
  }

  it('retries a thinking-only 200 with a bigger budget and keeps the answer', async () => {
    // The exact prod failure: gpt-oss burned its whole budget reasoning. The
    // second attempt must ASK FOR MORE ROOM, not re-roll the same request.
    const { out, sent } = await run(
      [
        {
          message: {
            content: [{ type: 'thinking', thinking: 'x'.repeat(1515) }],
          },
        },
        { message: { content: [{ type: 'text', text: 'The real summary.' }] } },
      ],
      { model: 'gpt_oss_120b', maxTokens: 500 },
    );
    expect(out).toBe('The real summary.');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.options.maxTokens).toBeGreaterThan(
      sent[0]!.options.maxTokens!,
    );
  });

  it('stops at the bounded attempt limit when the answer never arrives', async () => {
    const { out, sent, warnings } = await run([
      { message: { content: '' }, raw: {}, usage: {} },
    ]);
    expect(out).toBeNull();
    expect(sent).toHaveLength(2); // EMPTY_COMPLETION_ATTEMPTS
    expect(warnings.some((w) => w.includes('cause=provider-empty'))).toBe(true);
    expect(warnings.some((w) => w.includes('attempt=2/2'))).toBe(true);
  });

  it('does not retry — or blame the provider for — an unrecognized envelope', async () => {
    // "We could not parse what it returned" is a different bug from "it
    // returned nothing", and re-rolling it just spends money.
    const { out, sent, warnings } = await run([{ usage: { total_tokens: 5 } }]);
    expect(out).toBeNull();
    expect(sent).toHaveLength(1);
    expect(warnings.some((w) => w.includes('cause=unrecognized-shape'))).toBe(
      true,
    );
  });

  it('returns an answer recovered from raw, and says where it came from', async () => {
    const { out, sent, warnings } = await run([
      {
        message: { content: '' },
        raw: { choices: [{ message: { content: 'Recovered body.' } }] },
        usage: {},
      },
    ]);
    expect(out).toBe('Recovered body.');
    expect(sent).toHaveLength(1);
    expect(
      warnings.some((w) => w.includes('recovered from raw.choices[0]')),
    ).toBe(true);
  });

  it('names `raw` in the empty-body descriptor so the next one is diagnosable', async () => {
    const { warnings } = await run([
      { message: { content: '' }, raw: { choices: [], usage: {} }, usage: {} },
    ]);
    const row = warnings.find((w) => w.includes('no text content'))!;
    expect(row).toContain('keys=message,raw,usage');
    expect(row).toContain('content=string(0)');
    expect(row).toContain('raw=keys(choices|usage)');
  });

  it('gives gpt-oss thinking headroom but no effort knob it cannot honour', async () => {
    // gpt_oss_120b emits a harmony reasoning preamble out of the same
    // maxTokens budget, but has no `thinkingSupport` in the model catalog.
    const { sent } = await run([{ message: { content: 'ok' } }], {
      model: 'gpt_oss_120b',
      maxTokens: 300,
    });
    expect(sent[0]!.options.maxTokens).toBeGreaterThanOrEqual(300 + 2048);
    expect(sent[0]!.options.reasoningEffort).toBeUndefined();
  });
});
