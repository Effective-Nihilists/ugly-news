# Fact Checker — Claims and Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real claims detected by AI, anchored into the live DOM, and painted green/yellow/red with an auditable tally behind each one.

**Architecture:** Two **authenticated, user-billed** endpoints on ugly-news. `factClaims` segments an article into claim spans in one model call. `factQuick` retrieves evidence from the 90-day corpus and returns a weighted stance tally per claim. The extension's **background worker** does all fetching (an MV3 service worker with `host_permissions` bypasses CORS; a content script would not). The content script anchors claims with W3C `TextQuoteSelector` and paints them with the CSS Custom Highlight API — no DOM mutation.

**Tech Stack:** TypeScript, user-billed text via the ugly.bot proxy, D1 + FTS5 + Vectorize, `CSS.highlights`, vitest, Playwright.

**Sequencing:** Phase A (Tasks 0–4) ends with **claims visibly highlighted** in a neutral "pending" tint. Phase B (Tasks 5–6) colours them by verdict. Stop after Phase A if the anchoring proves harder than expected — that is the risky half, and it is worth seeing working before spending on tallies.

## Global Constraints

- **Package manager is pnpm.** Never `npm install`.
- **TypeScript strictness:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Prefer `T | null` over optional props.
- **eslint `parserOptions.project: true`** — every new `.ts` must be under `tsconfig.json`'s `include` (`extension` and `shared` already are). `tests/**` and `scripts/**` are eslint-ignored.
- **No `any`.** `noExplicitAny` is enforced.
- **AI is USER-billed.** Do NOT use `genText` from `server/news/ai.ts` — that is
  owner-billed (`userId: 'uglyBot'`) and exists for the crons, which have no
  user. The fact endpoints use a separate user-billed path (Task 0).
- **`getUserToken()` is REQUEST-SCOPED.** It reads an `AsyncLocalStorage` that
  `App.js` populates per dispatch. Call it inside the handler; a value read
  after the handler returns is `null`. No fire-and-forget AI here.
- **The AI proxy base URL for ugly-news is `https://ugly.bot/v1/ai`.**
  `ugly-search` defaults to `https://api.ugly.bot/v1/ai`, which **does not
  resolve** — copying that constant is a known way to lose an hour. See the
  comment in `server/news/ai.ts`.
- **Endpoints must be wired in BOTH `server/index.ts` and `server/workers.ts`**, and must not import Node-only barrels from `ugly-app/server` (the `recordPerf` trap — use `setPerfSink` in `server/news/perf.ts`).
- **No live AI in tests** — fixture the model response.
- **Model for structured extraction is `deepseek_v4_flash`**, matching `cluster-jobs.ts`. `gpt_4o` is reserved for generative prose.
- **Bias/Factuality enums** are exactly `far-left | left | lean-left | center | lean-right | right | far-right` and `very-low | low | mixed | high | very-high`.
- **CORS:** `ugly.press` sets no `access-control-*` headers and 404s `OPTIONS`. Verified. Fetching therefore MUST happen in the background worker, never the content script.
- **Three outcomes, not two.** Every AI-bearing call resolves to `ok`,
  **`signed-out`** (no/invalid session → send the user through login) or
  **`no-credit`** (`402 Insufficient balance` → send them to billing). They have
  different remedies and must never be collapsed into one "error" state.
  `402` is confirmed as the balance code in `ugly-app/dist/server/uglyBotProxy.js`,
  which distinguishes owner- from user-billed exhaustion explicitly.
- **Destinations** (do not invent new ones):
  - login → `https://ugly.press/` — the framework's `LoginPopup` takes over on
    landing, so the extension must NOT construct an OAuth URL itself.
  - billing → `https://ugly.bot/account/billing` — the same external-browser
    destination `ugly-studio/electron/uglyNative/desktop-caps.ts` opens.
- **Auth reaches the server by cookie.** `getRequestToken()` accepts either a
  session cookie or an `Authorization: Bearer` header. An extension service
  worker's `fetch` sends cookies for a host in `host_permissions`, so a user
  signed in to ugly.press is authenticated with no token plumbing — but the
  fetch MUST pass `credentials: 'include'`.

---

## Phase A — claims visible

### Task 0: User-billed text generation

**Files:**
- Create: `server/news/fact-ai.ts`
- Test: `tests/unit/news/fact-ai.test.ts`

**Interfaces:**
- Produces: `function userBilledText(messages, opts): Promise<string | null>` and
  `class NotSignedInError extends Error`.

