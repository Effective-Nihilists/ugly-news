import { getAdapter } from 'ugly-app/server/adapter/workers';
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
import { base64ToBytes, concatBytes, createWAVFromPCM, parseWAVHeader } from '../../shared/news/WAV';
import { genText } from './ai';
import type { NewsDb } from './db';
import { todayDateString } from './podcast';
import {
  generateSegmentTTS,
  getInworldBasicAuth,
  type InworldCollectedResponse,
  type WordMapping,
} from './tts';

interface HostConfig {
  name: string;
  voiceId: string;
}
// Default host identities. Phase 8's initSeed can override these (name/voiceId).
const HOST1: HostConfig = { name: 'Sarah', voiceId: 'inworld-Sarah' };
const HOST2: HostConfig = { name: 'Ugly Bot', voiceId: 'inworld-Ashley' };

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

  const responseText = await genText([{ role: 'user', content: prompt }], {
    model: 'gpt_4o',
    temperature: 0.9,
  });
  if (!responseText) throw new Error('No response from script model');
  const jsonMatch = /\{[\s\S]*\}/.exec(responseText);
  if (!jsonMatch) throw new Error('Failed to parse script JSON');
  const script = JSON.parse(jsonMatch[0]) as PodcastScriptOutput;
  if (!script.title || !script.segments || script.segments.length === 0) {
    throw new Error('Invalid script format');
  }
  return script;
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
  const inworldBasicAuth = getInworldBasicAuth();
  if (!inworldBasicAuth) throw new Error('InWorld API key not configured');

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
      const r = await generateSegmentTTS(inworldBasicAuth, seg.text, voiceId, seg.speakerEmotion, seg.nonVerbalCue ?? undefined);
      result = r.result;
      mapping = r.mapping;
      const wav = base64ToBytes(result.audioContent);
      const info = parseWAVHeader(wav);
      pcm = wav.subarray(info.dataOffset, info.dataOffset + info.dataSize);
      if (pcm.length === 0) throw new Error('Empty audio data');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Empty audio data') || msg.includes('no audio content') || msg.includes('missing data chunk')) {
        const r = await generateSegmentTTS(inworldBasicAuth, seg.text, voiceId);
        result = r.result;
        mapping = r.mapping;
        const wav = base64ToBytes(result.audioContent);
        const info = parseWAVHeader(wav);
        pcm = wav.subarray(info.dataOffset, info.dataOffset + info.dataSize);
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

export async function dispatchPodcastGenerate(
  db: NewsDb,
  input: { date: string; userId: string | null; replaceDefault?: boolean | undefined },
): Promise<void> {
  const { date, userId } = input;
  const podcastId = userId ? `${date}_${userId}` : `${date}_default`;

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

    await db.setDoc(collections.newsPodcast, {
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
      updated: new Date(),
    } satisfies NewsPodcast);
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
