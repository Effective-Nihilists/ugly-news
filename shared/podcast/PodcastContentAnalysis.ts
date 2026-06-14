/**
 * PodcastContentAnalysis - Unified content analysis for podcast rendering
 *
 * Provides single source of truth for:
 * - Mood detection (emotional state of content)
 * - Aura selection (particle effects based on content)
 * - Camera energy (transition speed based on content)
 * - Close-up detection (dramatic moment identification)
 * - Listener reaction detection (how non-speaking host should react)
 *
 * Used by both client and server for consistent behavior.
 */

import { Mood } from 'ugly-app/three/client';
import { ParticleAuraType } from 'ugly-app/three/client';

// ============================================================================
// Types
// ============================================================================

/** Camera transition energy level */
export type CameraEnergy = 'fast' | 'normal' | 'slow';

/** Listener reaction types for non-speaking host */
export type ListenerReaction =
  | 'nod'
  | 'laugh'
  | 'shocked'
  | 'agree'
  | 'empathize'
  | 'bored';

/** Gesture hint types for avatar animations */
export type GestureType =
  | 'handup'
  | 'shrug'
  | 'index'
  | 'thumbup'
  | 'thumbdown'
  | 'ok'
  | 'side'
  | 'namaste';

/** Gesture timing within segment */
export type GestureTiming = 'start' | 'mid' | 'end';

export interface GestureHint {
  gesture: GestureType;
  timing: GestureTiming;
}

// ============================================================================
// Keyword Mappings (Merged from client and server)
// ============================================================================

/**
 * Combined mood keywords from both client PodcastMoodEngine.ts and server PodcastVideoExporter.ts
 */
const moodKeywords: Record<Mood, string[]> = {
  happy: [
    // From client
    'amazing',
    'incredible',
    'fantastic',
    'love',
    'great',
    'awesome',
    'wonderful',
    'excellent',
    'brilliant',
    'haha',
    'lol',
    'hilarious',
    'exciting',
    'celebrate',
    // Additional from server and common usage
    'congratulations',
    'success',
    'winner',
    'victory',
    'joy',
    'delighted',
    'thrilled',
    'ecstatic',
  ],
  angry: [
    // From client
    'outrageous',
    'disgraceful',
    'furious',
    'unacceptable',
    'disgusting',
    'terrible',
    'awful',
    'horrible',
    'pathetic',
    'infuriating',
    'ridiculous',
    // From server
    'outrage',
    'scandal',
    'slams',
    'attacks',
    'anger',
    'war',
    'fight',
  ],
  sad: [
    // From client
    'tragedy',
    'devastating',
    'heartbreaking',
    'unfortunately',
    'sad',
    'depressing',
    'died',
    'death',
    'loss',
    'grief',
    // From server
    'tragic',
    'passed away',
    'mourning',
    'somber',
  ],
  fear: [
    // From client (includes surprised expressions since 'surprised' is not a valid Mood)
    'terrifying',
    'scary',
    'frightening',
    'alarming',
    'worried',
    'concerning',
    'dangerous',
    'threat',
    'shocking',
    'unbelievable',
    'holy',
    'wow',
    'no way',
    'seriously',
    'insane',
    'crazy',
    'mind-blowing',
    'wait what',
    'are you kidding',
    // From server
    'horror',
    'warning',
    'danger',
  ],
  disgust: [
    // From client
    'gross',
    'disgusting',
    'vile',
    'repulsive',
    'nauseating',
    'sickening',
    'revolting',
    // From server
    'disturbing',
  ],
  love: [
    // From client
    'adorable',
    'sweet',
    'heartwarming',
    'touching',
    'beautiful',
    // From server
    'wedding',
    'romance',
    'romantic',
    'couple',
    'wholesome',
  ],
  sleep: [], // Not used in podcast context
  neutral: [],
};

/**
 * Keywords for gesture detection
 */
