import type { DBObject, TypedDB } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsCluster } from '../../shared/collections';
import {
  computeBiasBreakdown,
  detectBlindspot,
  toBiasBucket,
} from '../../shared/news/cluster-logic';
import { feedIdToSourceId, sourceById } from '../../shared/news/sourceBias';
import { getDomainRating, normalizeDomain } from './domainBias';
import type {
  ClusterCardSchema,
  ClusterFullSchema,
  UglyTakeCardSchema,
} from '../../shared/news/requests';
import type { z } from 'ugly-app/shared';
import { decodeHtmlEntities } from './download';

type Db = TypedDB<Record<string, DBObject>>;
type ClusterCard = z.infer<typeof ClusterCardSchema>;
type ClusterFull = z.infer<typeof ClusterFullSchema>;
type UglyTakeCard = z.infer<typeof UglyTakeCardSchema>;

const RECENT_MS = 4 * 24 * 60 * 60 * 1000; // Top Stories window

function snippet(s: string, n = 220): string {
  const t = s
    .replace(/[#>*_`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function toCard(c: NewsCluster & { _id: string }): ClusterCard {
  return {
    id: c._id,
    title: decodeHtmlEntities(c.title),
    category: c.category,
    biasBreakdown: c.biasBreakdown,
    blindspotSide: c.blindspotSide,
    factualityAvg: c.factualityAvg,
    articleCount: c.articleCount,
    sourceCount: c.sourceIds.length,
    topImageUri: c.topImageUri,
    summary: c.neutralSummary ? snippet(c.neutralSummary) : null,
    hasUglyTake: c.uglyTakeFileId !== null,
    lastUpdatedAt: c.lastUpdatedAt,
  };
}

/** Score-ranked Top Stories for the home rail (recent, optionally per desk). */
export async function newsTopStories(
  db: Db,
  input: { limit?: number | undefined; category?: string | undefined },
): Promise<{ items: ClusterCard[] }> {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 40);
  const match: Record<string, unknown> = {
    lastUpdatedAt: { $gte: Date.now() - RECENT_MS },
  };
  if (input.category) match.category = input.category;
  const rows = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [{ $match: match }, { $sort: { score: -1 } }],
    { limit },
  );
  return { items: rows.map(toCard) };
}

/** Clusters flagged as a one-sided blindspot, newest-first. */
export async function newsBlindspot(
  db: Db,
  input: { limit?: number | undefined },
): Promise<{ items: ClusterCard[] }> {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 40);
  const rows = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [
      { $match: { blindspotSide: { $in: ['left', 'right'] } } },
      { $sort: { lastUpdatedAt: -1 } },
    ],
    { limit },
  );
  return { items: rows.map(toCard) };
}

/** Newest Ugly Takes (labeled satire), for the home feature/rail + Satire Desk.
 *  Reads each satire file by id (server-side read is fine even though the file is
 *  public:false) and returns just the headline/illustration/teaser + cluster id. */
export async function newsUglyTakes(
  db: Db,
  input: { limit?: number | undefined },
): Promise<{ items: UglyTakeCard[] }> {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 40);
  const rows = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [
      { $match: { uglyTakeFileId: { $ne: null } } },
      { $sort: { satirizedAt: -1 } },
    ],
    { limit },
  );
  const items: UglyTakeCard[] = [];
  for (const c of rows) {
    if (!c.uglyTakeFileId) continue;
    const sf = await db.getDoc(collections.file, c.uglyTakeFileId);
    if (!sf) continue;
    const f = sf as FileMarkdown;
    // Drop the leading H1 (already the title) before the teaser snippet.
    const body = (f.markdown ?? '').replace(/^\s*#[^\n]*\n/, '');
    items.push({
      clusterId: c._id,
      category: c.category,
      satireTitle: decodeHtmlEntities(f.title ?? 'The Ugly Take'),
      satireImageUri: f.thumbnail?.uri ?? null,
      satireSnippet: snippet(body, 160),
      lastUpdatedAt: c.satirizedAt ?? c.lastUpdatedAt,
    });
  }
  return { items };
}

/** Paginated cluster browse, newest-first, optional desk filter. */
export async function newsClusterArchive(
  db: Db,
  input: {
    limit?: number | undefined;
    skip?: number | undefined;
    category?: string | undefined;
  },
): Promise<{ items: ClusterCard[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const skip = Math.max(input.skip ?? 0, 0);
  const match: Record<string, unknown> = {};
  if (input.category) match.category = input.category;
  const rows = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [{ $match: match }, { $sort: { lastUpdatedAt: -1 } }],
    { limit: limit + 1, skip },
  );
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map(toCard), hasMore };
}

