import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { NewsSource } from '../../shared/collections';
import { newsSourceSeeds } from '../../shared/news/sourceBias';
import type { NewsDb } from './db';

// Idempotently upsert the outlet bias/factuality registry from the curated seed
// (shared/news/sourceBias.ts). Runs at startup so the single source of truth is
// the TS table — editing a rating and redeploying re-seeds. Cheap (~33 small
// docs); the `newsSource` collection is cached + public.
export async function seedNewsSources(db: NewsDb): Promise<void> {
  await Promise.all(
    newsSourceSeeds.map((s) => {
      const doc: NewsSource & { _id: string } = {
        _id: s.id,
        name: s.name,
        homepage: s.homepage,
        domains: s.domains,
        feedIds: s.feedIds,
        bias: s.bias,
        biasScore: s.biasScore,
        factuality: s.factuality,
        owner: s.owner,
        country: s.country,
        ...dbDefaults(),
      };
      return db.setDoc(collections.newsSource, doc);
    }),
  );
  console.log(`[news] seeded ${newsSourceSeeds.length} news sources (bias/factuality registry)`);
}
