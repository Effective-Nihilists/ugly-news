// Podcast TTS. The InWorld upstream call + its API key now live ONLY in
// ugly.bot (the `ttsRender` op); this module keeps the podcast-specific text
// preprocessing + word-index mapping and renders each segment through the
// owner-billed, app-cached op (see ./tts-cache). The text preprocessing +
// emotion/temperature logic is unchanged from the original direct port.
import type {
  PodcastNonVerbalCue,
  PodcastSpeakerEmotion,
} from '../../shared/news/NewsPodcast';
import { base64ToBytes } from '../../shared/news/WAV';
import { renderSegmentCached } from './tts-cache';

const INWORLD_DEFAULT_VOICE = 'Alex';

export const EMOTION_TEMPERATURES: Record<PodcastSpeakerEmotion, number> = {
  happy: 0.95,
  laughing: 1.0,
  angry: 0.95,
  surprised: 0.9,
  sad: 0.7,
  fearful: 0.75,
  disgusted: 0.85,
  whispering: 0.6,
  neutral: 0.85,
};
export const DEFAULT_TTS_TEMPERATURE = 0.85;

type InWorldEmotionMarkup =
  | '[happy]' | '[sad]' | '[angry]' | '[surprised]'
  | '[fearful]' | '[disgusted]' | '[laughing]' | '[whispering]';

const AUDIO_MARKUP_SET = new Set<string>([
  '[happy]', '[sad]', '[angry]', '[surprised]', '[fearful]', '[disgusted]',
  '[laughing]', '[whispering]', '[breathe]', '[sigh]',
]);
const FILLER_WORDS = new Set<string>(['Well,', 'You', 'know,', 'So,']);

export function preprocessTextForTTS(
  text: string,
  emotionHint?: PodcastSpeakerEmotion,
  nonVerbalCue?: PodcastNonVerbalCue,
): string {
  let emotionMarkup: InWorldEmotionMarkup | null = null;
  if (emotionHint && emotionHint !== 'neutral') {
    const hintToMarkup: Record<Exclude<PodcastSpeakerEmotion, 'neutral'>, InWorldEmotionMarkup> = {
      happy: '[happy]', sad: '[sad]', angry: '[angry]', surprised: '[surprised]',
      fearful: '[fearful]', disgusted: '[disgusted]', laughing: '[laughing]', whispering: '[whispering]',
    };
    emotionMarkup = hintToMarkup[emotionHint];
  } else {
    const t = text.toLowerCase();
    if (/(hilarious|funny|joke|ridiculous|absurd)/.test(t)) emotionMarkup = '[laughing]';
    else if (/(secret|whisper|rumor|allegedly|sources say)/.test(t)) emotionMarkup = '[whispering]';
    else if (/(outrage|furious|scandal|slams|attacks)/.test(t)) emotionMarkup = '[angry]';
    else if (/(tragic|devastating|heartbreaking|loss|passed away)/.test(t)) emotionMarkup = '[sad]';
    else if (/(shocking|breaking|unbelievable|incredible|just in)/.test(t)) emotionMarkup = '[surprised]';
    else if (/(terrifying|scary|horror|danger)/.test(t)) emotionMarkup = '[fearful]';
    else if (/(disgusting|gross|disturbing|vile)/.test(t)) emotionMarkup = '[disgusted]';
    else if (/(exciting|amazing|wonderful|celebrate|congratulations)/.test(t)) emotionMarkup = '[happy]';
  }

  let processed = text;
  const emphasis = ['breaking', 'exclusive', 'shocking', 'incredible', 'devastating', 'massive', 'explosive', 'urgent', 'critical', 'historic'];
  for (const word of emphasis) {
    processed = processed.replace(new RegExp(`\\b(${word})\\b`, 'gi'), '*$1*');
  }
  if (processed.length > 100 && Math.random() > 0.7) {
    const fillers = ['Well, ', 'You know, ', 'So, '];
    processed = fillers[Math.floor(Math.random() * fillers.length)]! + processed;
  }
  if (emotionMarkup) processed = `${emotionMarkup} ${processed}`;
  else if (nonVerbalCue === 'breathe') processed = `[breathe] ${processed}`;
  else if (nonVerbalCue === 'sigh') processed = `[sigh] ${processed}`;
  if (nonVerbalCue === 'laugh' || nonVerbalCue === 'chuckle') processed = `${processed} [laughing]`;
  return processed;
}

