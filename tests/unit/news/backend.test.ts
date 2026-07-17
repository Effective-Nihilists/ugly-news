import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  createWAVFromPCM,
  parseWAVHeader,
} from '../../../shared/news/WAV';
import { getTimezonesAtLocalHour } from '../../../shared/news/Timezone';
import {
  decodeHtmlEntities,
  extractImageFromRSSItem,
  htmlToMarkdown,
} from '../../../server/news/download';
import {
  createWordIndexMapping,
  preprocessTextForTTS,
} from '../../../server/news/tts';

// ── WAV (replaces ffmpeg; must round-trip for podcast audio) ────────────────
describe('WAV', () => {
  it('createWAVFromPCM + parseWAVHeader round-trip', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // 4 samples @ 16-bit
    const wav = createWAVFromPCM(pcm, 24000);
    const info = parseWAVHeader(wav);
    expect(info.sampleRate).toBe(24000);
    expect(info.numChannels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataSize).toBe(pcm.length);
    expect(
      wav.subarray(info.dataOffset, info.dataOffset + info.dataSize),
    ).toEqual(pcm);
  });

  it('base64 round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('concatBytes concatenates in order', () => {
    expect(
      concatBytes([
        new Uint8Array([1, 2]),
        new Uint8Array([3]),
        new Uint8Array([4, 5]),
      ]),
    ).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
});

// ── HTML entity decoding (RSS titles arrive encoded) ────────────────────────
describe('decodeHtmlEntities', () => {
  it('decodes the real-world title regression (&#8217; → ’)', () => {
    expect(decodeHtmlEntities('Anthropic&#8217;s safety warnings')).toBe(
      'Anthropic’s safety warnings',
    );
  });
  it('decodes decimal, hex, and named entities', () => {
    expect(decodeHtmlEntities('A &amp; B')).toBe('A & B');
    expect(decodeHtmlEntities('caf&#233;')).toBe('café');
    expect(decodeHtmlEntities('caf&#xe9;')).toBe('café');
    expect(decodeHtmlEntities('em&mdash;dash')).toBe('em—dash');
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
  });
  it('leaves unknown entities and plain text untouched', () => {
    expect(decodeHtmlEntities('plain text')).toBe('plain text');
    expect(decodeHtmlEntities('&bogus; stays')).toBe('&bogus; stays');
    expect(decodeHtmlEntities('5 < 10 & ok')).toBe('5 < 10 & ok');
  });
  it('rejects out-of-range code points without throwing', () => {
    expect(decodeHtmlEntities('&#99999999999;')).toBe('');
  });
});

// ── Timezone (drives 8am-local email cron) ──────────────────────────────────
describe('getTimezonesAtLocalHour', () => {
  it('returns a non-empty set of zones for hour 8 at some UTC time', () => {
    // At 16:00 UTC, America/Los_Angeles (UTC-8) is 08:00 local.
    const utc8amLA = Date.UTC(2026, 0, 15, 16, 0, 0);
    const zones = getTimezonesAtLocalHour(utc8amLA, 8);
    expect(Array.isArray(zones)).toBe(true);
    expect(zones).toContain('America/Los_Angeles');
  });

  it('different UTC hours select different zones', () => {
    const a = getTimezonesAtLocalHour(Date.UTC(2026, 0, 15, 16, 0, 0), 8);
    const b = getTimezonesAtLocalHour(Date.UTC(2026, 0, 15, 13, 0, 0), 8);
    expect(a.join()).not.toBe(b.join());
  });
});

// ── RSS helpers (Workers-safe parsing) ──────────────────────────────────────
describe('RSS extraction', () => {
  it('htmlToMarkdown strips tags + decodes entities', () => {
    const md = htmlToMarkdown(
      '<p>Hello &amp; <b>world</b></p><script>x()</script>',
    );
    expect(md).toContain('Hello & world');
    expect(md).not.toContain('<');
    expect(md).not.toContain('x()');
  });

  it('extractImageFromRSSItem prefers media:content image url', () => {
    const url = extractImageFromRSSItem({
      'media:content': [{ '@_url': 'https://x/img.jpg', '@_medium': 'image' }],
    });
    expect(url).toBe('https://x/img.jpg');
  });

  it('extractImageFromRSSItem falls back to first <img> in content', () => {
    const url = extractImageFromRSSItem({
      'content:encoded': 'text <img src="https://y/pic.png"/> more',
    });
    expect(url).toBe('https://y/pic.png');
  });

  it('extractImageFromRSSItem returns null when no image', () => {
    expect(
      extractImageFromRSSItem({ description: 'no images here' }),
    ).toBeNull();
  });
});

// ── TTS preprocessing (drives expressive audio + word alignment) ────────────
describe('TTS preprocessing', () => {
  it('prepends the emotion markup matching the hint', () => {
    expect(preprocessTextForTTS('Hello there', 'angry')).toMatch(/^\[angry\] /);
    expect(preprocessTextForTTS('Hello there', 'laughing')).toMatch(
      /^\[laughing\] /,
    );
  });

  it('neutral hint adds no leading emotion markup', () => {
    const out = preprocessTextForTTS('A plain factual sentence.', 'neutral');
    expect(out.startsWith('[')).toBe(false);
  });

  it('emphasizes keywords with asterisks', () => {
    expect(preprocessTextForTTS('This is breaking news', 'neutral')).toContain(
      '*breaking*',
    );
  });

  it('createWordIndexMapping skips markup, maps real words to originals', () => {
    const original = 'breaking news today';
    const processed = preprocessTextForTTS(original, 'angry'); // "[angry] *breaking* news today"
    const mapping = createWordIndexMapping(original, processed);
    const mapped = mapping.filter((m) => m.originalIdx !== null);
    // Every original word is represented exactly once.
    expect(mapped.length).toBe(original.split(/\s+/).length);
    expect(mapped.map((m) => m.originalWord)).toEqual([
      'breaking',
      'news',
      'today',
    ]);
    // The leading [angry] tag maps to null (skipped).
    expect(mapping[0]!.originalIdx).toBeNull();
  });
});
