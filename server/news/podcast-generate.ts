import { getAdapter, pushSend } from 'ugly-app/server/adapter/workers';
import { dbDefaults, visemeNameSet } from 'ugly-app/shared';
import { collections } from '../../shared/collections';
import type { FileMarkdown, NewsPodcast } from '../../shared/collections';
import { uglyBotId } from '../../shared/news/Bot';
import {
  podcastHost1BotId,
  type PodcastArticleReference,
  type PodcastScriptOutput,
  type PodcastSegment,
  type PodcastSubtitle,
  type PodcastSubtitleWord,
  type PodcastViseme,
} from '../../shared/news/NewsPodcast';
import { concatBytes, createWAVFromPCM } from '../../shared/news/WAV';
import { genText } from './ai';
import type { NewsDb } from './db';
import { todayDateString } from './podcast';
import {
  generateSegmentTTS,
  type InworldCollectedResponse,
  type WordMapping,
} from './tts';

interface HostConfig {
  name: string;
  voiceId: string;
}
// Default host identities (mirrors ugly.bot's podcastHost1 + uglyBot configs).
// HOST1 Sarah = female news anchor; HOST2 Ugly Bot = male snarky commentator.
const HOST1: HostConfig = { name: 'Sarah', voiceId: 'inworld-Sarah' };
const HOST2: HostConfig = { name: 'Ugly Bot', voiceId: 'inworld-Theodore' };

// ── Article selection ────────────────────────────────────────────────────