const gestureKeywords: Record<GestureType, string[]> = {
  handup: [
    'wait',
    'hold on',
    'stop',
    'listen',
    'point',
    'emphasis',
    'important',
    'pay attention',
  ],
  shrug: [
    'who knows',
    "don't ask me",
    'apparently',
    'whatever',
    "i don't know",
    'guess',
    'maybe',
  ],
  index: [
    'look at this',
    'check this out',
    'here',
    'this is',
    'right here',
    'see this',
  ],
  thumbup: ['great job', 'well done', 'nice', 'approve', 'agree'],
  thumbdown: ['bad', 'terrible', 'disapprove', 'disagree', 'no good'],
  ok: ['okay', 'alright', 'fine', 'sure', 'got it'],
  side: ['over there', 'on the side', 'beside'],
  namaste: ['thank', 'grateful', 'appreciate', 'bless'],
};

/**
 * Keywords for particle aura selection
 */
const auraKeywords: Record<Exclude<ParticleAuraType, 'none'>, string[]> = {
  fire: [
    'outrage',
    'scandal',
    'furious',
    'anger',
    'controversial',
    'heated',
    'slams',
    'attacks',
    'war',
    'fight',
    'explosive',
    'rage',
  ],
  hearts: [
    'love',
    'wedding',
    'romance',
    'heart',
    'adorable',
    'sweet',
    'wholesome',
    'couple',
    'romantic',
    'relationship',
  ],
  stars: [
    'celebrity',
    'star',
    'famous',
    'award',
    'winner',
    'hollywood',
    'grammy',
    'oscar',
    'red carpet',
    'premiere',
  ],
  energy: [
    'breaking',
    'urgent',
    'exclusive',
    'shocking',
    'incredible',
    'amazing',
    'just in',
    'alert',
    'live',
  ],
  ice: [
    'disappointing',
    'failed',
    'disaster',
    'cold',
    'harsh',
    'brutal',
    'freeze',
    'frozen',
  ],
  sparkle: [
    'celebrate',
    'congratulations',
    'success',
    'wonderful',
    'fantastic',
    'brilliant',
    'achievement',
    'milestone',
  ],
  ethereal: [], // Default aura, no specific keywords
};

/**
 * Keywords for camera energy (transition speed)
 */
const energyKeywords = {
  fast: [
    'breaking',
    'urgent',
    'exclusive',
    'just in',
    'incredible',
    'alert',
    'live',
    'developing',
  ],
  slow: [
    'tragic',
    'devastating',
    'heartbreaking',
    'emotional',
    'serious',
    'somber',
    'memorial',
    'tribute',
  ],
};

/**
 * Keywords for close-up detection
 */
const closeupKeywords = [
  'shocking',
  'unbelievable',
  'incredible',
  'devastating',
  'breaking',
  'exclusive',
  'reveal',
  'confession',
  'secret',
  'scandal',
  'bombshell',
];

/**
 * Keywords for listener reactions
 */
const reactionKeywords: Record<ListenerReaction, string[]> = {
  laugh: [
    'hilarious',
    'funny',
    'joke',
    'ridiculous',
    'absurd',
    'laughed',
    'haha',
    'lol',
    'comedy',
  ],
  shocked: [
    'shocking',
    'unbelievable',
    'incredible',
    'no way',
    'can you believe',
    'what',
    'seriously',
  ],
  empathize: [
    'tragic',
    'sad',
    'heartbreaking',
    'devastating',
    'loss',
    'grief',
    'mourning',
  ],
  agree: [
    'exactly',
    'absolutely',
    'great',
    'amazing',
    'wonderful',
    'right',
    'true',
    'indeed',
  ],
  nod: [], // Default engaged reaction
  bored: [], // Fallback when no content
};

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Check if text contains any keyword from a list.
 */
function containsAnyKeyword(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((keyword) => lowerText.includes(keyword));
}

