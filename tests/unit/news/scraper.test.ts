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
    expect(genTextMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: 'gpt_oss_120b', maxTokens: 10 }),
    );
  });

  it('keeps long-form article summaries on DeepSeek Flash', async () => {
    genTextMock.mockResolvedValue('A substantive summary.');

    await generateArticleSummary('A news story', 'Source article text.');
    expect(genTextMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        model: 'deepseek_v4_flash',
        maxTokens: 1000,
      }),
    );
  });
});
