// InWorld streaming TTS — faithful port from ugly.bot, made Workers-safe:
// Uint8Array instead of Buffer, atob/btoa instead of Buffer base64, and the
// final PCM is wrapped in a WAV container (createWAVFromPCM) instead of ffmpeg.
import type {
  PodcastNonVerbalCue,
  PodcastSpeakerEmotion,
} from '../../shared/news/NewsPodcast';
import { base64ToBytes, bytesToBase64, concatBytes, createWAVFromPCM, parseWAVHeader } from '../../shared/news/WAV';

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

/** Basic-auth header value for InWorld, from env. Empty if unconfigured. */
export function getInworldBasicAuth(): string {
  /* eslint-disable @typescript-eslint/dot-notation */
  const precomputed = process.env['INWORLD_BASIC_AUTH'];
  if (precomputed) return precomputed;
  const key = process.env['INWORLD_API_KEY'];
  const secret = process.env['INWORLD_API_SECRET'];
  /* eslint-enable @typescript-eslint/dot-notation */
  if (!key || !secret) return '';
  return btoa(`${key}:${secret}`);
}

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
interface InworldChunkResult {
  audioContent?: string;
  timestampInfo?: { wordAlignment?: WordAlignment | undefined } | undefined;
}
export interface InworldCollectedResponse {
  audioContent: string; // base64 WAV (combined)
  timestampInfo?: { wordAlignment?: WordAlignment | undefined } | undefined;
}

export async function collectInworldStreamResponse(response: Response): Promise<InworldCollectedResponse> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  const audioChunks: Uint8Array[] = [];
  const words: string[] = [];
  const wordStarts: number[] = [];
  const wordEnds: number[] = [];
  const phoneticDetails: { phones: InworldPhoneDetail[] }[] = [];

  const processLine = (line: string): void => {
    if (!line.trim()) return;
    const parsed = JSON.parse(line) as { result?: InworldChunkResult; error?: { code: number; message: string } };
    if (parsed.error) throw new Error(`InWorld error: ${parsed.error.code} ${parsed.error.message}`);
    if (!parsed.result) return;
    if (parsed.result.audioContent) {
      const wav = base64ToBytes(parsed.result.audioContent);
      const info = parseWAVHeader(wav);
      audioChunks.push(wav.subarray(info.dataOffset, info.dataOffset + info.dataSize));
    }
    const wa = parsed.result.timestampInfo?.wordAlignment;
    if (wa) {
      words.push(...wa.words);
      wordStarts.push(...wa.wordStartTimeSeconds);
      wordEnds.push(...wa.wordEndTimeSeconds);
      if (wa.phoneticDetails) phoneticDetails.push(...wa.phoneticDetails);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      processLine(lineBuffer.slice(0, nl));
      lineBuffer = lineBuffer.slice(nl + 1);
    }
  }
  if (lineBuffer.trim()) processLine(lineBuffer);
  if (audioChunks.length === 0) throw new Error('InWorld TTS returned no audio content');

  const combinedPcm = concatBytes(audioChunks);
  const wav = createWAVFromPCM(combinedPcm, 24000);
  return {
    audioContent: bytesToBase64(wav),
    timestampInfo: words.length > 0
      ? { wordAlignment: { words, wordStartTimeSeconds: wordStarts, wordEndTimeSeconds: wordEnds, phoneticDetails: phoneticDetails.length > 0 ? phoneticDetails : undefined } }
      : undefined,
  };
}

export async function generateSegmentTTS(
  inworldBasicAuth: string,
  text: string,
  voiceId: string,
  emotionHint?: PodcastSpeakerEmotion,
  nonVerbalCue?: PodcastNonVerbalCue,
  isRetry = false,
): Promise<{ result: InworldCollectedResponse; mapping: WordMapping[] }> {
  const processedText = preprocessTextForTTS(text, emotionHint, nonVerbalCue);
  const mapping = createWordIndexMapping(text, processedText);
  const temperature = emotionHint ? EMOTION_TEMPERATURES[emotionHint] : DEFAULT_TTS_TEMPERATURE;

  const response = await fetch('https://api.inworld.ai/tts/v1/voice:stream', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${inworldBasicAuth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: processedText,
      voiceId,
      modelId: 'inworld-tts-1.5-max',
      temperature,
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
      timestampType: 'WORD',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404 && errorText.includes('Unknown voice') && !isRetry) {
      return generateSegmentTTS(inworldBasicAuth, text, INWORLD_DEFAULT_VOICE, emotionHint, nonVerbalCue, true);
    }
    throw new Error(`InWorld TTS failed: ${response.status} ${errorText}`);
  }
  if (!response.body) throw new Error('InWorld TTS returned no body');
  const result = await collectInworldStreamResponse(response);
  return { result, mapping };
}
