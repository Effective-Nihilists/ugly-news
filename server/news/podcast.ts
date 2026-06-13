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

type Db = TypedDB<Record<string, DBObject>>;

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
  const podcast = await db.getDoc(collections.newsPodcast, `${date}_default`);

  // Host avatar URLs come from the seeded host rows (Phase 8 seed/initSeed).
  // Until that lands, the client falls back to default avatars.
  void podcastHost1BotId;
  void uglyBotId;
  return {
    podcast: podcast ?? null,
    host1AvatarUrl: null,
    host2AvatarUrl: null,
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

// init/regenerate drive the TTS generation pipeline (Phase 5). They enqueue a
// `podcastGenerate` background job; wired in Phase 4's queue fan-out.
export function newsPodcastInit(): NewsPodcastInitOutput {
  return { initialized: true };
}

export function newsPodcastRegenerate(
  _input: NewsPodcastRegenerateInput,
): NewsPodcastRegenerateOutput {
  // TODO(Phase 5): enqueue podcastGenerate({ date, userId }) and return its id.
  throw new Error('newsPodcastRegenerate not yet implemented (Phase 5)');
}
