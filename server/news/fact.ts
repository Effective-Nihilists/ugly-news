// MUST import from the workers adapter subpath, not the 'ugly-app/server'
// barrel: that barrel pulls agent-base/http/https/net and breaks
// `build:workers` with ~200 "Could not resolve" errors.
import { createTextGen } from 'ugly-app/server/adapter/workers';
import { z } from 'ugly-app/shared';
import {
  buildClaimPrompt,
  claimClasses,
  CLAIM_SYSTEM_PROMPT,
  filterClaims,
  type RawClaim,
} from '../../shared/news/fact-claims';

/**
 * Distinct because each has a distinct remedy: log in, add funds, or nothing.
 * Never collapse these into a generic error — the extension blocks its popup on
 * the two actionable ones and needs to know which button to show.
 */
export type FactStatus = 'ok' | 'signed-out' | 'no-credit';

/** Below this there is nothing worth a model call. Mirrors the gate's floor. */
const MIN_TEXT_CHARS = 400;

/**
 * NOT a reasoning model, and that constraint is load-bearing.
 *
 * The proxy returns `message.content` as an array of parts for thinking models
 * (`[{type:'thinking'},{type:'text'}]`), while ugly-app's textProxyResponseSchema
 * accepts only a string — so every deepseek_v4_flash call through the framework
 * client dies with "[schema-drift] ai.text: message.content: expected string,
 * received array". Verified against the live proxy, including that `thinking`
 * cannot be turned off for that model. Changing this to a reasoning model
 * without first fixing the framework schema breaks claim extraction outright.
 */
const CLAIM_MODEL = 'llama_4_scout';

/**
 * Structured output, enforced by the proxy.
 *
 * Worth a schema rather than free text plus a parser: this model has been
 * observed in prod returning only `thinking` content and no text at all, which
 * used to surface as "no claims on this article" — a wrong answer wearing the
 * costume of a right one.
 */
const claimsSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      class: z.enum(claimClasses),
      checkable: z.boolean(),
    }),
  ),
});

/**
 * Billing goes through the FRAMEWORK's text client, which selects
 * `/user-billed/text` whenever a session token is in request context — so the
 * call is billed to the reader, not the project owner, without hand-rolling the
 * endpoint or the host. `server/news/ai.ts` deliberately does the opposite
 * because crons have no user to bill.
 */
export async function factClaims(
  userId: string,
  input: { url: string; title: string; text: string },
): Promise<{ claims: RawClaim[]; status: FactStatus; error: string | null }> {
  if (input.text.length < MIN_TEXT_CHARS) {
    return { claims: [], status: 'ok', error: null };
  }

  const gen = createTextGen(userId, {
    model: CLAIM_MODEL,
    temperature: 0,
    maxTokens: 1500,
  });

  try {
    const out = await gen.generateJson(claimsSchema, [
      { role: 'system', content: CLAIM_SYSTEM_PROMPT },
      { role: 'user', content: buildClaimPrompt(input.title, input.text) },
    ]);
    // The schema guarantees shape, not honesty — a span still has to be in the
    // article to be anchorable.
    return {
      claims: filterClaims(out.claims, input.text),
      status: 'ok',
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The two remedies are reported as states rather than thrown, because the
    // reader can fix them. Everything else is surfaced verbatim — a model that
    // returned nothing must NOT read as "this article has no claims".
    if (/\b401\b|Unauthenticated/i.test(msg)) {
      return { claims: [], status: 'signed-out', error: null };
    }
    if (/\b402\b|insufficient balance/i.test(msg)) {
      return { claims: [], status: 'no-credit', error: null };
    }
    console.error(`[fact] claims failed: ${msg}`);
    return { claims: [], status: 'ok', error: msg.slice(0, 300) };
  }
}
