import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../server/news/ai', () => ({
  embed: vi.fn(),
  genText: vi.fn(),
  truncateToApproximateTokens: (text: string, maxTokens: number) =>
    text.slice(0, maxTokens * 4),
}));

import { genText } from '../../../server/news/ai';
import {
  detectIfAdvertisement,
  generateArticleSummary,
} from '../../../server/news/scraper';

const genTextMock = vi.mocked(genText);
const optsOf = (call: number): { model: string; maxTokens?: number } =>
  genTextMock.mock.calls[call][1];
const userTextOf = (call: number): string =>
  (genTextMock.mock.calls[call][0] as { role: string; content: string }[]).find(
    (m) => m.role === 'user',
  )!.content;

describe('scraper AI model routing', () => {
  beforeEach(() => {
    genTextMock.mockReset();
  });

  it('uses GPT-OSS for the binary advertisement gate', async () => {
    genTextMock.mockResolvedValueOnce('AD').mockResolvedValueOnce('ARTICLE');

    await expect(
      detectIfAdvertisement('Sponsored offer', 'Buy this product now.'),
    ).resolves.toBe(true);
    await expect(
      detectIfAdvertisement('City council meets', 'The council voted today.'),
    ).resolves.toBe(false);
    expect(optsOf(0).model).toBe('gpt_oss_120b');
  });

  /**
   * THE BUG this pins: the gate asked for `maxTokens: 10`. gpt-oss-120b is a
   * reasoning model and spends its output budget on a reasoning preamble
   * first, so all 10 tokens went to reasoning, the response came back
   * `finish_reason: "length"` with EMPTY content, and `detectIfAdvertisement`
   * read `''` → returned false. Verified live 2026-09-13 against blatant
   * sponsored copy at every reasoning_effort: the gate returned false every
   * time. It classified nothing as an ad for its entire life while costing
   * 16,142 calls / $8.70 a week.
   */
  it('gives the ad gate enough output budget to survive a reasoning preamble', async () => {
    genTextMock.mockResolvedValueOnce('ARTICLE');
    await detectIfAdvertisement('City council meets', 'The council voted.');
    expect(
      optsOf(0).maxTokens,
      'maxTokens must leave room for reasoning tokens AND the verdict — a ' +
        'budget this small is consumed entirely by the preamble and returns ""',
    ).toBeGreaterThanOrEqual(100);
  });

  it('sends the ad gate only a short excerpt, not the whole article', async () => {
    genTextMock.mockResolvedValueOnce('ARTICLE');
    await detectIfAdvertisement('Long piece', 'x'.repeat(50_000));
    expect(
      userTextOf(0).length,
      'spotting sponsored content needs the opening, not 6k characters of body',
    ).toBeLessThanOrEqual(2_000);
  });

  /**
   * Moved off `deepseek_v4_flash`: DeepSeek's Anthropic gateway force-enables
   * thinking and it cannot be turned off, so ~90% of the output tokens on a
   * pure paraphrase task were reasoning. Measured 2026-09-13: 1,691 output
   * tokens → 6,700 chars of thinking vs 784 chars of article.
   */
  it('routes long-form article summaries to GPT-OSS', async () => {
    genTextMock.mockResolvedValue('A substantive summary.');

    await generateArticleSummary('A news story', 'Source article text.');
    expect(genTextMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        model: 'gpt_oss_120b',
        maxTokens: 1000,
      }),
    );
  });
});
