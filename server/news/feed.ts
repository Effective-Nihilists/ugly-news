import type { DBObject, TypedDB } from 'ugly-app/shared';
import { dbDefaults } from 'ugly-app/shared';
import { getAdapter } from 'ugly-app/server/adapter/workers';
import { collections } from '../../shared/collections';
import type {
  FileMarkdown,
  UserNewsReaction,
  UserNewsSaved,
} from '../../shared/collections';
import { isDefined, uglyBotId } from '../../shared/news/Bot';
import { rankAndDiversifyArticles } from '../../shared/news/ranking';
import type { InterestCluster } from '../../shared/news/schemas';
import type {
  NewsFeedGetInput,
  NewsFeedGetOutput,
  NewsFeedItem,
  NewsIsSavedBatchInput,
  NewsIsSavedBatchOutput,
  NewsIsSavedInput,
  NewsIsSavedOutput,
  NewsMarkReadBulkInput,
  NewsMarkReadInput,
  NewsMarkUnreadInput,
  NewsReactInput,
  NewsReactOutput,
  NewsReadGetAllOutput,
  NewsReadResetAllOutput,
  NewsSaveInput,
  NewsSavedGetInput,
  NewsSavedGetOutput,
  NewsSearchInput,
  NewsSearchOutput,
  NewsSourceFollowInput,
  NewsSourceFollowOutput,
  NewsSourceGetFollowedInput,
  NewsSourceGetFollowedOutput,
} from '../../shared/news/types';
import { newsFeeds } from '../../shared/news/types';

type Db = TypedDB<Record<string, DBObject>>;
type Empty = Record<string, never>;

const CANDIDATE_POOL_SIZE = 500;

// ─── Read tracking ──────────────────────────────────────────────────────────

export async function newsMarkRead(
  db: Db,
  userId: string,
  input: NewsMarkReadInput,
): Promise<Empty> {
  await db.setDoc(collections.userNewsRead, {
    _id: `${userId}_${input.fileId}`,
    userId,
    fileId: input.fileId,
    readAt: Date.now(),
    ...dbDefaults(),
  });
  return {};
}

export async function newsMarkReadBulk(
  db: Db,
  userId: string,
  input: NewsMarkReadBulkInput,
): Promise<Empty> {
  await Promise.all(
    input.fileIds.map((fileId) =>
      db.setDoc(collections.userNewsRead, {
        _id: `${userId}_${fileId}`,
        userId,
        fileId,
        readAt: Date.now(),
        ...dbDefaults(),
      }),
    ),
  );
  return {};
}

export async function newsMarkUnread(
  db: Db,
  userId: string,
  input: NewsMarkUnreadInput,
): Promise<Empty> {
  await db.deleteDoc(collections.userNewsRead, `${userId}_${input.fileId}`);
  return {};
}

export async function newsReadGetAll(
  db: Db,
  userId: string,
): Promise<NewsReadGetAllOutput> {
  const readDocs = await db.getQuery<{ fileId: string }>('userNewsRead', [
    { $match: { userId } },
  ]);
  return { fileIds: readDocs.map((r) => r.fileId) };
}

export async function newsReadResetAll(
  db: Db,
  userId: string,
): Promise<NewsReadResetAllOutput> {
  const readDocs = await db.getQuery<{ _id: string }>('userNewsRead', [
    { $match: { userId } },
  ]);
  await Promise.all(
    readDocs.map((doc) => db.deleteDoc(collections.userNewsRead, doc._id)),
  );
  return { deletedCount: readDocs.length };
}

// ─── Save / bookmark ──────────────────────────────────────────────────────

export async function newsSave(
  db: Db,
  userId: string,
  input: NewsSaveInput,
): Promise<Empty> {
  const _id = `${userId}_${input.fileId}`;
  if (input.saved) {
    await db.setDoc(collections.userNewsSaved, {
      _id,
      userId,
      fileId: input.fileId,
      savedAt: Date.now(),
      ...dbDefaults(),
    });
  } else {
    await db.deleteDoc(collections.userNewsSaved, _id);
  }
  return {};
}

