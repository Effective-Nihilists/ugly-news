import { dbDefaults } from 'ugly-app/shared';
import type { DBObject, TypedDB } from 'ugly-app/shared';
import { collections } from '../../shared/collections';

type Db = TypedDB<Record<string, DBObject>>;

export interface EmailPrefView {
  emailAllowed: boolean;
  timezone: string;
  lang: string;
}

const DEFAULT_PREF: EmailPrefView = {
  emailAllowed: false,
  timezone: 'UTC',
  lang: 'en',
};

/** Current daily-email preference for the signed-in user (defaults if unset). */
export async function newsEmailPrefGet(db: Db, userId: string): Promise<EmailPrefView> {
  const pref = await db.getDoc(collections.userNewsEmailPref, userId);
  if (!pref) return { ...DEFAULT_PREF };
  return {
    emailAllowed: pref.emailAllowed,
    timezone: pref.timezone,
    lang: pref.lang ?? 'en',
  };
}

/**
 * Subscribe / unsubscribe + store the user's IANA timezone so the hourly
 * `userEmailHourly` cron can fan the 8am-local edition out to them.
 * `_id = userId` — the email dispatcher and cron both key off that.
 */
export async function newsEmailPrefSet(
  db: Db,
  userId: string,
  input: { emailAllowed: boolean; timezone: string; lang?: string | undefined },
): Promise<EmailPrefView> {
  const lang = input.lang ?? 'en';
  await db.setDoc(collections.userNewsEmailPref, {
    _id: userId,
    userId,
    timezone: input.timezone,
    emailAllowed: input.emailAllowed,
    lang,
    ...dbDefaults(),
  });
  return { emailAllowed: input.emailAllowed, timezone: input.timezone, lang };
}