/**
 * Detect the mood from text content.
 * Uses merged keywords from client and server implementations.
 *
 * @param text The text to analyze
 * @returns The detected mood
 */
export function getMoodForContent(text: string): Mood {
  const lowerText = text.toLowerCase();

  // Check angry first (high priority for controversy)
  if (containsAnyKeyword(lowerText, moodKeywords.angry)) {
    return 'angry';
  }

  // Check sad
  if (containsAnyKeyword(lowerText, moodKeywords.sad)) {
    return 'sad';
  }

  // Check love
  if (containsAnyKeyword(lowerText, moodKeywords.love)) {
    return 'love';
  }

  // Check fear/surprised
  if (containsAnyKeyword(lowerText, moodKeywords.fear)) {
    return 'fear';
  }

  // Check disgust
  if (containsAnyKeyword(lowerText, moodKeywords.disgust)) {
    return 'disgust';
  }

  // Check happy (positive content)
  if (containsAnyKeyword(lowerText, moodKeywords.happy)) {
    return 'happy';
  }

  // Check punctuation patterns
  if (text.includes('?!') || text.includes('!?')) {
    return 'fear'; // Surprised/excited expression
  }

  if (text.includes('!')) {
    const exclamationCount = (text.match(/!/g) ?? []).length;
    if (exclamationCount >= 2) {
      return 'happy';
    }
  }

  // Default to happy for positive/neutral delivery
  return 'happy';
}

/**
 * Detect the particle aura type from text content.
 *
 * @param text The text to analyze
 * @returns The particle aura type
 */
export function getAuraForContent(text: string): ParticleAuraType {
  const lowerText = text.toLowerCase();

  // Fire - controversy, anger, heated topics
  if (containsAnyKeyword(lowerText, auraKeywords.fire)) {
    return 'fire';
  }

  // Hearts - love, relationships, feel-good stories
  if (containsAnyKeyword(lowerText, auraKeywords.hearts)) {
    return 'hearts';
  }

  // Stars - celebrity, fame, achievement
  if (containsAnyKeyword(lowerText, auraKeywords.stars)) {
    return 'stars';
  }

  // Energy - breaking news, excitement, urgency
  if (containsAnyKeyword(lowerText, auraKeywords.energy)) {
    return 'energy';
  }

  // Ice - cold takes, harsh criticism, disappointment
  if (containsAnyKeyword(lowerText, auraKeywords.ice)) {
    return 'ice';
  }

  // Sparkle - positive news, celebrations
  if (containsAnyKeyword(lowerText, auraKeywords.sparkle)) {
    return 'sparkle';
  }

  // Default to ethereal for neutral content
  return 'ethereal';
}

/**
 * Detect the camera energy (transition speed) from text content.
 *
 * @param text The text to analyze
 * @returns The camera energy level
 */
export function getCameraEnergy(text: string): CameraEnergy {
  const lowerText = text.toLowerCase();

  // Fast - urgent, breaking, exciting
  if (containsAnyKeyword(lowerText, energyKeywords.fast)) {
    const matchedKeyword = energyKeywords.fast.find((kw) =>
      lowerText.includes(kw),
    );
    console.debug('[Podcast Content] Camera energy: fast', { matchedKeyword });
    return 'fast';
  }

  // Slow - dramatic, emotional, serious
  if (containsAnyKeyword(lowerText, energyKeywords.slow)) {
    const matchedKeyword = energyKeywords.slow.find((kw) =>
      lowerText.includes(kw),
    );
    console.debug('[Podcast Content] Camera energy: slow', { matchedKeyword });
    return 'slow';
  }

  console.debug(
    '[Podcast Content] Camera energy: normal (no keywords matched)',
  );
  return 'normal';
}

/**
 * Detect if segment content warrants a close-up shot.
 *
 * @param text The text to analyze
 * @returns True if close-up should be used
 */
