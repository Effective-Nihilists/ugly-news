// Per-segment TTS cache (ugly-press is the ONLY app with a TTS cache for now).
//
// Podcast segments are rendered through ugly.bot's `ttsRender` op (owner-billed
// — the upstream InWorld key lives only in ugly.bot now, never here). To keep
// podcasts cheap, identical segments (recurring intros / sign-offs / reruns)
// are cached in this app's own public R2 bucket keyed by sha256(model | voice |
// temperature | text):
//   - HIT  → reuse the stored render, NO ugly.bot call, $0.
//   - MISS → render once (owner charged once) → store → return.
//
// (Playback was already a static `<audio>` file generated once per episode, so
// popularity never multiplies cost; this additionally dedupes repeated text.)
import { getAdapter } from 'ugly-app/server/adapter/workers';
import { uglyBotRequest } from 'ugly-app/server';

export interface TtsViseme {
  name: string;
  startMs: number;
  durationMs: number;
  intensity: number;
}
export interface TtsWord {
  word: string;
  startMs: number;
  durationMs: number;
  charStartIndex: number;
  charEndIndex: number;
}
export interface TtsRenderResult {
  audio: string; // base64 PCM16 @ 24kHz — the whole segment
  sampleRate: number;
  audioFormat: string;
  visemes: TtsViseme[];
  words: TtsWord[];
  durationMs: number;
}

// Podcasts use InWorld's high-quality model; the op defaults to the fast mini.
export const PODCAST_TTS_MODEL = 'inworld-tts-1.5-max';

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Render a podcast segment via ugly.bot's `ttsRender` op, caching the result in
 * this app's public R2. `text` is the already-preprocessed (markup-injected)
 * string so the cache key reflects exactly what InWorld synthesizes.
 */
export async function renderSegmentCached(params: {
  text: string;
  voiceId: string;
  temperature: number;
}): Promise<TtsRenderResult> {
  const { text, voiceId, temperature } = params;
  const storage = getAdapter().storage;
  const hash = await sha256Hex(`${PODCAST_TTS_MODEL}|${voiceId}|${temperature}|${text}`);
  const key = `tts-cache/${hash}.json`;

  // Cache check: the public bucket is web-readable (same bucket podcasts serve
  // from), so a hit is a plain GET. Any failure falls through to a render.
  try {
    const res = await fetch(storage.url('public', key));
    if (res.ok) {
      const cached = (await res.json()) as TtsRenderResult;
      if (cached && typeof cached.audio === 'string' && cached.audio) return cached;
    }
  } catch {
    /* treat as a miss */
  }

  const rendered = await uglyBotRequest('ttsRender', {
    text,
    voice: voiceId,
    model: PODCAST_TTS_MODEL,
    temperature,
    requestVisemes: true,
  });

  // Best-effort cache write — a failed store just means the next identical
  // segment re-renders (correctness unaffected).
  try {
    await storage.put(
      'public',
      key,
      new TextEncoder().encode(JSON.stringify(rendered)),
      'application/json',
    );
  } catch {
    /* ignore cache-write failure */
  }
  return rendered;
}
