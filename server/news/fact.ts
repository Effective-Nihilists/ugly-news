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
import {
  buildStancePrompt,
  parseStances,
  STANCE_SYSTEM_PROMPT,
} from '../../shared/news/fact-stance';
import {
  tally,
  type Band as TallyBand,
  type ForcedYellowReason,
  type Stance,
  type StanceEntry,
} from '../../shared/news/fact-tally';
import { feedIdToSourceId, sourceById } from '../../shared/news/sourceBias';
import type { Bias, Factuality } from '../../shared/news/schemas';
import { collections } from '../../shared/collections';
import { embed } from './ai';
import type { NewsDb } from './db';

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

/** How many corpus articles to weigh per claim. */
const RETRIEVE = 12;
/** Cost ceiling: one model call per claim, so the page is capped, not the call. */
const MAX_QUICK_CLAIMS = 8;
/**
 * Above this cosine similarity two articles are the same reporting — usually
 * the same wire copy under different mastheads. Counting both as independent
 * corroboration is how a single AP story becomes a "consensus".
 */
const DUPLICATE_AT = 0.93;

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Independence: 1 for a story nothing else duplicates, falling as near-copies
 * pile up. Each member of a cluster of k near-identical articles gets 1/k, so
 * the cluster as a whole still counts once.
 */
export function independenceScores(vecs: (number[] | null)[]): number[] {
  return vecs.map((v, i) => {
    if (v === null) return 1;
    let k = 1;
    for (let j = 0; j < vecs.length; j++) {
      const o = vecs[j];
      if (j === i || o == null) continue;
      if (cosine(v, o) >= DUPLICATE_AT) k++;
    }
    return 1 / k;
  });
}

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

// ─── Tier 2 + 3: what other outlets say about each claim ────────────────────

export interface QuickSource {
  name: string;
  bias: Bias;
  factuality: Factuality;
  stance: Stance;
  independence: number;
}

export interface Verdict {
  id: string;
  score: number;
  band: TallyBand;
  forcedYellowReason: ForcedYellowReason;
  counted: number;
  sources: QuickSource[];
}

const stancesSchema = z.object({
  stances: z.array(z.object({ index: z.number(), stance: z.string() })),
});

/** Resolve a retrieved article to a RATED publisher, or nothing. */
function ratingFor(feedId: string | null | undefined): {
  sourceId: string;
  name: string;
  bias: Bias;
  factuality: Factuality;
} | null {
  if (feedId === null || feedId === undefined) return null;
  const sid = feedIdToSourceId[feedId];
  const src = sid === undefined ? undefined : sourceById[sid];
  if (src === undefined) return null;
  return {
    sourceId: sid ?? feedId,
    name: src.name,
    bias: src.bias,
    factuality: src.factuality,
  };
}

/**
 * One claim, weighed against the corpus.
 *
 * Retrieval is vector ANN over the SAME article corpus the app already indexes,
 * so this costs one embedding plus one model call per claim.
 */
async function quickOne(
  db: NewsDb,
  gen: ReturnType<typeof createTextGen>,
  claim: { id: string; text: string },
): Promise<Verdict> {
  const empty: Verdict = {
    id: claim.id,
    score: 0,
    band: 'unverified',
    forcedYellowReason: null,
    counted: 0,
    sources: [],
  };

  const vec = await embed(claim.text);
  if (vec === null) return empty;

  const hits = await db.getDocs(
    collections.file,
    { public: true, embedded: true },
    { near: vec, limit: RETRIEVE },
  );
  // Only RATED publishers can carry weight — an unrated outlet has no
  // factuality score, and inventing one would be the whole bias problem again.
  const rated = hits
    .map((f) => ({ file: f, rating: ratingFor(f.feedId) }))
    .filter(
      (
        x,
      ): x is {
        file: (typeof hits)[number];
        rating: NonNullable<ReturnType<typeof ratingFor>>;
      } => x.rating !== null,
    );
  if (rated.length === 0) return empty;

  const excerpts = rated.map((x, i) => ({
    index: i,
    outlet: x.rating.name,
    title: x.file.title ?? '',
    text: x.file.text ?? '',
  }));

  let stances: Stance[];
  try {
    const out = await gen.generateJson(stancesSchema, [
      { role: 'system', content: STANCE_SYSTEM_PROMPT },
      { role: 'user', content: buildStancePrompt(claim.text, excerpts) },
    ]);
    stances = parseStances(out.stances, excerpts.length);
  } catch (e) {
    // Rethrown so the caller can map 401/402 to their remedies; a stance call
    // that fails must not silently become "nobody covered this".
    throw e instanceof Error ? e : new Error(String(e));
  }

  const vecs = await db.getVecs(
    collections.file,
    rated.map((x) => x.file._id),
  );
  const independence = independenceScores(
    rated.map((x) => vecs[x.file._id] ?? null),
  );

  const entries: StanceEntry[] = rated.map((x, i) => ({
    sourceId: x.rating.sourceId,
    name: x.rating.name,
    bias: x.rating.bias,
    factuality: x.rating.factuality,
    stance: stances[i] ?? 'silent',
    independence: independence[i] ?? 1,
  }));

  const t = tally(entries);
  return {
    id: claim.id,
    score: t.score,
    band: t.band,
    forcedYellowReason: t.forcedYellowReason,
    counted: t.counted,
    // Only the sources that actually voted are worth showing.
    sources: entries
      .filter((x) => x.stance !== 'silent')
      .map((x) => ({
        name: x.name,
        bias: x.bias,
        factuality: x.factuality,
        stance: x.stance,
        independence: x.independence,
      })),
  };
}

export async function factQuick(
  db: NewsDb,
  userId: string,
  input: { claims: { id: string; text: string }[] },
): Promise<{ verdicts: Verdict[]; status: FactStatus; error: string | null }> {
  const claims = input.claims.slice(0, MAX_QUICK_CLAIMS);
  if (claims.length === 0) return { verdicts: [], status: 'ok', error: null };

  const gen = createTextGen(userId, {
    model: CLAIM_MODEL,
    temperature: 0,
    maxTokens: 800,
  });

  const verdicts: Verdict[] = [];
  for (const claim of claims) {
    try {
      verdicts.push(await quickOne(db, gen, claim));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Credit exhausted mid-page is a STATE, and it stops the run — carrying
      // on would bill nothing and paint a half-checked article as complete.
      if (/\b401\b|Unauthenticated/i.test(msg)) {
        return { verdicts, status: 'signed-out', error: null };
      }
      if (/\b402\b|insufficient balance/i.test(msg)) {
        return { verdicts, status: 'no-credit', error: null };
      }
      console.error(`[fact] quick failed for ${claim.id}: ${msg}`);
      return { verdicts, status: 'ok', error: msg.slice(0, 300) };
    }
  }
  return { verdicts, status: 'ok', error: null };
}