export interface WordMapping {
  processedIdx: number;
  originalIdx: number | null;
  originalWord: string | null;
}

export function createWordIndexMapping(originalText: string, processedText: string): WordMapping[] {
  const originalWords = originalText.split(/\s+/);
  const processedWords = processedText.split(/\s+/);
  const mapping: WordMapping[] = [];
  let origIdx = 0;
  for (let procIdx = 0; procIdx < processedWords.length; procIdx++) {
    const procWord = processedWords[procIdx]!;
    if (AUDIO_MARKUP_SET.has(procWord)) {
      mapping.push({ processedIdx: procIdx, originalIdx: null, originalWord: null });
      continue;
    }
    if (procIdx < 4 && FILLER_WORDS.has(procWord)) {
      mapping.push({ processedIdx: procIdx, originalIdx: null, originalWord: null });
      continue;
    }
    if (origIdx < originalWords.length) {
      mapping.push({ processedIdx: procIdx, originalIdx: origIdx, originalWord: originalWords[origIdx]! });
      origIdx++;
    }
  }
  return mapping;
}

export interface InworldPhoneDetail {
  phoneSymbol: string;
  startTimeSeconds: number;
  durationSeconds: number;
  visemeSymbol: string;
}
interface WordAlignment {
  words: string[];
  wordStartTimeSeconds: number[];
  wordEndTimeSeconds: number[];
  phoneticDetails?: { phones: InworldPhoneDetail[] }[] | undefined;
}
export interface InworldCollectedResponse {
  audioContent: string; // base64 WAV (combined) — kept for API-shape parity
  pcm: Uint8Array; // raw 24kHz/16-bit mono PCM (combined) — use this directly
  timestampInfo?: { wordAlignment?: WordAlignment | undefined } | undefined;
}

export async function generateSegmentTTS(
  text: string,
  voiceId: string,
  emotionHint?: PodcastSpeakerEmotion,
  nonVerbalCue?: PodcastNonVerbalCue,
  isRetry = false,
): Promise<{ result: InworldCollectedResponse; mapping: WordMapping[] }> {
  const processedText = preprocessTextForTTS(text, emotionHint, nonVerbalCue);
  const mapping = createWordIndexMapping(text, processedText);
  const temperature = emotionHint ? EMOTION_TEMPERATURES[emotionHint] : DEFAULT_TTS_TEMPERATURE;

  // Render through ugly.bot's owner-billed, app-cached `ttsRender` op (the
  // InWorld key lives only in ugly.bot now). Unknown-voice → retry once with the
  // default voice, mirroring the old direct-fetch behavior.
  let rendered;
  try {
    rendered = await renderSegmentCached({ text: processedText, voiceId, temperature });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/unknown voice|\b404\b/i.test(msg) && !isRetry) {
      return generateSegmentTTS(text, INWORLD_DEFAULT_VOICE, emotionHint, nonVerbalCue, true);
    }
    throw error;
  }

  const pcm = base64ToBytes(rendered.audio);
  if (pcm.length === 0) throw new Error('InWorld TTS returned no audio content');
  const words = rendered.words ?? [];
  const visemes = rendered.visemes ?? [];

  // Reshape the op result into the InworldCollectedResponse the podcast
  // generator already consumes (raw PCM + parallel-array word alignment +
  // flattened phonetic/viseme details).
  const result: InworldCollectedResponse = {
    audioContent: '',
    pcm,
    timestampInfo: words.length
      ? {
          wordAlignment: {
            words: words.map((w) => w.word),
            wordStartTimeSeconds: words.map((w) => w.startMs / 1000),
            wordEndTimeSeconds: words.map((w) => (w.startMs + w.durationMs) / 1000),
            phoneticDetails: visemes.length
              ? [
                  {
                    phones: visemes.map((v) => ({
                      phoneSymbol: '',
                      visemeSymbol: v.name,
                      startTimeSeconds: v.startMs / 1000,
                      durationSeconds: v.durationMs / 1000,
                    })),
                  },
                ]
              : undefined,
          },
        }
      : undefined,
  };
  return { result, mapping };
}
