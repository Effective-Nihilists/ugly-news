import type { DBObject, TypedDB } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { NewsPodcast } from '../../shared/collections';
import { podcastHost1BotId } from '../../shared/news/NewsPodcast';
import type {
  NewsPodcastGetDefaultInput,
  NewsPodcastGetDefaultOutput,
  NewsPodcastGetInput,
  NewsPodcastGetOutput,
  NewsPodcastInitOutput,
  NewsPodcastListInput,
  NewsPodcastListOutput,
  NewsPodcastRegenerateInput,
  NewsPodcastRegenerateOutput,
} from '../../shared/news/NewsPodcast';
import { uglyBotId } from '../../shared/news/Bot';
import { enqueueTask } from './queue';

type Db = TypedDB<Record<string, DBObject>>;

// Fixed host avatar GLB models (full-body, ARKit blendshapes + skeleton) the
// client podcast stage loads + animates. Hosts are a fixed cast (podcastHost1 +
// uglyBot). Re-hosted in this app's own R2 bucket and served same-origin via
// the worker's /public route — blob.ugly.bot has no CORS (403s cross-origin),
// which would break the browser GLTFLoader fetch.
const HOST1_AVATAR_GLB = '/public/avatars/host1.glb';
const HOST2_AVATAR_GLB = '/public/avatars/host2.glb';

/** Today's date string in UTC (YYYY-MM-DD) — the default-podcast key. */
export function todayDateString(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function newsPodcastGet(
  db: Db,
  input: NewsPodcastGetInput,
): Promise<NewsPodcastGetOutput> {
  if (input.podcastId) {
    const podcast = await db.getDoc(collections.newsPodcast, input.podcastId);
    return { podcast: podcast ?? null };
  }
  const date = input.date ?? todayDateString(Date.now());
  const podcast = await db.getDoc(collections.newsPodcast, `${date}_default`);
  return { podcast: podcast ?? null };
}

export async function newsPodcastGetDefault(
  db: Db,
  input: NewsPodcastGetDefaultInput,
): Promise<NewsPodcastGetDefaultOutput> {
  const date = input.date ?? todayDateString(Date.now());
  const today = await db.getDoc(collections.newsPodcast, `${date}_default`);

  // The daily cron generates today's episode at 10:00 UTC, so there's a window
  // each morning (00:00–10:00 UTC) where the current UTC day's episode doesn't
  // exist yet — and for non-UTC users that lands in their evening. Rather than
  // show an empty "not recorded yet" state, fall back to the most recent
  // complete episode so there's always something to play.
  let podcast = today;
  if (!podcast || podcast.generationStatus !== 'complete') {
    // Only default (public) episodes exist, so an empty match + newest-first is
    // the proven query shape — matching null JSONB fields (e.g. `userId: null`)
    // in $match is unreliable in the framework's filter layer. Filter to the
    // latest *complete* episode in code, skipping today's still-generating/
    // failed doc.
    const recent = await db.getQuery<NewsPodcast & { _id: string }>(
      'newsPodcast',
      [{ $match: {} }, { $sort: { date: -1 } }],
      { limit: 10 },
    );
    const latestComplete = recent.find((p) => p.generationStatus === 'complete' && !!p.audioUri);
    if (latestComplete) podcast = latestComplete;
  }

  void podcastHost1BotId;
  void uglyBotId;
  return {
    podcast: podcast ?? null,
    host1AvatarUrl: HOST1_AVATAR_GLB,
    host2AvatarUrl: HOST2_AVATAR_GLB,
  };
}

export async function newsPodcastList(
  db: Db,
  input: NewsPodcastListInput,
): Promise<NewsPodcastListOutput> {
  const match: Record<string, unknown> = {};
  if (input.beforeDate) match['date'] = { $lt: input.beforeDate };
  const podcasts = await db.getQuery<NewsPodcast & { _id: string }>(
    'newsPodcast',
    [{ $match: match }, { $sort: { date: -1 } }],
    { limit: input.limit + 1 },
  );
  const hasMore = podcasts.length > input.limit;
  return { items: podcasts.slice(0, input.limit), hasMore };
}

export function newsPodcastInit(): NewsPodcastInitOutput {
  return { initialized: true };
}

/** Enqueue a (re)generation of a user's podcast for a date. */
export async function newsPodcastRegenerate(
  userId: string,
  input: NewsPodcastRegenerateInput,
): Promise<NewsPodcastRegenerateOutput> {
  const date = input.date ?? todayDateString(Date.now());
  const replaceDefault = input.replaceDefault ?? false;
  const targetUserId = replaceDefault ? null : userId;
  const podcastId = targetUserId ? `${date}_${targetUserId}` : `${date}_default`;
  await enqueueTask('podcastGenerate', { date, userId: targetUserId, replaceDefault });
  return { success: true, podcastId };
}
