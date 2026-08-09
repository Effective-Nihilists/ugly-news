import { describe, expect, it } from 'vitest';
import type { FileMarkdown } from '../../../shared/collections';
import {
  buildPodcastScriptPrompt,
  type PodcastClusterCtx,
} from '../../../server/news/podcast-generate';

// Regression guard for the daily podcast outage: the three-act ("Daily Ugly")
// prompt branch shipped without the segment-directive list OR the
// "OUTPUT JSON ONLY" contract, so gpt_4o answered with a markdown script.
// `generatePodcastScript` looks for a `{...}` blob, found none, and every
// episode since died with "Script generation failed after 5 attempts: Failed
// to parse script JSON". Both branches must carry the same output contract.

const HOST1 = { name: 'Sarah', voiceId: 'inworld-Sarah' };
const HOST2 = { name: 'Ugly Bot', voiceId: 'inworld-Theodore' };

function file(id: string): FileMarkdown & { _id: string } {
  return {
    _id: id,
    type: 'markdown',
    title: `Story ${id}`,
    markdown: 'Something happened somewhere to someone.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function cluster(id: string): PodcastClusterCtx {
  return {
    file: file(id),
    title: `Cluster ${id}`,
    neutralSummary: 'A neutral account of the story.',
    framingSummary: 'Left says one thing, right says another.',
    breakdown: {
      leftPct: 33,
      centerPct: 34,
      rightPct: 33,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    blindspotSide: null,
  };
}

/** The parse step `generatePodcastScript` runs on the model's reply. */
function extractsScript(text: string): boolean {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return false;
  try {
    JSON.parse(m[0]);
    return true;
  } catch {
    return false;
  }
}

describe('buildPodcastScriptPrompt', () => {
  const branches: [string, string][] = [
    [
      'three-act (>=3 clusters)',
      buildPodcastScriptPrompt([file('f1')], HOST1, HOST2, [
        cluster('c1'),
        cluster('c2'),
        cluster('c3'),
      ]),
    ],
    [
      'roast fallback (<3 clusters)',
      buildPodcastScriptPrompt([file('f1'), file('f2')], HOST1, HOST2, [
        cluster('c1'),
      ]),
    ],
  ];

  for (const [label, prompt] of branches) {
    describe(label, () => {
      it('states the JSON-only output contract', () => {
        expect(prompt).toContain('OUTPUT JSON ONLY');
      });

      it('carries a parseable example of the expected script shape', () => {
        const example = prompt.slice(prompt.indexOf('OUTPUT JSON ONLY'));
        expect(extractsScript(example)).toBe(true);
      });

      it('specifies every per-segment direction the assembler reads', () => {
        for (const field of [
          'cameraShot',
          'cameraEnergy',
          'listenerReaction',
          'gestureHint',
          'speakerEmotion',
          'nonVerbalCue',
          'articleRef',
          'speaker',
        ]) {
          expect(prompt).toContain(field);
        }
      });

      it('never ends on a dangling instruction', () => {
        expect(prompt.trimEnd().endsWith('For EVERY segment include:')).toBe(
          false,
        );
      });
    });
  }

  it('uses the three-act structure only when there are enough clusters', () => {
    const [, threeAct] = branches[0]!;
    const [, roast] = branches[1]!;
    expect(threeAct).toContain('THE RUNDOWN');
    expect(roast).not.toContain('THE RUNDOWN');
  });
});