/** Full "three ways" cluster: coverage by side, sources, framing + Ugly Take. */
export async function newsClusterGet(
  db: Db,
  input: { id: string },
): Promise<{ cluster: ClusterFull | null }> {
  const doc = await db.getDoc(collections.newsCluster, input.id);
  if (!doc) {
    console.log(`[clusters] newsClusterGet miss for id=${input.id}`);
    return { cluster: null };
  }
  const c = doc as NewsCluster & { _id: string };

  const files = await db.getQuery<FileMarkdown & { _id: string }>('file', [
    { $match: { _id: { $in: c.fileIds.slice(0, 80) } } },
  ]);

  // Dedupe coverage to DISTINCT OUTLETS — a site's multiple articles collapse to
  // one row (with an article count) so the same site isn't counted repeatedly.
  // Rating resolution: hand-curated feed→source FIRST (best quality), then the
  // IDIAP domain table (cached) so uncurated domains still land on the bias bar.
  type Cov = ClusterFull['coverage'][number];
  const byOutlet = new Map<string, Cov>();
  for (const f of files) {
    const sid = f.feedId ? feedIdToSourceId[f.feedId] : undefined;
    const src = sid ? sourceById[sid] : undefined;
    const domain = normalizeDomain(f.sourceUri);
    const key =
      sid ?? (domain ? `domain:${domain}` : `feed:${f.feedId ?? f._id}`);
    const existing = byOutlet.get(key);
    if (existing) {
      existing.articleCount += 1;
      if (!existing.uri && f.sourceUri) existing.uri = f.sourceUri;
      continue;
    }
    let bucket = src ? toBiasBucket(src.biasScore) : null;
    let factuality: string | null = src?.factuality ?? null;
    if (!src) {
      const idiap = await getDomainRating(f.sourceUri);
      if (idiap) {
        bucket = toBiasBucket(idiap.biasScore);
        factuality = idiap.factuality;
      }
    }
    byOutlet.set(key, {
      fileId: f._id,
      title: decodeHtmlEntities(f.title ?? 'Untitled'),
      sourceId: sid ?? null,
      sourceName: src?.name ?? domain ?? f.feedId ?? 'Unknown',
      bucket,
      factuality: factuality as Cov['factuality'],
      uri: f.sourceUri ?? null,
      articleCount: 1,
    });
  }
  const coverage = [...byOutlet.values()];

  // Recompute the bias bar from DISTINCT outlets (curated OR IDIAP-rated) so older
  // clusters (whose stored breakdown was per-article) render correctly.
  const bucketScore = (b: Cov['bucket']): number | null =>
    b === 'left' ? -3 : b === 'right' ? 3 : b === 'center' ? 0 : null;
  const biasBreakdown = computeBiasBreakdown(
    coverage.map((x) => ({
      biasScore: bucketScore(x.bucket),
      factuality: null,
    })),
  );
  const blindspotSide = detectBlindspot(biasBreakdown);
  const sourceCount = coverage.filter((x) => x.bucket !== null).length;

  const sources = c.sourceIds
    .map((sid) => {
      const s = sourceById[sid];
      if (!s) return null;
      return {
        sourceId: sid,
        name: s.name,
        bias: s.bias,
        biasScore: s.biasScore,
        factuality: s.factuality,
        bucket: toBiasBucket(s.biasScore),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  let uglyTake: ClusterFull['uglyTake'] = null;
  if (c.uglyTakeFileId) {
    const sf = await db.getDoc(collections.file, c.uglyTakeFileId);
    if (sf) {
      const f = sf as FileMarkdown;
      uglyTake = {
        id: c.uglyTakeFileId,
        title: f.title ?? 'The Ugly Take',
        markdown: f.markdown ?? '',
        imageUri: f.thumbnail?.uri ?? null,
      };
    }
  }

  return {
    cluster: {
      ...toCard(c),
      biasBreakdown, // distinct-outlet recompute (overrides the stored per-article value)
      blindspotSide,
      sourceCount,
      neutralSummary: c.neutralSummary,
      framingSummary: c.framingSummary,
      sources,
      coverage,
      uglyTake,
    },
  };
}