The existing `genText` is owner-billed and must stay that way for the crons.
This is a parallel path that bills the caller.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserToken = vi.fn();
vi.mock('ugly-app/server', () => ({ getUserToken }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { userBilledText, NotSignedInError, NoCreditError } = await import(
  '../../../server/news/fact-ai'
);

describe('userBilledText', () => {
  beforeEach(() => {
    getUserToken.mockReset();
    fetchMock.mockReset();
  });

  it('throws NotSignedInError when there is no user token', async () => {
    getUserToken.mockReturnValue(null);
    await expect(
      userBilledText([{ role: 'user', content: 'hi' }], { model: 'm' }),
    ).rejects.toBeInstanceOf(NotSignedInError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the user-billed endpoint with the user bearer', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'out' }),
    });
    const out = await userBilledText([{ role: 'user', content: 'hi' }], {
      model: 'm',
    });
    expect(out).toBe('out');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://ugly.bot/v1/ai/user-billed/text');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer user-tok',
    });
  });

  it('never falls back to the owner token', async () => {
    getUserToken.mockReturnValue(null);
    process.env['AI_PROXY_TOKEN'] = 'owner-tok';
    await expect(
      userBilledText([{ role: 'user', content: 'hi' }], { model: 'm' }),
    ).rejects.toBeInstanceOf(NotSignedInError);
  });

  it('raises NoCreditError on 402 so the caller can route to billing', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({ ok: false, status: 402, text: async () => 'no balance' });
    await expect(
      userBilledText([{ role: 'user', content: 'hi' }], { model: 'm' }),
    ).rejects.toBeInstanceOf(NoCreditError);
  });

  it('raises NotSignedInError on 401 even when a token was present', async () => {
    getUserToken.mockReturnValue('stale-tok');
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => '' });
    await expect(
      userBilledText([{ role: 'user', content: 'hi' }], { model: 'm' }),
    ).rejects.toBeInstanceOf(NotSignedInError);
  });

  it('returns null on any other non-ok response rather than throwing', async () => {
    getUserToken.mockReturnValue('user-tok');
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    expect(
      await userBilledText([{ role: 'user', content: 'hi' }], { model: 'm' }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/news/fact-ai.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement `server/news/fact-ai.ts`**

```ts
import { getUserToken } from 'ugly-app/server';

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

/** 402 from the proxy — the user has credit left, not a bug. Send to billing. */
export class NoCreditError extends Error {
  constructor() {
    super('insufficient balance');
    this.name = 'NoCreditError';
  }
}

// NOT api.ugly.bot — that host does not resolve. See server/news/ai.ts.
const BASE = process.env['AI_PROXY_URL'] ?? 'https://ugly.bot/v1/ai';

/**
 * Text generation billed to the CALLING USER, never the project owner.
 *
 * There is deliberately no owner-token fallback: a silent fallback would move
 * spend onto the project the moment auth broke, which is exactly the bug you
 * would not notice.
 */
export async function userBilledText(
  messages: ChatMessage[],
  opts: { model: string; temperature?: number; maxTokens?: number },
): Promise<string | null> {
  // Request-scoped — must be read inside the handler.
  const token = getUserToken();
  if (token === null || token === '') throw new NotSignedInError();

  const res = await fetch(`${BASE}/user-billed/text`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      options: {
        ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
      },
    }),
  });
  // 401 and 402 are user-actionable states with different remedies, so they
  // are raised rather than folded into a null "something went wrong".
  if (res.status === 401) throw new NotSignedInError();
  if (res.status === 402) throw new NoCreditError();
  if (!res.ok) {
    console.warn(`[fact] user-billed text ${String(res.status)}`);
    return null;
  }
  const body = (await res.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text : null;
}
```

- [ ] **Step 4: Run to verify pass, then commit**

```bash
git add server/news/fact-ai.ts tests/unit/news/fact-ai.test.ts
git commit -m "feat(fact): user-billed text generation, no owner fallback"
```

---

### Task 1: Claim segmentation — pure prompt and parse

**Files:**
- Create: `shared/news/fact-claims.ts`
- Test: `tests/unit/news/fact-claims.test.ts`

**Interfaces:**
- Produces:
  - `type ClaimClass = 'quantitative' | 'attribution' | 'causal' | 'predictive'`
  - `interface RawClaim { text: string; class: ClaimClass; checkable: boolean }`
  - `const CLAIM_SYSTEM_PROMPT: string`
  - `function buildClaimPrompt(title: string, text: string): string`
  - `function parseClaims(modelOutput: string, articleText: string): RawClaim[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/news/fact-claims.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildClaimPrompt,
  parseClaims,
  MAX_CLAIMS,
} from '../../../shared/news/fact-claims';

const ARTICLE =
  'The Senate passed the bill 51-49 late Thursday. ' +
  'Supporters called it the largest investment in decades. ' +
  'Analysts expect construction to begin next spring.';

describe('buildClaimPrompt', () => {
  it('includes the title and the text', () => {
    const p = buildClaimPrompt('Senate clears bill', ARTICLE);
    expect(p).toContain('Senate clears bill');
    expect(p).toContain('51-49');
  });

  it('truncates very long text so a single call cannot blow the budget', () => {
    const p = buildClaimPrompt('t', 'word '.repeat(20000));
    expect(p.length).toBeLessThan(60_000);
  });
});

describe('parseClaims', () => {
  it('parses a well-formed response', () => {
    const out = JSON.stringify({
      claims: [
        { text: 'The Senate passed the bill 51-49 late Thursday', class: 'attribution', checkable: true },
        { text: 'Analysts expect construction to begin next spring', class: 'predictive', checkable: false },
      ],
    });
    const claims = parseClaims(out, ARTICLE);
    expect(claims).toHaveLength(2);
    expect(claims[0]?.class).toBe('attribution');
    expect(claims[1]?.checkable).toBe(false);
  });

  it('strips markdown fences the model adds anyway', () => {
    const out = '```json\n{"claims":[{"text":"The Senate passed the bill 51-49 late Thursday","class":"attribution","checkable":true}]}\n```';
    expect(parseClaims(out, ARTICLE)).toHaveLength(1);
  });

  it('drops claims whose text is not actually in the article', () => {
    const out = JSON.stringify({
      claims: [
        { text: 'The Senate passed the bill 51-49 late Thursday', class: 'attribution', checkable: true },
        { text: 'A completely invented sentence', class: 'attribution', checkable: true },
      ],
    });
    // A hallucinated span cannot be anchored, so it is worse than useless.
    expect(parseClaims(out, ARTICLE)).toHaveLength(1);
  });

  it('coerces an unknown class to attribution rather than dropping the claim', () => {
    const out = JSON.stringify({
      claims: [{ text: 'The Senate passed the bill 51-49 late Thursday', class: 'vibes', checkable: true }],
    });
    expect(parseClaims(out, ARTICLE)[0]?.class).toBe('attribution');
  });

  it('returns empty for malformed JSON rather than throwing', () => {
    expect(parseClaims('not json at all', ARTICLE)).toEqual([]);
    expect(parseClaims('', ARTICLE)).toEqual([]);
  });

  it('returns empty when claims is missing or not an array', () => {
    expect(parseClaims('{"claims":"nope"}', ARTICLE)).toEqual([]);
    expect(parseClaims('{}', ARTICLE)).toEqual([]);
  });

  it('deduplicates identical spans', () => {
    const one = { text: 'The Senate passed the bill 51-49 late Thursday', class: 'attribution', checkable: true };
    expect(parseClaims(JSON.stringify({ claims: [one, one] }), ARTICLE)).toHaveLength(1);
  });

  it('caps the number of claims', () => {
    const claims = Array.from({ length: MAX_CLAIMS + 10 }, () => ({
      text: 'The Senate passed the bill 51-49 late Thursday',
      class: 'attribution',
      checkable: true,
    }));
    // identical spans dedupe to 1, so vary them by using real substrings
    const varied = [
      'The Senate passed the bill 51-49 late Thursday',
      'Supporters called it the largest investment in decades',
      'Analysts expect construction to begin next spring',
    ].map((text) => ({ text, class: 'attribution', checkable: true }));
    expect(parseClaims(JSON.stringify({ claims: varied }), ARTICLE).length).toBeLessThanOrEqual(MAX_CLAIMS);
    expect(claims.length).toBeGreaterThan(MAX_CLAIMS);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/news/fact-claims.test.ts`
Expected: FAIL — cannot resolve `shared/news/fact-claims`.

- [ ] **Step 3: Implement**

Create `shared/news/fact-claims.ts`:

```ts
// Claim segmentation: prompt construction and response parsing.
// Pure so it unit-tests without a model call; the model call lives in
// server/news/fact.ts.

export const claimClasses = [
  'quantitative',
  'attribution',
  'causal',
  'predictive',
] as const;
export type ClaimClass = (typeof claimClasses)[number];

export interface RawClaim {
  text: string;
  class: ClaimClass;
  checkable: boolean;
}

/** One model call per article, so the article is capped, not the claim count. */
const MAX_TEXT_CHARS = 24_000;
/** More than this on one page is noise no reader will work through. */
export const MAX_CLAIMS = 25;

export const CLAIM_SYSTEM_PROMPT = [
  'You extract factual claims from news articles.',
  'Return ONLY JSON: {"claims":[{"text":string,"class":string,"checkable":boolean}]}',
  'RULES:',
  '- "text" MUST be an exact substring of the article, copied character for character.',
  '- Do not paraphrase, do not fix typos, do not merge sentences.',
  '- class is one of: quantitative, attribution, causal, predictive.',
  '- checkable=false for opinion, hypotheticals, rhetorical questions and',
  '  forward-looking predictions. Those are never rated.',
  '- Prefer whole clauses that assert something checkable. Skip filler.',
].join('\n');

export function buildClaimPrompt(title: string, text: string): string {
  const body = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  return `TITLE: ${title}\n\nARTICLE:\n${body}`;
}

function stripFences(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function toClass(v: unknown): ClaimClass {
  return typeof v === 'string' &&
    (claimClasses as readonly string[]).includes(v)
    ? (v as ClaimClass)
    : 'attribution';
}

/**
 * Parse, then verify every span against the article.
 *
 * A hallucinated span is worse than a missing one: it cannot be anchored, so
 * it would either vanish silently or, if we were sloppy, highlight the wrong
 * text. Dropping it here is the cheapest place to catch it.
 */
export function parseClaims(
  modelOutput: string,
  articleText: string,
): RawClaim[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(modelOutput));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const rawList = (parsed as { claims?: unknown }).claims;
  if (!Array.isArray(rawList)) return [];

  const seen = new Set<string>();
  const out: RawClaim[] = [];
  for (const item of rawList) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec['text'] === 'string' ? rec['text'].trim() : '';
    if (text.length < 12) continue;
    if (!articleText.includes(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({
      text,
      class: toClass(rec['class']),
      checkable: rec['checkable'] !== false,
    });
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/news/fact-claims.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/news/fact-claims.ts tests/unit/news/fact-claims.test.ts
git commit -m "feat(fact): pure claim-segmentation prompt and parser"
```

---

### Task 2: The `factClaims` endpoint

**Files:**
- Create: `server/news/fact.ts`
- Modify: `shared/news/requests.ts`
- Modify: `server/index.ts`, `server/workers.ts`
- Test: `tests/unit/news/fact-endpoint.test.ts`

**Interfaces:**
- Consumes: `buildClaimPrompt`, `parseClaims`, `CLAIM_SYSTEM_PROMPT` from `shared/news/fact-claims`; `userBilledText`, `NotSignedInError` from `server/news/fact-ai` (Task 0).
- Produces: `factClaims(userId, input) => { claims: RawClaim[] }`

- [ ] **Step 1: Write the failing test with a mocked model**

Create `tests/unit/news/fact-endpoint.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userBilledText = vi.fn();
class NotSignedInError extends Error {}
class NoCreditError extends Error {}
vi.mock('../../../server/news/fact-ai', () => ({
  userBilledText,
  NotSignedInError,
  NoCreditError,
}));

const { factClaims } = await import('../../../server/news/fact');

const TEXT =
  'The Senate passed the bill 51-49 late Thursday. ' +
  'Analysts expect construction to begin next spring.';

describe('factClaims', () => {
  beforeEach(() => {
    userBilledText.mockReset();
  });

  it('returns parsed claims from the model', async () => {
    userBilledText.mockResolvedValue(
      JSON.stringify({
        claims: [
          { text: 'The Senate passed the bill 51-49 late Thursday', class: 'attribution', checkable: true },
        ],
      }),
    );
    const out = await factClaims('u1', { url: 'https://x.test/a', title: 'T', text: TEXT });
    expect(out.claims).toHaveLength(1);
    expect(out.status).toBe('ok');
    expect(userBilledText).toHaveBeenCalledOnce();
  });

  it('returns an empty list when the model returns null', async () => {
    userBilledText.mockResolvedValue(null);
    const out = await factClaims('u1', { url: 'https://x.test/a', title: 'T', text: TEXT });
    expect(out.claims).toEqual([]);
  });

  it('does not call the model for text below the article floor', async () => {
    const out = await factClaims('u1', { url: 'https://x.test/a', title: 'T', text: 'too short' });
    expect(out.claims).toEqual([]);
    expect(userBilledText).not.toHaveBeenCalled();
  });

  it('reports signed-out instead of throwing when there is no session', async () => {
    userBilledText.mockRejectedValue(new NotSignedInError());
    const out = await factClaims('u1', { url: 'https://x.test/a', title: 'T', text: TEXT });
    expect(out.status).toBe('signed-out');
    expect(out.claims).toEqual([]);
  });

  it('reports no-credit distinctly from signed-out', async () => {
    userBilledText.mockRejectedValue(new NoCreditError());
    const out = await factClaims('u1', { url: 'https://x.test/a', title: 'T', text: TEXT });
    expect(out.status).toBe('no-credit');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/news/fact-endpoint.test.ts`
Expected: FAIL — cannot resolve `server/news/fact`.

- [ ] **Step 3: Implement the handler**

Create `server/news/fact.ts`:

```ts
import {
  buildClaimPrompt,
  CLAIM_SYSTEM_PROMPT,
  parseClaims,
  type RawClaim,
} from '../../shared/news/fact-claims';
import { NoCreditError, NotSignedInError, userBilledText } from './fact-ai';

/** Distinct because each has a distinct remedy: login, billing, or nothing. */
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
    if (e instanceof NotSignedInError) return { claims: [], status: 'signed-out' };
    if (e instanceof NoCreditError) return { claims: [], status: 'no-credit' };
    throw e;
  }
  if (raw === null) return { claims: [], status: 'ok' };
  return { claims: parseClaims(raw, input.text), status: 'ok' };
}
```

- [ ] **Step 4: Declare the request**

In `shared/news/requests.ts`, inside `newsRequestDefs`, add:

```ts
  factClaims: authReq({
    input: z.object({
      url: z.string().max(4000),
      title: z.string().max(500),
      text: z.string().max(200_000),
    }),
    output: z.object({
      claims: z.array(
        z.object({
          text: z.string(),
          class: z.enum(['quantitative', 'attribution', 'causal', 'predictive']),
          checkable: z.boolean(),
        }),
      ),
      status: z.enum(['ok', 'signed-out', 'no-credit']),
    }),
    // AI-bearing and user-billed — this limit is abuse control, and it also
    // stops a runaway content script emptying one user's credit.
    rateLimit: { max: 20, window: 60 },
  }),
```

- [ ] **Step 5: Wire the handler in both entries**

In `server/index.ts` and `server/workers.ts`, import `factClaims` from `./news/fact` and add `factClaims,` to the `requests` handler object, beside the other news handlers.

- [ ] **Step 6: Run to verify pass, typecheck, lint**

Run: `pnpm exec vitest run tests/unit/news/fact-endpoint.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm exec tsc --noEmit && pnpm run lint`
Expected: no errors.

- [ ] **Step 7: Verify the Workers bundle still builds**

Run: `pnpm run build:workers`
Expected: exits 0. If it reports "Could not resolve" errors, `server/news/fact.ts` has pulled in a Node-only barrel — check the imports against the `recordPerf` trap note in Global Constraints.

- [ ] **Step 8: Commit**

```bash
git add server/news/fact.ts shared/news/requests.ts server/index.ts server/workers.ts tests/unit/news/fact-endpoint.test.ts
git commit -m "feat(fact): factClaims endpoint"
```

---

### Task 3: Anchoring claims into the live DOM

**Files:**
- Create: `shared/news/fact-anchor.ts`
- Test: `tests/unit/news/fact-anchor.test.ts`

**Interfaces:**
- Produces:
  - `interface TextQuoteSelector { exact: string; prefix: string; suffix: string }`
  - `function buildSelector(text: string, exact: string, from?: number): TextQuoteSelector | null`
  - `function resolveSelector(text: string, sel: TextQuoteSelector): { start: number; end: number } | null`

Anchoring is split deliberately: **offset maths is pure and tested here**, and the DOM `Range` walk that consumes it lives in the content script (Task 4). Nothing here touches a `Document`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/news/fact-anchor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildSelector,
  resolveSelector,
} from '../../../shared/news/fact-anchor';

const TEXT =
  'Alpha beta gamma. The Senate passed the bill 51-49 late Thursday. ' +
  'Delta epsilon. The Senate passed the bill 51-49 late Thursday again.';

describe('buildSelector', () => {
  it('captures prefix and suffix context', () => {
    const sel = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday');
    expect(sel).not.toBeNull();
    expect(sel?.exact).toContain('51-49');
    expect(sel?.prefix.endsWith('Alpha beta gamma. ')).toBe(true);
  });

  it('returns null when the text is absent', () => {
    expect(buildSelector(TEXT, 'nowhere to be found')).toBeNull();
  });

  it('can build a selector for a later occurrence', () => {
    const first = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday');
    const second = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday', 40);
    expect(first?.prefix).not.toBe(second?.prefix);
  });
});

describe('resolveSelector', () => {
  it('round-trips an unchanged document', () => {
    const sel = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday');
    const hit = resolveSelector(TEXT, sel!);
    expect(hit).not.toBeNull();
    expect(TEXT.slice(hit!.start, hit!.end)).toBe(sel!.exact);
  });

  it('disambiguates repeated text using context', () => {
    const second = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday', 40);
    const hit = resolveSelector(TEXT, second!);
    expect(hit!.start).toBeGreaterThan(50);
  });

  it('still resolves after unrelated text is inserted before it', () => {
    const sel = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday');
    const mutated = 'AN AD APPEARED HERE. ' + TEXT;
    const hit = resolveSelector(mutated, sel!);
    expect(mutated.slice(hit!.start, hit!.end)).toBe(sel!.exact);
  });

  it('resolves when surrounding context changed but the quote did not', () => {
    const sel = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday');
    const mutated = TEXT.replace('Alpha beta gamma.', 'Totally different lead-in.');
    const hit = resolveSelector(mutated, sel!);
    expect(mutated.slice(hit!.start, hit!.end)).toBe(sel!.exact);
  });

  it('returns null when the quote is gone entirely', () => {
    const sel = buildSelector(TEXT, 'The Senate passed the bill 51-49 late Thursday');
    expect(resolveSelector('completely different document', sel!)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/news/fact-anchor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `shared/news/fact-anchor.ts`:

```ts
// W3C Web Annotation TextQuoteSelector, offset maths only.
//
// The quote plus its surrounding context is what survives ad reflow, lazy
// loading and SPA re-render: absolute offsets shift, but "this exact sentence,
// preceded by roughly this text" usually does not.

export interface TextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

/** Enough context to disambiguate repeats without bloating storage. */
const CONTEXT = 32;

export function buildSelector(
  text: string,
  exact: string,
  from = 0,
): TextQuoteSelector | null {
  const start = text.indexOf(exact, from);
  if (start === -1) return null;
  return {
    exact,
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(start + exact.length, start + exact.length + CONTEXT),
  };
}

/**
 * Find every occurrence of `exact`, then pick the one whose neighbourhood best
 * matches the recorded context. A single occurrence wins outright; repeats are
 * scored by how many trailing prefix / leading suffix characters agree.
 */
export function resolveSelector(
  text: string,
  sel: TextQuoteSelector,
): { start: number; end: number } | null {
  const hits: number[] = [];
  for (let i = text.indexOf(sel.exact); i !== -1; i = text.indexOf(sel.exact, i + 1)) {
    hits.push(i);
  }
  if (hits.length === 0) return null;

  const first = hits[0];
  if (hits.length === 1 && first !== undefined) {
    return { start: first, end: first + sel.exact.length };
  }

  let best = first ?? 0;
  let bestScore = -1;
  for (const at of hits) {
    const before = text.slice(Math.max(0, at - CONTEXT), at);
    const after = text.slice(at + sel.exact.length, at + sel.exact.length + CONTEXT);
    const score = commonSuffix(before, sel.prefix) + commonPrefix(after, sel.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return { start: best, end: best + sel.exact.length };
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/news/fact-anchor.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/news/fact-anchor.ts tests/unit/news/fact-anchor.test.ts
git commit -m "feat(fact): TextQuoteSelector anchoring maths"
```

---

### Task 4: Paint claims on the page

**Files:**
- Create: `extension/src/content/highlight.ts`
- Create: `extension/src/content/text-map.ts`
- Modify: `extension/src/content/index.ts`
- Modify: `extension/src/background/index.ts`
- Modify: `extension/src/shared/messages.ts`
- Modify: `tests/e2e/extension-gate.spec.ts`

**Interfaces:**
- Produces:
  - `text-map.ts`: `interface TextMap { text: string; toRange(start: number, end: number): Range | null }`, `function buildTextMap(root: HTMLElement): TextMap`
  - `highlight.ts`: `function paintClaims(entries: { id: string; range: Range; band: string }[]): void`, `function claimAtPoint(x: number, y: number): string | null`
  - `messages.ts`: `FETCH_CLAIMS` message, `ClaimsResult`

- [ ] **Step 1: Build the text map**

Create `extension/src/content/text-map.ts`:

```ts
/**
 * A flat string of the article's visible text plus the ability to turn an
 * offset pair back into a DOM Range.
 *
 * This is what lets anchoring stay pure: fact-anchor.ts works in offsets, and
 * this is the only place that knows about nodes.
 */
export interface TextMap {
  text: string;
  toRange(start: number, end: number): Range | null;
}

const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'NAV',
  'HEADER',
  'FOOTER',
  'ASIDE',
]);

export function buildTextMap(root: HTMLElement): TextMap {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null) return NodeFilter.FILTER_REJECT;
      if (SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue === null || node.nodeValue.trim() === ''
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = n as Text;
    const value = t.nodeValue ?? '';
    nodes.push({ node: t, start: text.length, end: text.length + value.length });
    text += value;
  }

  return {
    text,
    toRange(start, end) {
      const from = nodes.find((n) => start >= n.start && start < n.end);
      const to = nodes.find((n) => end > n.start && end <= n.end);
      if (from === undefined || to === undefined) return null;
      const range = document.createRange();
      range.setStart(from.node, start - from.start);
      range.setEnd(to.node, end - to.start);
      return range;
    },
  };
}
```

- [ ] **Step 2: Write the painter**

Create `extension/src/content/highlight.ts`:

```ts
/**
 * Painting with the CSS Custom Highlight API — no nodes are inserted into the
 * page, so there is no layout shift and nothing for the site's own framework
 * to trip over.
 *
 * Two constraints this imposes:
 *  - ::highlight() only honours color, background-color, text-decoration*,
 *    text-shadow and -webkit-text-stroke. No border, box-shadow or padding —
 *    hence tint + underline as the entire visual vocabulary.
 *  - Highlights are NOT hit-testable, so clicks resolve through
 *    caretPositionFromPoint against the stored ranges.
 */
export type Band = 'pending' | 'green' | 'yellow' | 'red' | 'grey';

const BANDS: Band[] = ['pending', 'green', 'yellow', 'red', 'grey'];
const STYLE_ID = 'ugly-fact-highlight-style';

const CSS = `
::highlight(ugly-fact-pending){background-color:rgba(140,146,158,.16);text-decoration:underline 2px rgba(185,190,200,1);text-underline-offset:3px}
::highlight(ugly-fact-green){background-color:rgba(47,158,68,.16);text-decoration:underline 2px rgba(47,158,68,1);text-underline-offset:3px}
::highlight(ugly-fact-yellow){background-color:rgba(214,150,20,.22);text-decoration:underline 2px rgba(214,150,20,1);text-underline-offset:3px}
::highlight(ugly-fact-red){background-color:rgba(224,49,49,.15);text-decoration:underline 2px rgba(224,49,49,1);text-underline-offset:3px}
::highlight(ugly-fact-grey){background-color:rgba(140,146,158,.15);text-decoration:underline 2px rgba(154,160,172,1);text-underline-offset:3px}
`;

const painted = new Map<string, { range: Range; band: Band }>();

export function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in globalThis.CSS;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.append(el);
}

export function paintClaims(
  entries: { id: string; range: Range; band: Band }[],
): void {
  ensureStyle();
  painted.clear();
  for (const e of entries) painted.set(e.id, { range: e.range, band: e.band });

  for (const band of BANDS) {
    const ranges = entries.filter((e) => e.band === band).map((e) => e.range);
    const name = `ugly-fact-${band}`;
    if (ranges.length === 0) {
      globalThis.CSS.highlights.delete(name);
      continue;
    }
    globalThis.CSS.highlights.set(name, new Highlight(...ranges));
  }
}

export function setBand(id: string, band: Band): void {
  const entry = painted.get(id);
  if (entry === undefined) return;
  entry.band = band;
  paintClaims(
    [...painted.entries()].map(([k, v]) => ({ id: k, range: v.range, band: v.band })),
  );
}

/** Highlights are not hit-testable; resolve a click through the caret position. */
export function claimAtPoint(x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos === null) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    if (r === null) return null;
    node = r.startContainer;
    offset = r.startOffset;
  }
  if (node === null) return null;

  for (const [id, { range }] of painted) {
    if (range.comparePoint(node, offset) === 0) return id;
  }
  return null;
}
```

- [ ] **Step 3: Extend the message contract**

Append to `extension/src/shared/messages.ts`:

```ts
import type { ClaimClass } from '../../../shared/news/fact-claims';

export const FETCH_CLAIMS = 'ugly-fact:fetch-claims' as const;

export interface FetchClaimsMessage {
  type: typeof FETCH_CLAIMS;
  url: string;
  title: string;
  text: string;
}

/** Distinct states because each has a distinct remedy. */
export type FactStatus = 'ok' | 'signed-out' | 'no-credit';

export interface ClaimsResult {
  claims: { text: string; class: ClaimClass; checkable: boolean }[];
  error: string | null;
  status: FactStatus;
}

/** Where each actionable state sends the user. Not invented — see the plan's
 *  Global Constraints for where each URL comes from. */
export const LOGIN_URL = 'https://ugly.press/';
export const BILLING_URL = 'https://ugly.bot/account/billing';

export const OPEN_URL = 'ugly-fact:open-url' as const;
export interface OpenUrlMessage {
  type: typeof OPEN_URL;
  url: string;
}
```

- [ ] **Step 4: Fetch from the background worker**

In `extension/src/background/index.ts`, add a listener. **This must be the worker, not the content script** — `ugly.press` sends no CORS headers, and only an extension worker with `host_permissions` may fetch it cross-origin.

```ts
const API_BASE = 'https://ugly.press/api';

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as Partial<FetchClaimsMessage>;
  if (msg.type !== FETCH_CLAIMS) return undefined;
  void (async () => {
    try {
      const res = await fetch(`${API_BASE}/factClaims`, {
        method: 'POST',
        // REQUIRED: this is what carries the ugly.press session cookie, which
        // is both the auth and the AI billing identity. Without it every call
        // is a 401.
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { url: msg.url ?? '', title: msg.title ?? '', text: msg.text ?? '' },
        }),
      });
      // authReq() 401s before the handler runs, so this is the no-session case.
      if (res.status === 401) {
        sendResponse({ claims: [], error: null, status: 'signed-out' });
        return;
      }
      if (!res.ok) {
        sendResponse({ claims: [], error: `HTTP ${String(res.status)}`, status: 'ok' });
        return;
      }
      const body = (await res.json()) as {
        result?: { claims?: unknown; status?: unknown };
      };
      const claims = Array.isArray(body.result?.claims) ? body.result.claims : [];
      const status =
        body.result?.status === 'signed-out' || body.result?.status === 'no-credit'
          ? body.result.status
          : 'ok';
      sendResponse({ claims, error: null, status });
    } catch (e) {
      sendResponse({ claims: [], error: String(e) });
    }
  })();
  return true;
});
```

Add `FETCH_CLAIMS` and `type FetchClaimsMessage` to the existing import from `../shared/messages`.

- [ ] **Step 5: Wire the content script**

In `extension/src/content/index.ts`, after the existing report is sent, add claim fetching and painting when the gate engaged:

```ts
async function checkClaims(): Promise<void> {
  const root = document.querySelector('article') ?? document.body;
  if (!(root instanceof HTMLElement)) return;
  if (!highlightsSupported()) return; // overlay fallback is a later task

  const map = buildTextMap(root);
  const result: ClaimsResult = await chrome.runtime.sendMessage({
    type: FETCH_CLAIMS,
    url: location.href,
    title: document.title,
    text: map.text,
  });
  if (result.status !== 'ok') {
    // Neither state is a failure the user can do nothing about — record it so
    // the badge and popup can offer the right remedy.
    document.documentElement.dataset.uglyFactStatus = result.status;
    void chrome.runtime.sendMessage({ type: SET_STATUS, status: result.status });
    return;
  }
  if (result.error !== null || result.claims.length === 0) return;

  const entries: { id: string; range: Range; band: Band }[] = [];
  let cursor = 0;
  for (const [i, claim] of result.claims.entries()) {
    if (!claim.checkable) continue;
    const sel = buildSelector(map.text, claim.text, cursor);
    if (sel === null) continue;
    cursor = map.text.indexOf(claim.text, cursor) + 1;
    const hit = resolveSelector(map.text, sel);
    if (hit === null) continue;
    const range = map.toRange(hit.start, hit.end);
    // A claim that will not anchor is DROPPED — a misplaced highlight is
    // worse than a missing one.
    if (range === null) continue;
    entries.push({ id: `c${String(i)}`, range, band: 'pending' });
  }
  paintClaims(entries);
  document.documentElement.dataset.uglyFactClaims = String(entries.length);
}
```

Call it from `run()` when `report.verdict.engage` is true, and import the new modules.

- [ ] **Step 6: Add an E2E test**

Append to `tests/e2e/extension-gate.spec.ts` a test that stubs the API so no live AI is spent:

```ts
test('paints anchored claims on an engaged article', async () => {
  const page = await context.newPage();
  await page.route('https://ugly.press/api/factClaims', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          claims: [
            {
              text: 'the Senate passed the National',
              class: 'attribution',
              checkable: true,
            },
          ],
        },
      }),
    });
  });
  await page.goto(`${origin}/article.html`);
  const count = await page.waitForFunction(
    () => document.documentElement.dataset['uglyFactClaims'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  expect(await count.jsonValue()).toBe('1');

  const registered = await page.evaluate(
    () => CSS.highlights.has('ugly-fact-pending'),
  );
  expect(registered).toBe(true);
  await page.close();
});
```

Note: routing from the *page* does not intercept the worker's fetch. If this test shows the stub is bypassed, move the route to `context.route(...)` which covers service-worker requests.

- [ ] **Step 7: Verify**

Run: `pnpm run test:extension`
Expected: all prior tests plus the new one pass.

Run: `pnpm exec tsc --noEmit && pnpm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add extension/src tests/e2e/extension-gate.spec.ts
git commit -m "feat(extension): anchor and paint claims with CSS.highlights"
```

- [ ] **Step 9: Give each actionable state a badge and a remedy**

Extend `extension/src/shared/badge.ts` so the two actionable states are visible
without opening the popup. Both use an attention badge rather than the silent
empty tint:

```ts
export function badgeForStatus(status: FactStatus): BadgeState | null {
  if (status === 'signed-out') {
    return { text: '!', color: BADGE_ENGAGED, title: 'Sign in to check claims' };
  }
  if (status === 'no-credit') {
    return { text: '!', color: BADGE_ENGAGED, title: 'Out of credit — add funds to check claims' };
  }
  return null;
}
```

Both use the attention colour, not the dormant grey: dormant means "nothing to
do here", and these are the opposite — there is exactly one thing to do.

```ts
```

Add unit tests asserting the two states produce **different** titles and that
`'ok'` produces `null` — collapsing them is the bug this guards against.

In the background worker, handle `OPEN_URL` by opening a tab:

```ts
if ((message as { type?: string }).type === OPEN_URL) {
  void chrome.tabs.create({ url: (message as OpenUrlMessage).url });
  return undefined;
}
```

In `extension/src/popup/index.ts`, **either state BLOCKS the popup.** Render the
remedy and nothing else — no source card, no gate ladder. Return before the
normal render path:

```ts
function blockingScreen(status: Exclude<FactStatus, 'ok'>): string {
  if (status === 'signed-out') {
    return `<div class="block">
      <div class="block-h">Sign in to continue</div>
      <div class="block-p">Claim checking is billed to your account, so the
        checker needs you signed in.</div>
      <button class="act" data-url="${LOGIN_URL}">Sign in to ugly.press</button>
    </div>`;
  }
  return `<div class="block">
    <div class="block-h">Out of credit</div>
    <div class="block-p">Your ugly.bot balance is empty, so the checker cannot
      run.</div>
    <button class="act" data-url="${BILLING_URL}">Add funds</button>
  </div>`;
}

// …inside render(), BEFORE the source card is built:
if (status !== 'ok') {
  root.innerHTML = blockingScreen(status);
  wireButtons(root);
  return;
}
```

Wire the buttons to `chrome.runtime.sendMessage({ type: OPEN_URL, url })`.

The blocking screen is a **single clear action**, not an error with a hint
buried in it. A user who cannot act on what the popup says has been told
nothing useful.

**Do not build a login form.** Landing on `https://ugly.press/` hands off to the
framework's own `LoginPopup`; reimplementing OAuth in an extension would be both
redundant and a credential-handling surface we do not want.

Add the styles to `extension/src/popup/popup.css`:

```css
.block { text-align: center; padding: 8px 4px 4px; }
.block-h { font-weight: 800; font-size: 15px; margin-bottom: 8px; }
.block-p { font-size: 12px; line-height: 1.6; color: var(--dim); margin-bottom: 14px; }
.act {
  width: 100%; min-height: 44px; border: none; border-radius: 11px;
  background: var(--orange); color: #fff; font: inherit; font-size: 13px;
  font-weight: 700; cursor: pointer;
}
.act:hover { filter: brightness(1.06); }
```

- [ ] **Step 10: E2E both blocking states**

Stub `factClaims` to return `{claims:[],status:'signed-out'}` and then
`'no-credit'`. For each, assert:

1. the popup shows the right button target — `ugly.press` for one,
   `ugly.bot/account/billing` for the other. This is the regression test against
   the two states being collapsed back together;
2. the popup does **not** contain the source card or the gate ladder — i.e. it
   really blocks rather than appending a warning to the normal view. Assert on
   the absence of `Tier 0 · page shape`.

**Phase A is done here — claims are visible.** Stop and look at real articles before continuing.

---

## Phase B — verdicts

### Task 5: The tally and the `factQuick` endpoint

**Files:**
- Create: `shared/news/fact-tally.ts`
- Test: `tests/unit/news/fact-tally.test.ts`
- Modify: `server/news/fact.ts`, `shared/news/requests.ts`, `server/index.ts`, `server/workers.ts`

**Interfaces:**
- Produces:
  - `type Stance = 'supports' | 'refutes' | 'mixed' | 'silent'`
  - `interface StanceEntry { sourceId: string; name: string; bias: Bias; factuality: Factuality; stance: Stance; independence: number }`
  - `interface Tally { score: number; band: 'green'|'yellow'|'red'|'unverified'; forcedYellowReason: 'variance'|'single-bucket'|null; counted: number }`
  - `function factualityWeight(f: Factuality): number`
  - `function tally(entries: StanceEntry[]): Tally`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/news/fact-tally.test.ts`. It must include, at minimum, these behaviours from the spec — each is a named requirement, not a nicety:

```ts
import { describe, expect, it } from 'vitest';
import { factualityWeight, tally, type StanceEntry } from '../../../shared/news/fact-tally';

const e = (
  sourceId: string,
  bias: StanceEntry['bias'],
  factuality: StanceEntry['factuality'],
  stance: StanceEntry['stance'],
  independence = 1,
): StanceEntry => ({ sourceId, name: sourceId, bias, factuality, stance, independence });

describe('factualityWeight', () => {
  it('is monotonic from very-low to very-high', () => {
    const order = ['very-low', 'low', 'mixed', 'high', 'very-high'] as const;
    const weights = order.map(factualityWeight);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeGreaterThan(weights[i - 1]!);
    }
  });
});

describe('tally', () => {
  it('returns unverified with no entries', () => {
    expect(tally([]).band).toBe('unverified');
  });

  it('excludes silent sources from BOTH sides of the ratio', () => {
    const withSilent = tally([
      e('a', 'center', 'high', 'supports'),
      e('b', 'center', 'high', 'silent'),
    ]);
    const without = tally([e('a', 'center', 'high', 'supports')]);
    expect(withSilent.score).toBeCloseTo(without.score);
    expect(withSilent.counted).toBe(1);
  });

  it('greens a cross-spectrum consensus', () => {
    const t = tally([
      e('a', 'left', 'high', 'supports'),
      e('b', 'center', 'very-high', 'supports'),
      e('c', 'right', 'high', 'supports'),
    ]);
    expect(t.band).toBe('green');
  });

  it('FORCES yellow when every supporter sits in one bias bucket', () => {
    const t = tally([
      e('a', 'right', 'mixed', 'supports'),
      e('b', 'far-right', 'mixed', 'supports'),
      e('c', 'right', 'high', 'supports'),
    ]);
    expect(t.score).toBeGreaterThan(0.75);
    expect(t.band).toBe('yellow');
    expect(t.forcedYellowReason).toBe('single-bucket');
  });

  it('FORCES yellow on high stance variance', () => {
    const t = tally([
      e('a', 'left', 'high', 'supports'),
      e('b', 'center', 'very-high', 'refutes'),
      e('c', 'right', 'high', 'supports'),
      e('d', 'center', 'high', 'refutes'),
    ]);
    expect(t.band).toBe('yellow');
    expect(t.forcedYellowReason).toBe('variance');
  });

  it('reds a claim the highest-weighted sources refute', () => {
    const t = tally([
      e('a', 'center', 'very-high', 'refutes'),
      e('b', 'center', 'very-high', 'refutes'),
      e('c', 'left', 'high', 'refutes'),
      e('d', 'right', 'mixed', 'supports', 0.3),
    ]);
    expect(t.band).toBe('red');
  });

  it('lets the independence discount change the band', () => {
    const correlated = [
      e('a', 'center', 'very-high', 'refutes'),
      e('b', 'center', 'very-high', 'refutes'),
      e('c', 'right', 'mixed', 'supports', 0.3),
      e('d', 'right', 'mixed', 'supports', 0.3),
      e('f', 'right', 'mixed', 'supports', 0.3),
    ];
    const independent = correlated.map((x) => ({ ...x, independence: 1 }));
    expect(tally(correlated).score).toBeLessThan(tally(independent).score);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/news/fact-tally.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `shared/news/fact-tally.ts`**

Implement to satisfy the tests exactly:
- `factualityWeight`: `very-low` 0.2, `low` 0.35, `mixed` 0.55, `high` 0.8, `very-high` 0.95.
- `tally`: skip `silent`; `w = factualityWeight × independence`; `score = Σ(w·stance)/Σw` with `supports +1`, `refutes −1`, `mixed 0`.
- Bands: `≥ +0.75` green, `≤ −0.75` red, else yellow.
- Forced yellow, applied **after** banding, and only when the raw band was green or red:
  - `single-bucket` when every `supports` entry maps to the same bucket via `biasBucket` (`far-left|left|lean-left` → left, `center` → center, `lean-right|right|far-right` → right) **and** at least two supporters exist.
  - `variance` when both `supports` and `refutes` carry ≥25% of total weight each.
- `counted` is the number of non-silent entries.
- Empty (or all-silent) → `{ score: 0, band: 'unverified', forcedYellowReason: null, counted: 0 }`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/news/fact-tally.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `factQuick` to `server/news/fact.ts`**

Retrieval + stance extraction + tally:
1. `getDocs('file', { public: true }, { near: <embedded claim>, limit: 12 })` over the corpus.
2. Map each hit's `feedId` through `feedIdToSourceId` / `sourceById` to a rating; unrated hits get weight 0 and are reported separately.
3. One `userBilledText` call per claim (NOT `genText` — billing must stay on the user), `deepseek_v4_flash`, asking **only** for each source's stance, never whether the claim is true. Fixture this in tests.
4. Collapse near-duplicate sources into one weighted vote via centroid distance; that is the `independence` value.
5. Return `{ verdicts: [{ id, score, band, forcedYellowReason, tier, counted, sources[] }] }`.

Declare it with `authReq` in `shared/news/requests.ts`, returning the same `status` union alongside the verdicts exactly as `factClaims` does (a claim run that exhausts credit mid-page must surface `no-credit`, not a half-painted page), with `rateLimit: { max: 10, window: 60 }` — it is the most expensive endpoint here — and wire it in both server entries.

- [ ] **Step 6: Verify**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm run lint && pnpm run build:workers`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add shared/news/fact-tally.ts tests/unit/news/fact-tally.test.ts server/news/fact.ts shared/news/requests.ts server/index.ts server/workers.ts
git commit -m "feat(fact): weighted stance tally and factQuick endpoint"
```

---

### Task 6: Colour the claims and show the verdict

**Files:**
- Modify: `extension/src/content/index.ts`, `extension/src/background/index.ts`, `extension/src/shared/messages.ts`
- Create: `extension/src/content/popover.ts`
- Modify: `tests/e2e/extension-gate.spec.ts`

- [ ] **Step 1: Fetch verdicts after painting**

Add a `FETCH_QUICK` message mirroring `FETCH_CLAIMS`, fetched in the background worker. On response, call `setBand(id, band)` per claim so pending tints resolve to green/yellow/red/grey in place.

- [ ] **Step 2: Build the in-page popover**

Create `extension/src/content/popover.ts` rendering into a **closed shadow root** attached to a single container element, so site CSS cannot reach it and it cannot leak styles outward. It shows the band, the claim text, the tier badge, the tally (source, stance, independence, weight) and the `Σ(w·stance)/Σw` division.

**The score must be computed from the rows being rendered**, never carried alongside them — otherwise any future filtering desynchronises the number from the table beneath it.

- [ ] **Step 3: Wire click handling**

On `click`, call `claimAtPoint(e.clientX, e.clientY)`; if it returns an id, open the popover anchored near the click. Highlights are not hit-testable, so this caret-based path is the only way.

- [ ] **Step 4: E2E**

Stub both `factClaims` and `factQuick` via `context.route`, assert a claim ends up in the `ugly-fact-red` highlight registry and that clicking it opens the popover with the tally visible.

- [ ] **Step 5: Verify and commit**

Run: `pnpm run test:extension && pnpm exec tsc --noEmit && pnpm run lint`

```bash
git add extension/src tests/e2e/extension-gate.spec.ts
git commit -m "feat(extension): verdict colouring and in-page claim popover"
```

---

## Done when

- Opening a rated news article highlights real claims, coloured by verdict.
- Clicking a highlight opens a popover showing the tally that produced it.
- `pnpm exec vitest run`, `pnpm run test:extension`, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run build:workers` all pass.
- No test spends a live AI call.

## Deliberately not in this step

- `factChallenge` and the adversarial deep dive.
- `factSpread` — the bias bar, blindspot and other-side coverage.
- Suppressions, custom mode, export.
- The `getClientRects` overlay fallback for browsers without `CSS.highlights`.
- A sign-in form or OAuth implementation of our own. The extension opens
  ugly.press and the framework's `LoginPopup` takes over; the cookie set there
  authenticates the next call. No token is copied into the extension, and the
  extension never handles credentials.
- Reading the balance up front. We discover `no-credit` by being told 402, not
  by polling a balance endpoint before every call.

## Known risks

1. **The user must be signed in with credit** for any claim checking, because
   the AI is billed to them. Both failure states **block the popup** with a
   single fix button rather than degrading — so a signed-out or empty-balance
   user sees the remedy, not a half-working panel that hides why nothing
   happened.

   **VERIFIED** — an extension service worker's `fetch` does carry the origin's
   cookies. Measured against a local origin that sets a session cookie:
   `credentials:'include'` → cookie sent; `'omit'` → not sent; default → sent.
   The request also carries **no `Origin` header**, which is precisely why CORS
   never engages for the worker path. Pass `credentials:'include'` explicitly
   rather than leaning on the default. The `cookies`-permission fallback is not
   needed.
2. **Prod-only iteration.** Local dev wants Docker, so the practical loop is deploy-to-prod. Keep `factClaims` cheap and idempotent.
3. **The stub-vs-worker routing question in Task 4 Step 6.** Page-level `page.route` may not intercept a service-worker fetch; `context.route` is the fallback. Resolve it the first time the test runs rather than guessing.
