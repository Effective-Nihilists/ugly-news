// Text generation billed to the CALLING USER, for the fact-checker endpoints.
//
// Deliberately separate from `genText` in ./ai.ts, which is owner-billed and
// exists for the crons — they have no user to bill.
//
// MUST import from the workers adapter subpath, not the 'ugly-app/server'
// barrel: that barrel pulls agent-base/http/https/net and breaks
// `build:workers` with ~200 "Could not resolve" errors. Every worker-bundled
// file in this repo uses this path — see ai.ts, queue.ts, domainBias.ts.
import { getUserToken } from 'ugly-app/server/adapter/workers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** No usable session — the caller must send the user through login. */
export class NotSignedInError extends Error {
  constructor() {
    super('not signed in');
    this.name = 'NotSignedInError';
  }
}

/** 402 from the proxy — the user is out of credit. Send them to billing. */
export class NoCreditError extends Error {
  constructor() {
    super('insufficient balance');
    this.name = 'NoCreditError';
  }
}

// NOT api.ugly.bot — that host does not resolve. See ./ai.ts.
const DEFAULT_BASE = 'https://ugly.bot/v1/ai';

/**
 * Text generation billed to the calling user, never the project owner.
 *
 * There is deliberately no owner-token fallback: a silent fallback would shift
 * spend onto the project the moment auth broke — exactly the bug nobody
 * notices until the bill arrives.
 *
 * 401 and 402 are raised as distinct errors because they have distinct
 * remedies (log in / add funds). Everything else returns null.
 */
export async function userBilledText(
  messages: ChatMessage[],
  opts: { model: string; temperature?: number; maxTokens?: number },
): Promise<string | null> {
  // Request-scoped: this reads an AsyncLocalStorage the framework populates per
  // dispatch, so it MUST be called inside the handler, never after it returns.
  const token = getUserToken();
  if (token === null || token === '') throw new NotSignedInError();

  const base = process.env.AI_PROXY_URL ?? DEFAULT_BASE;
  const res = await fetch(`${base}/user-billed/text`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      options: {
        ...(opts.temperature === undefined
          ? {}
          : { temperature: opts.temperature }),
        ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
      },
    }),
  });

  if (res.status === 401) throw new NotSignedInError();
  if (res.status === 402) throw new NoCreditError();
  if (!res.ok) {
    console.warn(`[fact] user-billed text ${String(res.status)}`);
    return null;
  }

  const body = (await res.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text : null;
}
