import { getAdapter } from 'ugly-app/server/adapter/workers';
import { LRUCache } from 'lru-cache';
import type { Factuality } from '../../shared/news/schemas';

// IDIAP MBFC domain→bias/factuality table (~3,920 domains). The DATA is loaded
// straight into Neon (`domainBias` table) and is NOT checked into git; only this
// cached lookup + the table schema live in the repo. Lets ANY ingested article
// be rated by its domain, beyond the hand-curated feeds in sourceBias.ts.

export interface DomainRating {
  biasScore: number;
  factuality: Factuality | null;
}

// In-memory cache in front of the DB lookups (per Worker isolate). The table is
// static, so cache both hits AND misses (negative caching) with a long TTL to
// avoid re-querying the same domains every article. Value is wrapped ({ r }) so a
// cached miss (r: null) is distinguishable from "not in cache" (LRU disallows
// null values directly).
const cache = new LRUCache<string, { r: DomainRating | null }>({
  max: 8000,
  ttl: 6 * 60 * 60 * 1000,
});

/** Full URL or bare host → registrable-ish domain (drop scheme/path/`www.`). */
export function normalizeDomain(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch {
      /* not a URL — treat as a bare host */
    }
  }
  host = host
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  return host || null;
}

/**
 * Cached IDIAP rating for a domain (or full URL). Tries the exact host, then the
 * registrable domain (last two labels). Returns null when the domain isn't in
 * the table — cached negatively so repeat misses don't re-query.
 */
export async function getDomainRating(
  input: string | null | undefined,
): Promise<DomainRating | null> {
  const host = normalizeDomain(input);
  if (!host) return null;
  const cached = cache.get(host);
  if (cached !== undefined) return cached.r;

  const candidates = [host];
  const parts = host.split('.');
  if (parts.length > 2) candidates.push(parts.slice(-2).join('.'));

  let rating: DomainRating | null = null;
  try {
    const rows = await getAdapter().db.query<{
      bias_score: number | string;
      factuality: string | null;
    }>(
      // Prefer the exact host over the registrable-domain fallback.
      `SELECT bias_score, factuality FROM "domainBias"
         WHERE _id = ANY($1)
         ORDER BY array_position($1, _id) LIMIT 1`,
      [candidates],
    );
    const row = rows[0];
    if (row) {
      rating = {
        biasScore: Number(row.bias_score),
        factuality: (row.factuality as Factuality | null) ?? null,
      };
    }
  } catch (e) {
    console.warn('[domainBias] lookup failed', e);
    return null; // don't cache transient errors
  }
  cache.set(host, { r: rating });
  return rating;
}
