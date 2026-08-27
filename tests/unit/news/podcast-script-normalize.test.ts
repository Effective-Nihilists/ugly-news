import { describe, expect, it } from 'vitest';
import {
  ListenerReactionSchema,
  NewsPodcastSchema,
  normalizePodcastScript,
} from '../../../shared/news/schemas';

/**
 * Regression guard for two paired production failures on the same episode
 * (ugly-news v0.1.58, 2026-08-26):
 *
 *   ERROR [schema-drift] db.write:newsPodcast: segments.7.listenerReaction:
 *     Invalid option: expected one of "nod"|"laugh"|"shocked"|"agree"|"empathize"|"bored"
 *   ERROR [schema-drift] db.read:newsPodcast:  segments.7.listenerReaction: (same)
 *
 * The script model invents stage directions outside the enums. `speakerEmotion`
 * was already hardened both ways — normalized at generation time against an
 * allowlist, and `.catch('neutral')` on read — but `listenerReaction`,
 * `cameraShot`, `cameraEnergy`, `gestureHint` and `nonVerbalCue` were passed
 * through with only `?? default`, which catches null/undefined and nothing else.
 * So a bad value was written AND the resulting row could not be read back.
 *
 * Both halves are needed: normalization stops new bad rows, `.catch` makes the
 * rows already in D1 loadable.
 */
describe('normalizePodcastScript — the write side', () => {
  const raw = {
    title: 'Episode',
    segments: [
      {
        speaker: 'HOST1',
        text: 'Straight read.',
        articleRef: 'file1',
        cameraShot: 'normal',
        cameraEnergy: 'normal',
        listenerReaction: 'nod',
        speakerEmotion: 'neutral',
        nonVerbalCue: null,
      },
      {
        speaker: 'HOST2',
        text: 'Snark.',
        articleRef: null,
        // Every one of these is off-enum — exactly what segment 7 carried.
        cameraShot: 'wide',
        cameraEnergy: 'frantic',
        listenerReaction: 'smile',
        speakerEmotion: 'smug',
        nonVerbalCue: 'gasp',
        gestureHint: { gesture: 'wave', timing: 'whenever' },
      },
    ],
  };

  it('keeps the valid segment untouched', () => {
    const script = normalizePodcastScript(raw);
    expect(script.segments[0]).toMatchObject({
      speaker: 'HOST1',
      cameraShot: 'normal',
      cameraEnergy: 'normal',
      listenerReaction: 'nod',
      speakerEmotion: 'neutral',
    });
  });

  it('coerces every off-enum stage direction to a safe default', () => {
    const seg = normalizePodcastScript(raw).segments[1]!;
    expect(seg.listenerReaction).toBe('nod');
    expect(seg.cameraShot).toBe('normal');
    expect(seg.cameraEnergy).toBe('normal');
    expect(seg.speakerEmotion).toBe('neutral');
    expect(seg.nonVerbalCue).toBeUndefined();
    expect(seg.gestureHint).toBeUndefined();
  });

  it('produces only values the persisted schema accepts', () => {
    for (const seg of normalizePodcastScript(raw).segments) {
      expect(
        ListenerReactionSchema.safeParse(seg.listenerReaction).success,
      ).toBe(true);
    }
  });

  it('keeps the text and speaker the model actually wrote', () => {
    const script = normalizePodcastScript(raw);
    expect(script.title).toBe('Episode');
    expect(script.segments.map((s) => s.text)).toEqual([
      'Straight read.',
      'Snark.',
    ]);
    expect(script.segments.map((s) => s.speaker)).toEqual(['HOST1', 'HOST2']);
  });

  it('rejects a reply that is not a script at all', () => {
    expect(() => normalizePodcastScript({ nope: true })).toThrow();
    expect(() => normalizePodcastScript({ title: 'x', segments: [] })).toThrow();
  });

  it('defaults an unknown speaker rather than losing the segment', () => {
    const script = normalizePodcastScript({
      title: 'Episode',
      segments: [{ speaker: 'NARRATOR', text: 'Hi', articleRef: null }],
    });
    expect(script.segments).toHaveLength(1);
    expect(script.segments[0]!.speaker).toBe('HOST1');
  });
});

describe('newsPodcast schema — the read side', () => {
  // The bad row is already in D1. Reading it must not fail the whole episode.
  const row = {
    _id: 'p1',
    date: '2026-08-26',
    title: 'Episode',
    description: 'The Daily Ugly',
    userId: null,
    host1BotId: 'b1',
    host2BotId: 'b2',
    articles: [],
    generationStatus: 'complete',
    generationError: null,
    generatedAt: 1787000000000,
    segments: [
      {
        speakerId: 'b1',
        speakerName: 'Sarah',
        text: 'Hello',
        startTimeMs: 0,
        endTimeMs: 1000,
        listenerReaction: 'smile',
        cameraShot: 'wide',
        cameraEnergy: 'frantic',
        speakerEmotion: 'smug',
        nonVerbalCue: 'gasp',
        gestureHint: { gesture: 'wave', timing: 'whenever' },
      },
    ],
    audioUri: 'https://example.test/a.wav',
    durationMs: 1000,
    visemes: [],
    subtitles: [],
  };

  it('loads a row whose stage directions drifted off-enum', () => {
    const parsed = NewsPodcastSchema.safeParse(row);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('reads the drifted directions back as the safe defaults', () => {
    const seg = NewsPodcastSchema.parse(row).segments[0]!;
    expect(seg.listenerReaction).toBe('nod');
    expect(seg.cameraShot).toBe('normal');
    expect(seg.cameraEnergy).toBe('normal');
    expect(seg.speakerEmotion).toBe('neutral');
    expect(seg.nonVerbalCue).toBeUndefined();
    expect(seg.gestureHint).toBeUndefined();
  });
});
