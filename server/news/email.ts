import { emailSend, shareLink } from 'ugly-app/server/adapter/workers';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsCluster } from '../../shared/collections';
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

async function fileToEmailArticle(
  file: FileMarkdown & { _id: string },
): Promise<NewsEmailArticle> {
  const title = file.title ?? '';
  const summary = (file.text ?? '').slice(0, 200);
  const thumbnailUri = file.thumbnail?.uri ?? null;
  return {
    fileId: file._id,
    title,
    summary,
    thumbnailUri,
    uri: await shareLink({
      // Prefer the article's cluster ("three ways") page over the standalone
      // article when it belongs to one.
      target: `${PUBLIC_URL}/${file.clusterId ? `story/${encodeURIComponent(file.clusterId)}` : `article/${encodeURIComponent(file._id)}`}`,
      og: {
        title,
        description: summary,
        ...(thumbnailUri ? { image: thumbnailUri } : {}),
      },
    }),
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
  const trendingIds = new Set(byEngagement.slice(0, 3).map((f) => f._id));
  const topCategory = files.find((f) => f.tags && f.tags.length > 0)?.tags?.[0] ?? 'News';
  const [hero, trending, pickedForYou, categorySpotlight] = await Promise.all([
    rankedFiles.length > 0 ? fileToEmailArticle(rankedFiles[0]!) : Promise.resolve(null),
    Promise.all(byEngagement.slice(0, 3).map(fileToEmailArticle)),
    Promise.all(
      rankedFiles
        .filter((f) => f._id !== rankedFiles[0]?._id && !trendingIds.has(f._id))
        .slice(0, 3)
        .map(fileToEmailArticle),
    ),
    Promise.all(
      files.filter((f) => f.tags?.includes(topCategory)).slice(0, 1).map(fileToEmailArticle),
    ),
  ]);

  return {
    hero,
    trending,
    pickedForYou,
    categorySpotlight,
    totalUnread: files.length,
    topCategory: topCategory.charAt(0).toUpperCase() + topCategory.slice(1),
  };
}

// ─── "Three Ways" cluster selection for the email ──────────────────────────
export interface EmailCluster {
  title: string;
  category: string;
  leftPct: number;
  centerPct: number;
  rightPct: number;
  blindspotSide: string | null;
  sourceCount: number;
  factuality: string;
  uri: string;
}

function factLabel(avg: number | null): string {
  if (avg === null) return '';
  if (avg >= 4.5) return 'Very High';
  if (avg >= 3.5) return 'High';
  if (avg >= 2.5) return 'Mixed';
  if (avg >= 1.5) return 'Low';
  return 'Very Low';
}

async function clusterToEmail(c: NewsCluster & { _id: string }): Promise<EmailCluster> {
  const b = c.biasBreakdown;
  return {
    title: c.title,
    category: c.category,
    leftPct: b.leftPct,
    centerPct: b.centerPct,
    rightPct: b.rightPct,
    blindspotSide: c.blindspotSide,
    sourceCount: c.sourceIds.length,
    factuality: factLabel(c.factualityAvg),
    uri: await shareLink({
      target: `${PUBLIC_URL}/story/${encodeURIComponent(c._id)}`,
      og: { title: c.title, ...(c.topImageUri ? { image: c.topImageUri } : {}) },
    }),
  };
}

/** Top score-ranked multi-source clusters + a couple of blindspots for the email. */
export async function selectEmailClusters(
  db: NewsDb,
  now: number,
): Promise<{ topStories: EmailCluster[]; blindspot: EmailCluster[] }> {
  const recent = await db.getQuery<NewsCluster & { _id: string }>(
    'newsCluster',
    [
      { $match: { lastUpdatedAt: { $gte: now - 2 * ONE_DAY }, articleCount: { $gte: 2 } } },
      { $sort: { score: -1 } },
    ],
    { limit: 30 },
  );
  const topStories = await Promise.all(recent.slice(0, 4).map(clusterToEmail));
  const blindspot = await Promise.all(recent.filter((c) => c.blindspotSide).slice(0, 2).map(clusterToEmail));
  return { topStories, blindspot };
}

// ─── Newsprint palette (email-safe: inline styles, no web fonts) ────────────
const INK = '#1a1714';
const PAPER = '#f1ece0';
const PAPER2 = '#e9e2d2';
const ACCENT = '#d6261d';
const MUTED = '#6f665a';
const LEFT_C = '#2a3b6b';
const CENTER_C = '#9a9082';
const MONO = "'Courier New',Courier,monospace";
const HEAD = "'Arial Black','Arial Narrow',Impact,sans-serif";

interface Strings {
  greeting: string;
  pickedTitle: string;
  pickedSubtitle: string;
  seeAll: string;
  buttonText: string;
}

/** Email-safe L/C/R coverage bar (table cells; degrades in every client). */
function biasBar(c: EmailCluster): string {
  const rated = c.leftPct + c.centerPct + c.rightPct;
  const cell = (w: number, bg: string) =>
    `<td width="${w}%" style="background:${bg};height:14px;font-size:0;line-height:0">&nbsp;</td>`;
  const cells = rated === 0
    ? `<td width="100%" style="background:${CENTER_C};height:14px;font-size:0;line-height:0">&nbsp;</td>`
    : cell(c.leftPct, LEFT_C) + cell(c.centerPct, CENTER_C) + cell(c.rightPct, ACCENT);
  return `<table cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${INK};border-collapse:collapse;table-layout:fixed"><tr>${cells}</tr></table>`;
}

function clusterCard(c: EmailCluster): string {
  const blind = c.blindspotSide
    ? `<span style="border:1px solid ${ACCENT};color:${ACCENT};font-size:10px;padding:2px 6px;text-transform:uppercase;letter-spacing:1px;font-family:${MONO}">${c.blindspotSide === 'right' ? '&#9668;' : '&#9658;'} ${c.blindspotSide} blindspot</span>&nbsp;`
    : '';
  const kicker = `${c.category.toUpperCase()}${c.factuality ? ` &middot; FACTUALITY ${c.factuality.toUpperCase()}` : ''}`;
  return `<div style="margin:0 0 16px;padding:18px;background:${PAPER2};border:2px solid ${INK}">
    <div style="font-family:${MONO};font-size:11px;letter-spacing:2px;color:${MUTED};margin-bottom:6px">${kicker}</div>
    <h3 style="margin:0 0 12px;font-family:Georgia,serif;font-size:20px;line-height:1.15;color:${INK};font-weight:bold"><a href="${c.uri}" style="color:${INK};text-decoration:none">${c.title}</a></h3>
    ${biasBar(c)}
    <div style="font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};margin-top:8px">L ${c.leftPct}% &middot; C ${c.centerPct}% &middot; R ${c.rightPct}% &nbsp;&middot;&nbsp; ${c.sourceCount} sources</div>
    <div style="margin-top:12px">${blind}<a href="${c.uri}" style="color:${ACCENT};font-family:${MONO};font-size:12px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;font-weight:bold">See all sides &rarr;</a></div>
  </div>`;
}

function card(a: NewsEmailArticle): string {
  const img = a.thumbnailUri
    ? `<img src="${a.thumbnailUri}" alt="" width="100%" style="max-height:200px;object-fit:cover;border:1px solid ${INK}"/>`
    : '';
  return `<div style="margin:0 0 16px;padding:16px;background:${PAPER2};border:2px solid ${INK}">
    ${img}
    <h3 style="margin:12px 0 6px;font-family:Georgia,serif;font-size:18px;color:${INK};font-weight:bold"><a href="${a.uri}" style="color:${INK};text-decoration:none">${a.title}</a></h3>
    <p style="margin:0;color:#3a342d;font-family:Georgia,serif;font-size:14px;line-height:1.5">${a.summary}</p>
  </div>`;
}

function pickedSection(s: Strings, items: NewsEmailArticle[]): string {
  if (items.length === 0) return '';
  return `<div style="font-family:${HEAD};font-size:18px;text-transform:uppercase;color:${INK};margin:24px 0 2px">${s.pickedTitle}</div>
    <p style="margin:0 0 12px;color:${MUTED};font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase">${s.pickedSubtitle}</p>
    ${items.map(card).join('')}`;
}

export function renderDailyNewsEmail(
  s: Strings,
  date: string,
  clusters: { topStories: EmailCluster[]; blindspot: EmailCluster[] },
  articles: SelectedArticles,
  podcast: { title: string; duration: string; uri: string; imageUri?: string | undefined } | null,
  homeUrl: string,
): string {
  const podcastBlock = podcast
    ? `<div style="margin:0 0 20px;padding:16px;background:${INK};color:${PAPER}">
        <div style="font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#cfc7b8">&#127908; The Daily Ugly &middot; ${podcast.duration} &middot; Rundown &rarr; The Spread &rarr; The Ugly Take</div>
        <h3 style="margin:8px 0 12px;font-family:Georgia,serif;font-size:18px;color:${PAPER}"><a href="${podcast.uri}" style="color:${PAPER};text-decoration:none">${podcast.title}</a></h3>
        <a href="${podcast.uri}" style="display:inline-block;padding:9px 18px;background:${PAPER};color:${INK};text-decoration:none;font-weight:bold;font-family:${MONO};font-size:12px;letter-spacing:1px;text-transform:uppercase">&#9654; Listen</a>
      </div>`
    : '';
  const topStories = clusters.topStories.length
    ? `<div style="font-family:${HEAD};font-size:20px;text-transform:uppercase;color:${INK};margin:6px 0 4px">Today, Three Ways</div>
       <p style="margin:0 0 12px;color:${MUTED};font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase">The day's biggest stories &mdash; every side</p>
       ${clusters.topStories.map(clusterCard).join('')}`
    : '';
  const blindspot = clusters.blindspot.length
    ? `<div style="background:${ACCENT};color:${PAPER};font-family:${HEAD};font-size:16px;text-transform:uppercase;letter-spacing:1px;padding:10px 14px;margin:22px 0 12px">&#9695; The Blindspot &mdash; what one side isn't telling you</div>
       ${clusters.blindspot.map(clusterCard).join('')}`
    : '';
  return `<!doctype html><html><body style="margin:0;background:${PAPER};font-family:Georgia,serif">
    <div style="max-width:600px;margin:0 auto;padding:24px;background:${PAPER}">
      <div style="text-align:center;border-bottom:3px double ${INK};padding-bottom:12px;margin-bottom:16px">
        <div style="font-family:${HEAD};font-size:34px;letter-spacing:1px;text-transform:uppercase;color:${INK}">The Ugly Press</div>
        <div style="font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin-top:8px">${date} &middot; Every Story, Three Ways</div>
      </div>
      ${podcastBlock}
      ${topStories}
      ${blindspot}
      ${pickedSection(s, articles.pickedForYou)}
      <div style="text-align:center;margin:28px 0;border-top:3px double ${INK};padding-top:20px">
        <a href="${homeUrl}" style="display:inline-block;padding:13px 26px;background:${INK};color:${PAPER};text-decoration:none;font-weight:bold;font-family:${MONO};font-size:12px;letter-spacing:1px;text-transform:uppercase">${s.buttonText}</a>
        <p style="margin:14px 0 0;color:${MUTED};font-family:${MONO};font-size:11px;letter-spacing:1px">${s.seeAll.replace('%d', String(articles.totalUnread))}</p>
      </div>
    </div></body></html>`;
}

const DEFAULT_STRINGS: Strings = {
  greeting: 'The Ugly Press',
  pickedTitle: 'Picked For You',
  pickedSubtitle: 'Based on what you actually read',
  seeAll: 'Skimmed from %d stories today',
  buttonText: 'Read the ugly truth →',
};

/** Render + send one user's daily news email. */
export async function dispatchUserPrivateNewsEmail(
  db: NewsDb,
  input: { userId: string; now: number },
): Promise<void> {
  const pref = await db.getDoc(collections.userNewsEmailPref, input.userId);
  if (!pref || !pref.emailAllowed) return;

  const [articles, clusters] = await Promise.all([
    selectDailyEmailArticles(db, input.userId, input.now),
    selectEmailClusters(db, input.now),
  ]);
  // Send if we have anything to show — clustered top stories OR personalized picks.
  if (clusters.topStories.length === 0 && articles.pickedForYou.length === 0) return;

  const today = new Date(input.now);
  const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Attach today's default podcast if complete.
  const { podcast } = await newsPodcastGet(db, { date: todayDateString(input.now) });
  const podcastData =
    podcast && podcast.generationStatus === 'complete'
      ? {
          title: podcast.title,
          duration: `${Math.round(podcast.durationMs / 60000)} min`,
          uri: await shareLink({
            target: `${PUBLIC_URL}/podcast`,
            og: { title: podcast.title },
          }),
          imageUri: podcast.articles[0]?.imageUri ?? undefined,
        }
      : null;

  const to = await resolveUserEmail(input.userId);
  if (!to) {
    console.warn(`[news] daily email skipped — no email for ${input.userId}`);
    return;
  }

  const homeUrl = await shareLink({ target: `${PUBLIC_URL}/`, og: { title: DEFAULT_STRINGS.greeting } });
  const html = renderDailyNewsEmail(DEFAULT_STRINGS, dateStr, clusters, articles, podcastData, homeUrl);
  const leadTitle = clusters.topStories[0]?.title ?? articles.hero?.title ?? 'Your daily edition';
  const subject = `The Ugly Press: ${leadTitle.slice(0, 55)}${leadTitle.length > 55 ? '…' : ''}`;
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
