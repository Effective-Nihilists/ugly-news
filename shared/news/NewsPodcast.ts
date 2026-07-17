import type { InferDocType, TTSViseme } from 'ugly-app/shared';
import type { ImagePublic } from './schemas';
import { NewsPodcastSchema } from './schemas';

// ============================================================================
// Podcast Types
// ============================================================================

/** Word-level timing for karaoke-style highlighting */
export interface PodcastSubtitleWord {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
}

/** Subtitle entry for captions display during playback */
export interface PodcastSubtitle {
  text: string;
  speakerId: string;
  startTimeMs: number;
  endTimeMs: number;
  words?: PodcastSubtitleWord[] | undefined;
}

/** Gesture hint for avatar animation during segment */
export type PodcastGestureType =
  | 'handup'
  | 'index'
  | 'thumbup'
  | 'shrug'
  | 'side'
  | 'ok'
  | 'thumbdown'
  | 'namaste';

export interface PodcastGestureHint {
  gesture: PodcastGestureType;
  timing: 'start' | 'mid' | 'end';
}

export type PodcastCameraShot = 'normal' | 'closeup';
export type PodcastCameraEnergy = 'fast' | 'normal' | 'slow';

export type PodcastListenerReaction =
  'nod' | 'laugh' | 'shocked' | 'agree' | 'empathize' | 'bored';

/** Speaker emotion for TTS expressiveness (maps to InWorld emotion markups) */
export type PodcastSpeakerEmotion =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'fearful'
  | 'disgusted'
  | 'laughing'
  | 'whispering'
  | 'neutral';

export type PodcastNonVerbalCue = 'breathe' | 'sigh' | 'laugh' | 'chuckle';

/** A segment of the podcast script (one host speaking) */
export interface PodcastSegment {
  speakerId: string;
  speakerName: string;
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  articleRef?: string | undefined;
  gestureHint?: PodcastGestureHint | undefined;
  cameraShot?: PodcastCameraShot | undefined;
  cameraEnergy?: PodcastCameraEnergy | undefined;
  listenerReaction?: PodcastListenerReaction | undefined;
  speakerEmotion?: PodcastSpeakerEmotion | undefined;
  nonVerbalCue?: PodcastNonVerbalCue | undefined;
}

/** Reference to an article discussed in the podcast */
export interface PodcastArticleReference {
  fileId: string;
  title: string;
  imageUri: string | null;
  image: ImagePublic | null;
  startTimeMs: number;
  endTimeMs: number;
}

/** Extended viseme with speaker identification for multi-host podcasts */
export interface PodcastViseme extends TTSViseme {
  speakerId: string;
}

export type PodcastGenerationStatus =
  'pending' | 'generating' | 'complete' | 'failed';

/** Main podcast entity stored in database */
export type NewsPodcast = InferDocType<typeof NewsPodcastSchema>;

// ============================================================================
// API Input/Output Types
// ============================================================================

export interface NewsPodcastGetInput {
  podcastId?: string | undefined;
  date?: string | undefined;
}

export interface NewsPodcastGetOutput {
  podcast: NewsPodcast | null;
}

export interface NewsPodcastListInput {
  limit: number;
  beforeDate?: string | undefined;
}

export interface NewsPodcastListOutput {
  items: NewsPodcast[];
  hasMore: boolean;
}

export type NewsPodcastInitInput = Record<string, never>;

export interface NewsPodcastInitOutput {
  initialized: boolean;
}

export interface NewsPodcastRegenerateInput {
  date?: string | undefined;
  replaceDefault?: boolean | undefined;
}

export interface NewsPodcastRegenerateOutput {
  success: boolean;
  podcastId: string;
}

// ============================================================================
// Public API Types (no auth required)
// ============================================================================

export interface NewsPodcastGetDefaultInput {
  date?: string | undefined;
}

export interface NewsPodcastGetDefaultOutput {
  podcast: NewsPodcast | null;
  host1AvatarUrl: string | null;
  host2AvatarUrl: string | null;
}

export type NewsPodcastRequestsT = 'newsPodcastGetDefault';

export type NewsPodcastFunctionsT =
  | 'newsPodcastGet'
  | 'newsPodcastInit'
  | 'newsPodcastList'
  | 'newsPodcastRegenerate';

// ============================================================================
// Script Generation Types
// ============================================================================

/** Output format from GPT-4 script generation */
export interface PodcastScriptOutput {
  title: string;
  segments: {
    speaker: 'HOST1' | 'HOST2';
    text: string;
    articleRef: string | null;
    gestureHint?: PodcastGestureHint;
    cameraShot?: PodcastCameraShot;
    cameraEnergy?: PodcastCameraEnergy;
    listenerReaction?: PodcastListenerReaction;
    speakerEmotion?: PodcastSpeakerEmotion;
    nonVerbalCue?: PodcastNonVerbalCue;
  }[];
}

// ============================================================================
// Podcast Host Bot IDs
// ============================================================================

export const podcastHost1BotId = 'podcastHost1';
// Note: Host 2 uses uglyBotId from shared/Bot.ts