export function shouldUseCloseup(text: string): boolean {
  const lowerText = text.toLowerCase();
  const matchedKeyword = closeupKeywords.find((kw) => lowerText.includes(kw));
  const result = matchedKeyword !== undefined;
  console.debug('[Podcast Content] Close-up check', {
    shouldUseCloseup: result,
    matchedKeyword: matchedKeyword ?? null,
  });
  return result;
}

/**
 * Detect the listener reaction type from speaker content.
 *
 * @param text The text to analyze
 * @returns The listener reaction type
 */
export function getListenerReaction(text: string): ListenerReaction {
  const lowerText = text.toLowerCase();

  // Laugh for humor
  if (containsAnyKeyword(lowerText, reactionKeywords.laugh)) {
    const matchedKeyword = reactionKeywords.laugh.find((kw) =>
      lowerText.includes(kw),
    );
    console.debug('[Podcast Content] Listener reaction: laugh', {
      matchedKeyword,
    });
    return 'laugh';
  }

  // Shocked for surprising news
  if (containsAnyKeyword(lowerText, reactionKeywords.shocked)) {
    const matchedKeyword = reactionKeywords.shocked.find((kw) =>
      lowerText.includes(kw),
    );
    console.debug('[Podcast Content] Listener reaction: shocked', {
      matchedKeyword,
    });
    return 'shocked';
  }

  // Empathize for sad content
  if (containsAnyKeyword(lowerText, reactionKeywords.empathize)) {
    const matchedKeyword = reactionKeywords.empathize.find((kw) =>
      lowerText.includes(kw),
    );
    console.debug('[Podcast Content] Listener reaction: empathize', {
      matchedKeyword,
    });
    return 'empathize';
  }

  // Agree for positive/approval content
  if (containsAnyKeyword(lowerText, reactionKeywords.agree)) {
    const matchedKeyword = reactionKeywords.agree.find((kw) =>
      lowerText.includes(kw),
    );
    console.debug('[Podcast Content] Listener reaction: agree', {
      matchedKeyword,
    });
    return 'agree';
  }

  // Nod as default engaged reaction
  console.debug('[Podcast Content] Listener reaction: nod (default)');
  return 'nod';
}

/**
 * Detect gesture hints from text content.
 *
 * @param text The text to analyze
 * @returns Array of gesture hints with timing
 */
export function detectGestures(text: string): GestureHint[] {
  const lowerText = text.toLowerCase();
  const gestures: GestureHint[] = [];

  for (const [gesture, keywords] of Object.entries(gestureKeywords)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        // Determine timing based on keyword position
        const position = lowerText.indexOf(keyword);
        const relativePosition = position / lowerText.length;

        let timing: GestureTiming;
        if (relativePosition < 0.3) {
          timing = 'start';
        } else if (relativePosition > 0.7) {
          timing = 'end';
        } else {
          timing = 'mid';
        }

        gestures.push({ gesture: gesture as GestureType, timing });
        break; // Only one gesture per type
      }
    }
  }

  return gestures;
}

/**
 * Get aura intensity based on aura type.
 * Some auras should be more subtle than others.
 */
export function getAuraIntensity(aura: ParticleAuraType): number {
  switch (aura) {
    case 'ethereal':
      return 0.4; // Subtle ambient effect
    case 'fire':
    case 'energy':
      return 0.7; // More intense for dramatic content
    case 'hearts':
    case 'stars':
    case 'sparkle':
      return 0.6; // Moderate intensity
    case 'ice':
      return 0.5; // Medium intensity
    default:
      return 0.5;
  }
}

/**
 * Get aura animation speed based on aura type.
 */
export function getAuraSpeed(aura: ParticleAuraType): number {
  switch (aura) {
    case 'energy':
      return 1.2; // Faster for energetic effect
    case 'fire':
      return 1.0; // Normal speed
    case 'ice':
      return 0.6; // Slower for cold effect
    default:
      return 0.8;
  }
}
