import { dbDefaults } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsCluster } from '../../shared/collections';
import {
  assignToCluster,
  averageFactuality,
  clusterAcceptsArticle,
  computeBiasBreakdown,
  computeClusterScore,
  detectBlindspot,
  updateCentroid,
  type MemberSourceRating,
} from '../../shared/news/cluster-logic';
import { feedIdToSourceId, sourceById } from '../../shared/news/sourceBias';
import type { Factuality } from '../../shared/news/schemas';
import type { NewsCategory } from '../../shared/news/types';
import type { NewsDb } from './db';
import { recordPerfSample } from './perf';
import { enqueueTask } from './queue';

// How far back to look for an existing cluster to join. Stories older than this
// have "happened"; a new article matching them starts a fresh cluster.
const CLUSTER_WINDOW_MS = 72 * 60 * 60 * 1000;
// Cosine threshold to join a cluster. Tunable via env (CLUSTER_SIM_THRESHOLD).
// Calibrated on PROD embeddings (2026-06-30): same-event cross-spectrum framing
// lands ~0.74-0.85; at 0.78 only ~7/556 clusters spanned both left+right, and a
// nearest-neighbor scan showed lowering 0.78→0.74 recovers ~50% more same-event
// merges before the 0.68-0.72 "same topic, different event" muddy zone. Default
// 0.74; raise if unrelated stories merge, lower if sides stay split.
// eslint-disable-next-line @typescript-eslint/dot-notation
const SIMILARITY_THRESHOLD = Number(process.env['CLUSTER_SIM_THRESHOLD'] ?? '0.74');
const CANDIDATE_LIMIT = 400;
const SATIRE_MIN_ARTICLES = 3;

function distinctBuckets(b: NewsCluster['biasBreakdown']): number {
  return (b.left > 0 ? 1 : 0) + (b.center > 0 ? 1 : 0) + (b.right > 0 ? 1 : 0);
}

/** Coerce a stored `created` value (Date | number | string) to epoch ms. */
function toMs(v: unknown, fallback: number): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? fallback : t;
  }
  return fallback;
}

/** Static bias/factuality rating for each member feed (unrated → nulls). */
function ratingsForFeeds(feedIds: string[]): MemberSourceRating[] {
  return feedIds.map((fid) => {
    const sid = feedIdToSourceId[fid];
    const src = sid ? sourceById[sid] : undefined;
    return src
      ? { biasScore: src.biasScore, factuality: src.factuality }
      : { biasScore: null, factuality: null };
  });
}

/** Recompute the derived aggregates (bias bar, blindspot, factuality, score)
 *  for a cluster from its member feed list. Pure-ish — only static rating data. */
function recomputeAggregates(
  feedIds: string[],
  now: number,
  firstSeenAt: number,
  engagement: number,
): Pick<NewsCluster, 'biasBreakdown' | 'blindspotSide' | 'factualityAvg' | 'score'> {
  const ratings = ratingsForFeeds(feedIds);
  const biasBreakdown = computeBiasBreakdown(ratings);
  const blindspotSide = detectBlindspot(biasBreakdown);
  const facts = ratings
    .map((r) => r.factuality)
    .filter((f): f is Factuality => f !== null);
  const factualityAvg = averageFactuality(facts);
  const distinctBuckets =
    (biasBreakdown.left > 0 ? 1 : 0) +
    (biasBreakdown.center > 0 ? 1 : 0) +
    (biasBreakdown.right > 0 ? 1 : 0);
  const ageHours = (now - firstSeenAt) / (60 * 60 * 1000);
  const score = computeClusterScore({
    articleCount: feedIds.length,
    distinctBuckets,
    ageHours,
    engagement,
  });
  return { biasBreakdown, blindspotSide, factualityAvg, score };
}

