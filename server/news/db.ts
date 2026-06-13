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
