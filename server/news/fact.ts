import {
  buildClaimPrompt,
  CLAIM_SYSTEM_PROMPT,
  parseClaims,
  type RawClaim,
} from '../../shared/news/fact-claims';
import { NoCreditError, NotSignedInError, userBilledText } from './fact-ai';

/**
 * Distinct because each has a distinct remedy: log in, add funds, or nothing.
 * Never collapse these into a generic error — the extension blocks its popup on
 * the two actionable ones and needs to know which button to show.
 */
export type FactStatus = 'ok' | 'signed-out' | 'no-credit';

/** Below this there is nothing worth a model call. Mirrors the gate's floor. */
const MIN_TEXT_CHARS = 400;

export async function factClaims(
  _userId: string,
  input: { url: string; title: string; text: string },
): Promise<{ claims: RawClaim[]; status: FactStatus }> {
  if (input.text.length < MIN_TEXT_CHARS) {
    return { claims: [], status: 'ok' };
  }

  let raw: string | null;
  try {
    raw = await userBilledText(
      [
        { role: 'system', content: CLAIM_SYSTEM_PROMPT },
        { role: 'user', content: buildClaimPrompt(input.title, input.text) },
      ],
      { model: 'deepseek_v4_flash', temperature: 0, maxTokens: 1500 },
    );
  } catch (e) {
    // Neither of these is an error the user can do nothing about, so they are
    // reported as states with a remedy rather than thrown.
    if (e instanceof NotSignedInError)
      return { claims: [], status: 'signed-out' };
    if (e instanceof NoCreditError) return { claims: [], status: 'no-credit' };
    throw e;
  }

  if (raw === null) return { claims: [], status: 'ok' };
  return { claims: parseClaims(raw, input.text), status: 'ok' };
}
