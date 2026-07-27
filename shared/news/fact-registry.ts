// Domain → publisher rating, for the registry bundled into the extension.
// Pure and dependency-free so the same code runs in a content script, in the
// Workers server, and under vitest.

import type { Bias, Factuality } from './schemas';
import type { NewsSourceSeed } from './sourceBias';

export interface SourceRating {
  id: string;
  name: string;
  bias: Bias;
  biasScore: number;
  factuality: Factuality;
  owner: string | null;
  country: string | null;
}

/** Flat domain → rating map. Every domain of every seed gets its own key. */
export type RegistryIndex = Record<string, SourceRating>;

export function buildRegistryIndex(
  seeds: readonly NewsSourceSeed[],
): RegistryIndex {
  const index: RegistryIndex = {};
  for (const seed of seeds) {
    const rating: SourceRating = {
      id: seed.id,
      name: seed.name,
      bias: seed.bias,
      biasScore: seed.biasScore,
      factuality: seed.factuality,
      owner: seed.owner,
      country: seed.country,
    };
    for (const domain of seed.domains) {
      index[normalizeHost(domain)] = rating;
    }
  }
  return index;
}

/** Lowercase, drop a port, drop a trailing dot, drop a leading `www.`. */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  const colon = h.indexOf(':');
  if (colon !== -1) h = h.slice(0, colon);
  while (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

/**
 * Exact match, then progressively shorter suffixes.
 *
 * Walking suffixes longest-first means no Public Suffix List is needed: the
 * index only ever contains real registered domains, so `news.bbc.co.uk` finds
 * `bbc.co.uk` before it would ever reach `co.uk`, and `co.uk` is not a key.
 * Splitting on labels (rather than substring matching) is what stops
 * `notcnn.com` matching `cnn.com`.
 */
export function lookupRating(
  host: string,
  index: RegistryIndex,
): SourceRating | null {
  const normalized = normalizeHost(host);
  if (normalized === '') return null;

  const labels = normalized.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const hit = index[candidate];
    if (hit !== undefined) return hit;
  }
  return null;
}