export async function newsSavedGet(
  db: Db,
  userId: string,
  input: NewsSavedGetInput,
): Promise<NewsSavedGetOutput> {
  const match: Record<string, unknown> = { userId };
  if (isDefined(input.beforeSavedAt)) {
    match['savedAt'] = { $lt: input.beforeSavedAt };
  }
  const saved = await db.getQuery<UserNewsSaved>(
    'userNewsSaved',
    [{ $match: match }, { $sort: { savedAt: -1 } }],
    { limit: input.limit + 1 },
  );
  const hasMore = saved.length > input.limit;
  const items = saved.slice(0, input.limit).map((s) => s.fileId);
  return { items, hasMore };
}

export async function newsIsSaved(
  db: Db,
  userId: string,
  input: NewsIsSavedInput,
): Promise<NewsIsSavedOutput> {
  const saved = await db.getDoc(
    collections.userNewsSaved,
    `${userId}_${input.fileId}`,
  );
  return { saved: isDefined(saved) };
}

export async function newsIsSavedBatch(
  db: Db,
  userId: string,
  input: NewsIsSavedBatchInput,
): Promise<NewsIsSavedBatchOutput> {
  const ids = input.fileIds.map((fileId) => `${userId}_${fileId}`);
  const saved = await db.getQuery<UserNewsSaved>('userNewsSaved', [
    { $match: { _id: { $in: ids } } },
  ]);
  return { savedFileIds: saved.map((s) => s.fileId) };
}

// ─── Feed (personalized ranking) ─────────────────────────────────────────

export async function newsFeedGet(
  db: Db,
  userId: string,
  input: NewsFeedGetInput,
): Promise<NewsFeedGetOutput> {
  const botIds = [uglyBotId];
  const now = Date.now();

  interface CandidateFile {
    _id: string;
    embedding: number[];
    created: number;
  }

  const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
  // Embeddings live in the pgvector `embedding` COLUMN (the framework strips the
  // blob copy), so read it via raw SQL — getQuery only sees the JSON `data`.
  // `created` is the table column (timestamptz), surfaced as epoch-ms.
  const [userPreference, candidateRows] = await Promise.all([
    db.getDoc(collections.userFilePreference, userId),
    getAdapter().db.query<{ _id: string; embedding: string; created: string }>(
      `SELECT _id,
              embedding::text AS embedding,
              (extract(epoch from created) * 1000)::bigint AS created
         FROM "file"
        WHERE data->>'public' = 'true'
          AND data->>'userId' = ANY($1)
          AND embedding IS NOT NULL
          AND created >= to_timestamp($2 / 1000.0)
        ORDER BY created DESC
        LIMIT $3`,
      [botIds, twoWeeksAgo, CANDIDATE_POOL_SIZE * 2],
    ),
  ]);
  const recentPool: CandidateFile[] = candidateRows.map((r) => ({
    _id: r._id,
    embedding: JSON.parse(r.embedding) as number[],
    created: Number(r.created),
  }));

  // Shuffle and take CANDIDATE_POOL_SIZE for random diversity
  for (let i = recentPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [recentPool[i]!, recentPool[j]!] = [recentPool[j]!, recentPool[i]!];
  }
  const recentCandidates = recentPool.slice(0, CANDIDATE_POOL_SIZE);
  const clusters: InterestCluster[] = userPreference?.clusters ?? [];

  // Batch-check which candidates have been read (indexed _id lookup)
  const readCheckIds = recentCandidates.map((c) => `${userId}_${c._id}`);
  const readDocs =
    readCheckIds.length > 0
      ? await db.getQuery<{ _id: string }>('userNewsRead', [
          { $match: { _id: { $in: readCheckIds } } },
        ])
      : [];

  const readIdSet = new Set(readDocs.map((r) => r._id));
  const candidates = recentCandidates
    .filter((c) => !readIdSet.has(`${userId}_${c._id}`))
    .slice(0, CANDIDATE_POOL_SIZE)
    .map((c) => ({ id: c._id, embedding: c.embedding, created: c.created }));

  const rankedCandidates = rankAndDiversifyArticles(
    candidates,
    clusters,
    input.limit + 1,
    now,
  );

  const topCandidateIds = rankedCandidates.map((c) => c.id);
  if (topCandidateIds.length === 0) {
    return { items: [], hasMore: false };
  }

  const savedIds = topCandidateIds.map((id) => `${userId}_${id}`);
  const [files, savedDocs, reactionDocs] = await Promise.all([
    db.getQuery<FileMarkdown & { _id: string }>('file', [
      { $match: { _id: { $in: topCandidateIds } } },
    ]),
    db.getQuery<UserNewsSaved>('userNewsSaved', [
      { $match: { _id: { $in: savedIds } } },
    ]),
    db.getQuery<UserNewsReaction>('userNewsReaction', [
      { $match: { _id: { $in: savedIds } } },
    ]),
  ]);

  const savedSet = new Set(savedDocs.map((s) => s.fileId));
  const reactionMap = new Map(reactionDocs.map((r) => [r.articleId, r.reaction]));
  const fileMap = new Map<string, FileMarkdown & { _id: string }>();
  for (const file of files) fileMap.set(file._id, file);

  const hasMore = topCandidateIds.length > input.limit;
  const resultIds = topCandidateIds.slice(0, input.limit);

  const items: NewsFeedItem[] = [];
  for (const id of resultIds) {
    const file = fileMap.get(id);
    if (file) {
      items.push({
        file,
        saved: savedSet.has(id),
        reaction: reactionMap.get(id) ?? null,
      });
    }
  }
  return { items, hasMore };
}