function selectWeightedRandom(articles: FileMarkdown[], count: number): FileMarkdown[] {
  const remaining = [...articles];
  const selected: FileMarkdown[] = [];
  for (let i = 0; i < Math.min(count, remaining.length); i++) {
    const weights = remaining.map((a) => (a.likeCount ?? 0) + 1);
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    let idx = 0;
    while (r > (weights[idx] ?? 0) && idx < remaining.length - 1) {
      r -= weights[idx] ?? 0;
      idx++;
    }
    selected.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return selected;
}

async function getArticlesForPodcast(db: NewsDb): Promise<FileMarkdown[]> {
  const articles = await db.getDocs(
    collections.file,
    { type: 'markdown', feedId: { $ne: null } },
    { sort: { created: -1 }, limit: 1000 },
  );
  return selectWeightedRandom(articles, 7);
}

// ── Script generation (GPT-4o) ─────────────────────────────────────────────

async function generatePodcastScript(
  articles: FileMarkdown[],
  host1: HostConfig,
  host2: HostConfig,
): Promise<PodcastScriptOutput> {
  const articlesJson = articles.map((a) => ({
    fileId: a._id,
    title: a.title ?? '',
    summary: (a.markdown ?? '').slice(0, 500),
    category: a.tags?.[0] ?? 'news',
  }));

  const prompt = `You are writing a script for "Ugly News Daily" - a COMEDY podcast that roasts the news, with CAMERA and EMOTION directions per segment.

HOSTS:
- ${host1.name} (HOST1): serious professional news anchor; gravitas, factual, the straight man.
- ${host2.name} (HOST2): snarky, unfiltered commentator; dark humor, savage takes, witty interruptions.

TONE: ${host1.name} delivers seriously; ${host2.name} undercuts with hilarious commentary. ${host2.name} may be profane.

ARTICLES:
${JSON.stringify(articlesJson, null, 2)}

REQUIREMENTS:
1. ~800 words (5-7 min).
2. FIRST segment = a short shocking/funny one-liner hook (<8 words) referencing a specific story; don't repeat it later.
3. Opening: ${host1.name} serious intro, ${host2.name} undercuts with snark.
4. Per article: ${host1.name} introduces seriously; ${host2.name} roasts it; natural back-and-forth.
5. Closing: ${host1.name} signs off; ${host2.name} nihilistic jab; mention "ugly.press" naturally in the outro.

For EVERY segment include:
- cameraShot: "normal" | "closeup" (closeups for ~20-30% dramatic moments)
- cameraEnergy: "fast" | "normal" | "slow"
- listenerReaction: "laugh" | "shocked" | "agree" | "empathize" | "nod" | "bored"
- gestureHint: { gesture: "handup"|"index"|"thumbup"|"shrug"|"side"|"ok"|"thumbdown"|"namaste", timing: "start"|"mid"|"end" } (optional, ~30-40% of segments)
- speakerEmotion: "laughing"|"whispering"|"angry"|"sad"|"surprised"|"fearful"|"disgusted"|"happy"|"neutral" (aim 60-70% non-neutral)
- nonVerbalCue: "breathe"|"sigh"|"laugh"|"chuckle"|null (sparingly, 3-5 total)

OUTPUT JSON ONLY (no markdown fences):
{ "title": "catchy episode title", "segments": [ { "speaker": "HOST1", "text": "...", "articleRef": "fileId or null", "cameraShot": "normal", "cameraEnergy": "normal", "listenerReaction": "nod", "gestureHint": { "gesture": "shrug", "timing": "mid" }, "speakerEmotion": "surprised", "nonVerbalCue": null } ] }`;

  // The script model (gpt_4o via the ugly.bot AI proxy) intermittently 429s /
  // times out at the 10:00 UTC cron, returning null → "No response from script
  // model" and a failed episode. Retry up to 5 attempts with exponential backoff
  // (the queue job has a 120s budget) so a transient blip doesn't lose the day.
  const MAX_ATTEMPTS = 5;
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const responseText = await genText([{ role: 'user', content: prompt }], {
        model: 'gpt_4o',
        temperature: 0.9,
        maxTokens: 4000,
      });
      if (!responseText) throw new Error('No response from script model');
      const jsonMatch = /\{[\s\S]*\}/.exec(responseText);
      if (!jsonMatch) throw new Error('Failed to parse script JSON');
      const script = JSON.parse(jsonMatch[0]) as PodcastScriptOutput;
      if (!script.title || !script.segments || script.segments.length === 0) {
        throw new Error('Invalid script format');
      }
      return script;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[PODCAST] script attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`);
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw new Error(`Script generation failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

// ── Audio assembly (InWorld TTS → WAV) ─────────────────────────────────────

interface AudioResult {
  audio: Uint8Array;
  visemes: PodcastViseme[];
  subtitles: PodcastSubtitle[];
  segments: PodcastSegment[];
  durationMs: number;
}

async function generatePodcastAudio(
  script: PodcastScriptOutput,
  host1: HostConfig,
  host2: HostConfig,
): Promise<AudioResult> {
  const allVisemes: PodcastViseme[] = [];
  const allSubtitles: PodcastSubtitle[] = [];
  const allSegments: PodcastSegment[] = [];
  const audioChunks: Uint8Array[] = [];
  let currentTimeMs = 0;
  const sampleRate = 24000;
  const bytesPerSample = 2;

  for (const seg of script.segments) {
    const isHost1 = seg.speaker === 'HOST1';
    const host = isHost1 ? host1 : host2;
    const speakerId = isHost1 ? podcastHost1BotId : uglyBotId;
    const voiceId = (host.voiceId ?? 'inworld-Alex').replace('inworld-', '');

    let result: InworldCollectedResponse;
    let mapping: WordMapping[];
    let pcm: Uint8Array;
    try {
      const r = await generateSegmentTTS(seg.text, voiceId, seg.speakerEmotion, seg.nonVerbalCue ?? undefined);
      result = r.result;
      mapping = r.mapping;
      pcm = result.pcm;
      if (pcm.length === 0) throw new Error('Empty audio data');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Empty audio data') || msg.includes('no audio content') || msg.includes('missing data chunk')) {
        // Retry once with the plain (un-marked-up) text — emotion/cue markup
        // occasionally yields an empty render.
        const r = await generateSegmentTTS(seg.text, voiceId);
        result = r.result;
        mapping = r.mapping;
        pcm = result.pcm;
      } else {
        throw error;
      }
    }

    const segmentDurationMs = (pcm.length / bytesPerSample / sampleRate) * 1000;

    allSegments.push({
      speakerId,
      speakerName: host.name,
      text: seg.text,
      startTimeMs: currentTimeMs,
      endTimeMs: currentTimeMs + segmentDurationMs,
      articleRef: seg.articleRef ?? undefined,
      gestureHint: seg.gestureHint,
      cameraShot: seg.cameraShot ?? 'normal',
      cameraEnergy: seg.cameraEnergy ?? 'normal',
      listenerReaction: seg.listenerReaction ?? 'nod',
      speakerEmotion: seg.speakerEmotion,
      nonVerbalCue: seg.nonVerbalCue ?? undefined,
    });

    // Word-level subtitle timing via the pre-computed mapping.
    const words: PodcastSubtitleWord[] = [];
    const wa = result.timestampInfo?.wordAlignment;
    if (wa) {
      for (let w = 0; w < wa.words.length && w < mapping.length; w++) {
        const m = mapping[w]!;
        if (m.originalIdx === null) continue;
        words.push({
          text: m.originalWord!,
          startTimeMs: currentTimeMs + (wa.wordStartTimeSeconds[w] ?? 0) * 1000,
          endTimeMs: currentTimeMs + (wa.wordEndTimeSeconds[w] ?? 0) * 1000,
        });
      }
    }
    allSubtitles.push({
      text: seg.text,
      speakerId,
      startTimeMs: currentTimeMs,
      endTimeMs: currentTimeMs + segmentDurationMs,
      words: words.length > 0 ? words : undefined,
    });

    // Visemes from phonetic details.
    if (wa?.phoneticDetails) {
      for (const detail of wa.phoneticDetails) {
        for (const phone of detail.phones ?? []) {
          if (visemeNameSet.has(phone.visemeSymbol as never)) {
            allVisemes.push({
              speakerId,
              name: phone.visemeSymbol as PodcastViseme['name'],
              startMs: currentTimeMs + phone.startTimeSeconds * 1000,
              durationMs: phone.durationSeconds * 1000,
              intensity: phone.visemeSymbol === 'sil' ? 0 : 0.8,
            });
          }
        }
      }
    }

    audioChunks.push(pcm);
    currentTimeMs += segmentDurationMs;

    // 200ms silence between segments.
    const pauseMs = 200;
    audioChunks.push(new Uint8Array(Math.floor((sampleRate * pauseMs) / 1000) * bytesPerSample));
    currentTimeMs += pauseMs;
  }

  const combinedPcm = concatBytes(audioChunks);
  return {
    audio: createWAVFromPCM(combinedPcm, sampleRate),
    visemes: allVisemes,
    subtitles: allSubtitles,
    segments: allSegments,
    durationMs: currentTimeMs,
  };
}

function buildArticleReferences(articles: FileMarkdown[], segments: PodcastSegment[]): PodcastArticleReference[] {
  const map = new Map(articles.map((a) => [a._id, a]));
  const refs: PodcastArticleReference[] = [];
  for (const seg of segments) {
    if (!seg.articleRef) continue;
    const article = map.get(seg.articleRef);
    if (!article) continue;
    const existing = refs.find((r) => r.fileId === seg.articleRef);
    if (existing) {
      existing.endTimeMs = Math.max(existing.endTimeMs, seg.endTimeMs);
    } else {
      const image = article.thumbnail ?? null;
      refs.push({
        fileId: article._id,
        title: article.title ?? '',
        imageUri: image?.uri ?? null,
        image,
        startTimeMs: seg.startTimeMs,
        endTimeMs: seg.endTimeMs,
      });
    }
  }
  return refs;
}

async function uploadPodcastAudio(podcastId: string, audio: Uint8Array): Promise<string> {
  const key = `podcasts/${podcastId}/${Date.now()}.wav`;
  const storage = getAdapter().storage;
  await storage.put('public', key, audio, 'audio/wav');
  return storage.url('public', key);
}

// ── Orchestration ──────────────────────────────────────────────────────────

/**
 * Fan a "new episode is live" push out to everyone subscribed to the daily
 * edition. We reuse the email opt-in (`userNewsEmailPref.emailAllowed`) as the
 * push audience — the home-page "8 A.M. Edition" toggle both subscribes and
 * registers the device. Best-effort per user: a missing/denied device just
 * yields { sent:false } and never aborts the batch. Routes through pushSend →
 * ugly.bot with the owner UGLY_BOT_TOKEN (no PUSH_PROXY_TOKEN needed).
 */
export async function notifyPodcastReady(db: NewsDb, podcast: NewsPodcast): Promise<void> {
  const subs = await db.getDocs(collections.userNewsEmailPref, { emailAllowed: true });
  if (subs.length === 0) return;
  const title = "Today's episode is live";
  const body = podcast.title || 'Your daily Ugly Press news podcast is ready.';
  const imageUrl = podcast.articles[0]?.imageUri ?? undefined;
  const CHUNK = 20;
  let sent = 0;
  for (let i = 0; i < subs.length; i += CHUNK) {
    const results = await Promise.all(
      subs.slice(i, i + CHUNK).map((s) =>
        pushSend({
          targetUserId: s.userId,
          title,
          body,
          path: 'podcast',
          ...(imageUrl ? { imageUrl } : {}),
        })
          .then((r) => (r.sent ? 1 : 0))
          .catch((e) => {
            console.warn(`[news] podcast push failed for ${s.userId}`, e);
            return 0;
          }),
      ),
    );
    sent += results.reduce((a: number, b: number) => a + b, 0);
  }
  console.log(`[news] podcast push: ${sent}/${subs.length} delivered for ${podcast.date}`);
}

export async function dispatchPodcastGenerate(
  db: NewsDb,
  input: { date: string; userId: string | null; replaceDefault?: boolean | undefined },
): Promise<void> {
  const { date, userId } = input;
  const podcastId = userId ? `${date}_${userId}` : `${date}_default`;
  // Preserve the dedupe flag across a manual regenerate so we never re-notify
  // subscribers about an episode they were already pinged for.
  const existing = await db.getDoc(collections.newsPodcast, podcastId);
  const alreadyPushed = Boolean(existing?.pushedAt);

  const initial: NewsPodcast = {
    _id: podcastId,
    date,
    title: '',
    description: '',
    userId,
    host1BotId: podcastHost1BotId,
    host2BotId: uglyBotId,
    articles: [],
    segments: [],
    audioUri: '',
    durationMs: 0,
    visemes: [],
    subtitles: [],
    generationStatus: 'generating',
    generationError: null,
    generatedAt: Date.now(),
    ...dbDefaults(),
  };
  await db.setDoc(collections.newsPodcast, initial);

  try {
    const articles = await getArticlesForPodcast(db);
    if (articles.length < 3) throw new Error(`Not enough articles: ${articles.length}`);

    const script = await generatePodcastScript(articles, HOST1, HOST2);
    const { audio, visemes, subtitles, segments, durationMs } = await generatePodcastAudio(script, HOST1, HOST2);
    const audioUri = await uploadPodcastAudio(podcastId, audio);
    const articleRefs = buildArticleReferences(articles, segments);

    const completed: NewsPodcast = {
      ...initial,
      title: script.title,
      description: `Daily satirical news roundup featuring ${articles.length} stories`,
      articles: articleRefs,
      segments,
      audioUri,
      durationMs,
      visemes,
      subtitles,
      generationStatus: 'complete',
      generatedAt: Date.now(),
      pushedAt: existing?.pushedAt ?? null,
      updated: new Date(),
    };
    await db.setDoc(collections.newsPodcast, completed);

    // Notify subscribers about the new DEFAULT daily episode (once per episode).
    if (userId === null && !alreadyPushed) {
      await notifyPodcastReady(db, completed);
      await db.setDocFields(collections.newsPodcast, podcastId, { pushedAt: Date.now() });
    }
  } catch (error) {
    console.error('[PODCAST] generation failed', error);
    await db.setDoc(collections.newsPodcast, {
      ...initial,
      generationStatus: 'failed',
      generationError: error instanceof Error ? error.message : String(error),
      updated: new Date(),
    } satisfies NewsPodcast);
  }
}

export { todayDateString };
