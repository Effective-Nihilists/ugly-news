import { emailSend } from 'ugly-app/server/adapter/workers';
import { collections } from '../../shared/collections';
import type { FileMarkdown } from '../../shared/collections';
import { uglyBotId } from '../../shared/news/Bot';
import { rankAndDiversifyArticles } from '../../shared/news/ranking';
import type { InterestCluster } from '../../shared/news/schemas';
import { getTimezonesAtLocalHour, type Timezone } from '../../shared/news/Timezone';
import { newsPodcastGet, todayDateString } from './podcast';
import { enqueueTask } from './queue';
import type { NewsDb } from './db';

const ONE_DAY = 24 * 60 * 60 * 1000;

function envVar(name: string): string {
  return process.env[name] ?? '';
}

const PUBLIC_URL = (envVar('PUBLIC_URL') || 'https://ugly.press').replace(/\/$/, '');

/**
 * Resolve a ugly.bot userId → email via ugly.bot's `/v1/users/email` proxy.
 * The centralized userId→email email proxy was removed, so apps resolve the
 * recipient here and then send by `to` address via Cloudflare Email Sending.
 * Auth uses any non-revoked app token (Mode A mints no owner AI token, so
 * AI_PROXY_TOKEN may be empty — prefer the email/search token).
 */