/**
 * Assign a freshly-summarized article to a story cluster — joining the nearest
 * recent cluster (cosine ≥ threshold, same category) or starting a new one. The
 * embedding is passed in directly because the scraper has it in scope (the
 * framework strips it from the file's JSON when it materializes the pgvector
 * column). Best-effort: callers wrap this so a failure can't break the scrape.
 */
export async function assignFileToCluster(
  db: NewsDb,
  file: FileMarkdown & { _id: string },
  embedding: number[],
  feedId: string,
  now: number = Date.now(),
): Promise<string> {
  const category = (file.category ?? file.tags?.[0] ?? 'world') as NewsCategory;
  const articleCreatedMs = toMs((file as { created?: unknown }).created, now);

  const candidates = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [
      {
        $match: {
          category,
          lastUpdatedAt: { $gte: now - CLUSTER_WINDOW_MS },
        },
      },
      { $sort: { lastUpdatedAt: -1 } },
    ],
    { limit: CANDIDATE_LIMIT },
  );

  // Date gate (B + light C): drop clusters too old since first appearance, or
  // whose activity is too far from this article's own publish time, BEFORE the
  // cosine match — so "same topic, different day/event" starts a fresh cluster.
  const eligible = candidates.filter((c) =>
    clusterAcceptsArticle({ firstSeenAt: c.firstSeenAt, lastUpdatedAt: c.lastUpdatedAt }, articleCreatedMs, now),
  );

  const eligibleMapped = eligible.map((c) => ({ id: c._id, centroid: c.centroid }));
  // Best candidate REGARDLESS of threshold (threshold -1 accepts any cosine), so
  // we can record near-misses for live threshold calibration.
  const best = assignToCluster(embedding, eligibleMapped, -1);
  const match = best && best.similarity >= SIMILARITY_THRESHOLD ? best : null;

  console.log(
    `[cluster] assign file=${file._id} feed=${feedId} cat=${category} candidates=${candidates.length} eligible=${eligible.length} ` +
      `bestSim=${best ? best.similarity.toFixed(3) : 'n/a'} threshold=${SIMILARITY_THRESHOLD} ` +
      `match=${match ? `${match.clusterId}@${match.similarity.toFixed(3)}` : 'none'}`,
  );

  // ── Threshold calibration signal ──────────────────────────────────────────
  // Two channels (see server/news/perf.ts for why): a queryable perf sample
  // (`ugly-app perf` in the Node/dev runtime) split by merge decision, plus a
  // greppable `[cluster-sim]` console line that also works in the Workers bundle
  // (wrangler tail / Logpush). Aggregate sim1000 by matched → tune the threshold:
  // if the matched=false tail bunches just below `threshold`, lower it.
  if (best) {
    recordPerfSample(match ? 'cluster.simMatched' : 'cluster.simNearMiss', Math.round(best.similarity * 1000));
    console.log(
      `[cluster-sim] sim1000=${Math.round(best.similarity * 1000)} matched=${match !== null} ` +
        `threshold=${SIMILARITY_THRESHOLD} cat=${category} feed=${feedId} nearest=${best.clusterId}`,
    );
    if (!match) {
      console.log(
        `[cluster-nearmiss] file=${file._id} cat=${category} bestSim=${best.similarity.toFixed(3)} ` +
          `threshold=${SIMILARITY_THRESHOLD} nearest=${best.clusterId} — started a NEW cluster (would merge if threshold ≤ ${best.similarity.toFixed(2)})`,
      );
    }
  }

  const sourceId = feedIdToSourceId[feedId];

  if (match) {
    const cluster = candidates.find((c) => c._id === match.clusterId);
    if (cluster) {
      const memberCount = cluster.fileIds.length;
      const centroid = updateCentroid(cluster.centroid, memberCount, embedding);
      const fileIds = [...cluster.fileIds, file._id];
      const feedIds = [...cluster.feedIds, feedId];
      const sourceIds =
        sourceId && !cluster.sourceIds.includes(sourceId)
          ? [...cluster.sourceIds, sourceId]
          : cluster.sourceIds;
      const agg = recomputeAggregates(feedIds, now, cluster.firstSeenAt, 0);
      const updated: NewsCluster & { _id: string } = {
        ...cluster,
        centroid,
        fileIds,
        feedIds,
        sourceIds,
        articleCount: fileIds.length,
        topImageUri: cluster.topImageUri ?? file.thumbnail?.uri ?? null,
        ...agg,
        lastUpdatedAt: now,
        ...dbDefaults(),
        created: cluster.created,
      };
      await db.setDoc(collections.newsCluster, updated);
      await markFileCluster(db, file, cluster._id);
      console.log(
        `[cluster] joined ${cluster._id} now articles=${fileIds.length} ` +
          `bias(L/C/R)=${agg.biasBreakdown.left}/${agg.biasBreakdown.center}/${agg.biasBreakdown.right} ` +
          `blindspot=${agg.blindspotSide ?? 'none'} score=${agg.score.toFixed(2)}`,
      );

      // Trigger synthesis / satire FROM THE ARTICLE FLOW (the queue processes
      // reliably) rather than the standalone clusterSweep cron, which wasn't
      // firing in prod. Gated to the crossing transition so each fires once.
      const grewToMultiSide = distinctBuckets(agg.biasBreakdown) >= 2 && distinctBuckets(cluster.biasBreakdown) < 2;
      if (grewToMultiSide && !cluster.neutralSummary) {
        await enqueueTask('clusterSynthesize', { clusterId: cluster._id });
        console.log(`[cluster] → enqueued clusterSynthesize for ${cluster._id} (now spans ≥2 sides)`);
      }
      if (fileIds.length === SATIRE_MIN_ARTICLES && !cluster.uglyTakeFileId) {
        await enqueueTask('clusterSatirize', { clusterId: cluster._id });
        console.log(`[cluster] → enqueued clusterSatirize for ${cluster._id} (reached ${SATIRE_MIN_ARTICLES} articles)`);
      }
      return cluster._id;
    }
    console.warn(`[cluster] matched ${match.clusterId} but candidate not found — creating new cluster instead`);
  }

  // No match → start a new single-member cluster.
  const _id = `clus_${file._id}`;
  const feedIds = [feedId];
  const sourceIds = sourceId ? [sourceId] : [];
  const agg = recomputeAggregates(feedIds, now, now, 0);
  const cluster: NewsCluster & { _id: string } = {
    _id,
    title: file.title ?? 'Untitled',
    category,
    centroid: [...embedding],
    fileIds: [file._id],
    feedIds,
    sourceIds,
    articleCount: 1,
    ...agg,
    neutralSummary: null,
    framingSummary: null,
    uglyTakeFileId: null,
    topImageUri: file.thumbnail?.uri ?? null,
    synthesizedAt: null,
    satirizedAt: null,
    firstSeenAt: now,
    lastUpdatedAt: now,
    ...dbDefaults(),
  };
  await db.setDoc(collections.newsCluster, cluster);
  await markFileCluster(db, file, _id);
  console.log(`[cluster] created ${_id} from file=${file._id} feed=${feedId} cat=${category} source=${sourceId ?? 'unrated'}`);
  return _id;
}

/** Stamp the file with its cluster id (best-effort update of the stored doc). */
async function markFileCluster(
  db: NewsDb,
  file: FileMarkdown & { _id: string },
  clusterId: string,
): Promise<void> {
  const fresh = await db.getDoc(collections.file, file._id);
  if (!fresh) {
    console.warn(`[cluster] markFileCluster: file ${file._id} vanished before clusterId stamp (cluster=${clusterId})`);
    return;
  }
  await db.setDoc(collections.file, {
    ...(fresh as FileMarkdown & { _id: string }),
    clusterId,
    ...dbDefaults(),
    created: (fresh as { created?: Date }).created ?? new Date(),
  });
}