// ─── Search ────────────────────────────────────────────────────────────────

export async function newsSearch(
  db: Db,
  input: NewsSearchInput,
): Promise<NewsSearchOutput> {
  const botIds = [uglyBotId];
  const match: Record<string, unknown> = { public: true, userId: { $in: botIds } };
  if (isDefined(input.categories) && input.categories.length > 0) {
    match['tags'] = { $in: input.categories };
  }
  const searchRegex = { $regex: input.query, $options: 'i' };
  match['$or'] = [{ title: searchRegex }, { text: searchRegex }];

  const files = await db.getQuery<{ _id: string }>(
    'file',
    [{ $match: match }, { $sort: { created: -1 } }],
    { limit: input.limit },
  );
  return { items: files.map((f) => f._id) };
}

// ─── Reactions ──────────────────────────────────────────────────────────────

export async function newsReact(
  db: Db,
  userId: string,
  input: NewsReactInput,
): Promise<NewsReactOutput> {
  const _id = `${userId}_${input.articleId}`;
  if (input.reaction === null) {
    await db.deleteDoc(collections.userNewsReaction, _id);
    return { reaction: null };
  }
  const reaction: UserNewsReaction & { _id: string } = {
    _id,
    userId,
    articleId: input.articleId,
    reaction: input.reaction,
    reactedAt: Date.now(),
    ...dbDefaults(),
  };
  await db.setDoc(collections.userNewsReaction, reaction);
  return { reaction };
}

// ─── Source following ────────────────────────────────────────────────────

export async function newsSourceFollow(
  db: Db,
  userId: string,
  input: NewsSourceFollowInput,
): Promise<NewsSourceFollowOutput> {
  const _id = `${userId}_${input.sourceId}`;
  if (input.follow) {
    await db.setDoc(collections.userNewsSourceFollow, {
      _id,
      userId,
      sourceId: input.sourceId,
      followedAt: Date.now(),
      ...dbDefaults(),
    });
  } else {
    await db.deleteDoc(collections.userNewsSourceFollow, _id);
  }
  return { followed: input.follow };
}

export async function newsSourceGetFollowed(
  db: Db,
  userId: string,
  _input: NewsSourceGetFollowedInput,
): Promise<NewsSourceGetFollowedOutput> {
  const follows = await db.getQuery<{ sourceId: string }>(
    'userNewsSourceFollow',
    [{ $match: { userId } }],
  );
  const sources = follows
    .map((follow) => {
      const feed = newsFeeds.find((f) => f.id === follow.sourceId);
      return feed
        ? { sourceId: feed.id, category: feed.category, name: feed.name }
        : null;
    })
    .filter(isDefined);
  return { sources };
}

// ─── Reset ───────────────────────────────────────────────────────────────

export async function newsReset(db: Db, userId: string): Promise<Empty> {
  for (const name of [
    'userNewsRead',
    'userNewsSaved',
    'userNewsReaction',
    'userNewsSourceFollow',
  ] as const) {
    const docs = await db.getQuery<{ _id: string }>(name, [
      { $match: { userId } },
    ]);
    await Promise.all(docs.map((d) => db.deleteDoc(collections[name], d._id)));
  }
  await db.deleteDoc(collections.userFilePreference, userId);
  await db.deleteDoc(collections.userNewsPreference, userId);
  return {};
}