export async function resolveUserEmail(userId: string): Promise<string | null> {
  const base = (envVar('AI_PROXY_URL') || 'https://ugly.bot/v1/ai').replace(/\/ai\/?$/, '');
  const token =
    envVar('EMAIL_PROXY_TOKEN') || envVar('SEARCH_PROXY_TOKEN') || envVar('AI_PROXY_TOKEN');
  const res = await fetch(`${base}/users/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    console.error(`[news] resolveUserEmail HTTP ${res.status} for ${userId}`);
    return null;
  }
  const data = (await res.json()) as { email?: string | null };
  return data.email ?? null;
}

export interface NewsEmailArticle {
  fileId: string;
  title: string;
  summary: string;
  thumbnailUri: string | null;
  uri: string;
  engagementCount: number;
}

function fileToEmailArticle(file: FileMarkdown & { _id: string }): NewsEmailArticle {
  return {
    fileId: file._id,
    title: file.title ?? '',
    summary: (file.text ?? '').slice(0, 200),
    thumbnailUri: file.thumbnail?.uri ?? null,
    uri: `${PUBLIC_URL}/article/${encodeURIComponent(file._id)}`,
    engagementCount: (file.likeCount ?? 0) + (file.dislikeCount ?? 0),
  };
}

interface SelectedArticles {
  hero: NewsEmailArticle | null;
  trending: NewsEmailArticle[];
  pickedForYou: NewsEmailArticle[];
  categorySpotlight: NewsEmailArticle[];
  totalUnread: number;
  topCategory: string;
}

export async function selectDailyEmailArticles(
  db: NewsDb,
  userId: string,
  now: number,
): Promise<SelectedArticles> {
  const twoDays = 2 * ONE_DAY;
  const userPreference = await db.getDoc(collections.userFilePreference, userId);
  const clusters: InterestCluster[] = userPreference?.clusters ?? [];

  const allRecent = await db.getDocs(collections.file, {
    public: true,
    userId: uglyBotId,
    created: { $gt: new Date(now - twoDays) },
    embedding: { $exists: true, $ne: null },
  });
  const files = [...allRecent].sort(() => Math.random() - 0.5).slice(0, 200) as (FileMarkdown & {
    _id: string;
  })[];
  if (files.length === 0) {
    return { hero: null, trending: [], pickedForYou: [], categorySpotlight: [], totalUnread: 0, topCategory: 'News' };
  }

  const candidates = files.map((f) => ({
    id: f._id,
    embedding: f.embedding ?? [],
    created: f.created instanceof Date ? f.created.getTime() : (f.created as unknown as number),
  }));
  const ranked = rankAndDiversifyArticles(candidates, clusters, 10, now);
  const fileMap = new Map(files.map((f) => [f._id, f]));
  const rankedFiles = ranked.map((r) => fileMap.get(r.id)).filter((f): f is (FileMarkdown & { _id: string }) => !!f);

  const byEngagement = [...files].sort(
    (a, b) => (b.likeCount ?? 0) + (b.dislikeCount ?? 0) - ((a.likeCount ?? 0) + (a.dislikeCount ?? 0)),
  );
  const hero = rankedFiles.length > 0 ? fileToEmailArticle(rankedFiles[0]!) : null;
  const trendingIds = new Set(byEngagement.slice(0, 3).map((f) => f._id));
  const trending = byEngagement.slice(0, 3).map(fileToEmailArticle);
  const pickedForYou = rankedFiles
    .filter((f) => f._id !== rankedFiles[0]?._id && !trendingIds.has(f._id))
    .slice(0, 3)
    .map(fileToEmailArticle);
  const topCategory = files.find((f) => f.tags && f.tags.length > 0)?.tags?.[0] ?? 'News';
  const categorySpotlight = files.filter((f) => f.tags?.includes(topCategory)).slice(0, 1).map(fileToEmailArticle);

  return {
    hero,
    trending,
    pickedForYou,
    categorySpotlight,
    totalUnread: files.length,
    topCategory: topCategory.charAt(0).toUpperCase() + topCategory.slice(1),
  };
}

interface Strings {
  greeting: string;
  trendingTitle: string;
  trendingSubtitle: string;
  pickedTitle: string;
  pickedSubtitle: string;
  categoryPrefix: string;
  seeAll: string;
  buttonText: string;
}

function card(a: NewsEmailArticle): string {
  const img = a.thumbnailUri
    ? `<img src="${a.thumbnailUri}" alt="" width="100%" style="border-radius:8px;max-height:200px;object-fit:cover"/>`
    : '';
  return `<div style="margin:0 0 20px;padding:16px;background:#fff;border:1px solid #eee;border-radius:10px">
    ${img}
    <h3 style="margin:12px 0 6px;font-size:18px;color:#111"><a href="${a.uri}" style="color:#111;text-decoration:none">${a.title}</a></h3>
    <p style="margin:0;color:#555;font-size:14px;line-height:1.5">${a.summary}</p>
  </div>`;
}

function section(title: string, subtitle: string, items: NewsEmailArticle[]): string {
  if (items.length === 0) return '';
  return `<h2 style="margin:28px 0 4px;font-size:20px;color:#111">${title}</h2>
    <p style="margin:0 0 12px;color:#888;font-size:13px">${subtitle}</p>
    ${items.map(card).join('')}`;
}

export function renderDailyNewsEmail(
  s: Strings,
  date: string,
  articles: SelectedArticles,
  podcast: { title: string; duration: string; uri: string; imageUri?: string | undefined } | null,
): string {
  const podcastBlock = podcast
    ? `<div style="margin:0 0 24px;padding:16px;background:#111;border-radius:10px;color:#fff">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#bbb">🎙 Daily Podcast · ${podcast.duration}</div>
        <h3 style="margin:8px 0 10px;font-size:18px"><a href="${podcast.uri}" style="color:#fff;text-decoration:none">${podcast.title}</a></h3>
        <a href="${podcast.uri}" style="display:inline-block;padding:8px 16px;background:#fff;color:#111;border-radius:6px;text-decoration:none;font-weight:600">▶ Listen</a>
      </div>`
    : '';
  const hero = articles.hero ? `<h2 style="margin:8px 0 12px;font-size:22px;color:#111">Top Story</h2>${card(articles.hero)}` : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
    <div style="max-width:600px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:26px;font-weight:800;color:#111">${s.greeting}</div>
        <div style="color:#888;font-size:13px">${date}</div>
      </div>
      ${podcastBlock}
      ${hero}
      ${section(s.trendingTitle, s.trendingSubtitle, articles.trending)}
      ${section(s.pickedTitle, s.pickedSubtitle, articles.pickedForYou)}
      ${section(s.categoryPrefix.replace('%s', articles.topCategory), '', articles.categorySpotlight)}
      <div style="text-align:center;margin:28px 0">
        <a href="${PUBLIC_URL}/news" style="display:inline-block;padding:14px 28px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">${s.buttonText}</a>
        <p style="margin:12px 0 0;color:#aaa;font-size:12px">${s.seeAll.replace('%d', String(articles.totalUnread))}</p>
      </div>
    </div></body></html>`;
}

const DEFAULT_STRINGS: Strings = {
  greeting: 'Your Daily Ugly News',
  trendingTitle: 'Trending Now',
  trendingSubtitle: 'What everyone is talking about',
  pickedTitle: 'Picked For You',
  pickedSubtitle: 'Based on your interests',
  categoryPrefix: 'Today in %s',
  seeAll: 'See all %d stories from today',
  buttonText: 'Open Ugly News',
};

/** Render + send one user's daily news email. */
export async function dispatchUserPrivateNewsEmail(
  db: NewsDb,
  input: { userId: string; now: number },
): Promise<void> {
  const pref = await db.getDoc(collections.userNewsEmailPref, input.userId);
  if (!pref || !pref.emailAllowed) return;

  const articles = await selectDailyEmailArticles(db, input.userId, input.now);
  if (!articles.hero) return;

  const today = new Date(input.now);
  const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Attach today's default podcast if complete.
  const { podcast } = await newsPodcastGet(db, { date: todayDateString(input.now) });
  const podcastData =
    podcast && podcast.generationStatus === 'complete'
      ? {
          title: podcast.title,
          duration: `${Math.round(podcast.durationMs / 60000)} min`,
          uri: `${PUBLIC_URL}/podcast`,
          imageUri: podcast.articles[0]?.imageUri ?? undefined,
        }
      : null;

  const to = await resolveUserEmail(input.userId);
  if (!to) {
    console.warn(`[news] daily email skipped — no email for ${input.userId}`);
    return;
  }

  const html = renderDailyNewsEmail(DEFAULT_STRINGS, dateStr, articles, podcastData);
  const subject = `${articles.hero.title.slice(0, 50)}... + ${articles.totalUnread - 1} more`;
  await emailSend({ to, subject, html, id: 'dailyNews' });
}

/** Hourly: enqueue the daily email for every opted-in user whose local time is 8am. */
export async function userEmailHourly(db: NewsDb, now: number): Promise<void> {
  const eightAm = getTimezonesAtLocalHour(now, 8) as Timezone[];
  if (eightAm.length === 0) return;
  const prefs = await db.getDocs(collections.userNewsEmailPref, {
    timezone: { $in: eightAm },
    emailAllowed: true,
  });
  await Promise.all(
    prefs.map((p) => enqueueTask('userPrivateNewsEmail', { userId: p.userId, now })),
  );
}
