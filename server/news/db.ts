import type { DBObject, TypedDB } from 'ugly-app/shared';

// A loosely-typed handle to the app database for the news modules. Using this
// (instead of `app.db` directly inside the createApp() handler literal) avoids
// a TypeScript self-reference cycle in `const app = createApp(...)`.
export type NewsDb = TypedDB<Record<string, DBObject>>;

let _db: NewsDb | null = null;

export function setNewsDb(db: NewsDb): void {
  _db = db;
}

export function newsDb(): NewsDb {
  if (!_db) throw new Error('[news] db accessed before setOnAfterStart');
  return _db;
}

// Route-checked push injection. The blessed `app.pushSend({ page, query })`
// lives on the app instance, which the news modules can't reach directly (same
// self-reference cycle as the db above), so both entries inject a bound
// `app.pushSend` here and callers use newsPush() at send time.
export type NewsPush = (input: {
  targetUserId: string;
  title: string;
  body: string;
  page: string;
  query?: Record<string, string>;
  imageUrl?: string;
}) => Promise<{ sent: boolean }>;

let _push: NewsPush | null = null;

export function setNewsPush(fn: NewsPush): void {
  _push = fn;
}

export function newsPush(): NewsPush {
  if (!_push)
    throw new Error(
      '[news] push accessed before startup — setNewsPush() must run',
    );
  return _push;
}
