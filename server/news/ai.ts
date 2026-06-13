// Workers-safe AI helpers. All route through ugly.bot's proxy via the
// runtime-neutral clients re-exported from the Workers adapter entry (so this
// module bundles for both Node and Cloudflare Workers — never the Node barrel).
import {
  createEmbeddingClient,
  createImageGen,
  uglyBotRequest,
} from 'ugly-app/server/adapter/workers';
import type { ImageGenModel } from 'ugly-app/shared';
import { uglyBotId } from '../../shared/news/Bot';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

interface TextGenResponse {
  message: { content: string | { type: string; text?: string }[] };
}

function extractText(content: TextGenResponse['message']['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
    .join('')
    .trim();
}

/** App-billed text generation via the ugly.bot proxy. */
export async function genText(
  messages: ChatMessage[],
  opts: { model: string; temperature?: number; maxTokens?: number },
): Promise<string | null> {
  try {
    const res = await uglyBotRequest<TextGenResponse>('textGen', {
      model: opts.model,
      messages,
      options: {
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      },
    });
    return extractText(res.message.content);
  } catch (error) {
    console.warn('[news/ai] genText failed', error);
    return null;
  }
}

/** Generate an image (returns a URL or data URI), or null on failure.
 * Negative guidance is folded into the prompt (ImageGenOptions has no
 * negativePrompt field — the proxy/provider handles avoidance terms inline). */
export async function genImage(
  prompt: string,
  opts?: { model?: ImageGenModel; negative?: string },
): Promise<string | null> {
  try {
    const client = createImageGen(uglyBotId, { model: opts?.model ?? 'flux_1_dev' });
    const fullPrompt = opts?.negative ? `${prompt}\n\nAvoid: ${opts.negative}` : prompt;
    return await client.generate(fullPrompt, { aspectRatio: 'landscape_16_9' });
  } catch (error) {
    console.warn('[news/ai] genImage failed', error);
    return null;
  }
}

/** Embed text into a vector for feed ranking / search. */
export async function embed(text: string): Promise<number[] | null> {
  try {
    return await createEmbeddingClient().embed(text);
  } catch (error) {
    console.warn('[news/ai] embed failed', error);
    return null;
  }
}

/** ~4 chars/token heuristic truncation (ported from ugly.bot Helper). */
export function truncateToApproximateTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}
