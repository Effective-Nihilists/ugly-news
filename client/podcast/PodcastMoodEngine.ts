/**
 * PodcastMoodEngine
 *
 * Analyzes podcast segment text to detect appropriate moods and gestures.
 * Used to make avatar animations more dynamic and expressive.
 *
 * Uses shared podcast content analysis for consistent behavior between
 * client and server rendering.
 */

import { ParticleAuraType } from 'ugly-app/three/client';
import { Mood } from 'ugly-app/three/client';
import { PodcastSegment } from '../../shared/news/NewsPodcast';
import {
  getAuraForContent,
  getCameraEnergy,
  getListenerReaction,
  getMoodForContent,
  detectGestures as sharedDetectGestures,
  shouldUseCloseup,
  type CameraEnergy,
  type ListenerReaction,
  type GestureHint as SharedGestureHint,
} from '../../shared/podcast';

export interface MoodHint {
  mood: Mood;
  confidence: number;
}

// Re-export GestureHint from shared for backward compatibility
export type GestureHint = SharedGestureHint;

export interface SegmentAnalysis {
  mood: Mood;
  gestures: GestureHint[];
  // New fields from shared content analysis
  aura: ParticleAuraType;
  cameraEnergy: CameraEnergy;
  useCloseup: boolean;
  listenerReaction: ListenerReaction;
}

export class PodcastMoodEngine {
  /**
   * Analyze a segment and return mood, gesture hints, and new content analysis
   */
  analyzeSegment(segment: PodcastSegment): SegmentAnalysis {
    const text = segment.text;

    // Use shared content analysis for consistent client/server behavior
    const mood = this.detectMood(text);
    const gestures = this.detectGestures(text);
    const aura = getAuraForContent(text);
    const cameraEnergy = getCameraEnergy(text);
    const useCloseup = shouldUseCloseup(text);
    const listenerReaction = getListenerReaction(text);

    return { mood, gestures, aura, cameraEnergy, useCloseup, listenerReaction };
  }

  /**
   * Detect the most appropriate mood for text
   * Uses shared content analysis for consistency with server rendering
   */
  detectMood(text: string): Mood {
    return getMoodForContent(text);
  }

  /**
   * Detect appropriate gestures for text
   * Uses shared content analysis for consistency with server rendering
   */
  detectGestures(text: string): GestureHint[] {
    return sharedDetectGestures(text);
  }

  /**
   * Get the appropriate particle aura for content
   */
  getAura(text: string): ParticleAuraType {
    return getAuraForContent(text);
  }

  /**
   * Get camera energy for transition speed
   */
  getCameraEnergy(text: string): CameraEnergy {
    return getCameraEnergy(text);
  }

  /**
   * Check if content warrants a close-up shot
   */
  shouldUseCloseup(text: string): boolean {
    return shouldUseCloseup(text);
  }

  /**
   * Get appropriate listener reaction for content
   */
  getListenerReaction(text: string): ListenerReaction {
    return getListenerReaction(text);
  }

  /**
   * Determine if a gesture should be triggered at a given time within a segment
   * @param segment The podcast segment
   * @param currentTimeMs Current playback time in milliseconds
   * @returns Gesture name to trigger, or null if no gesture should be triggered
   */
  shouldTriggerGesture(
    segment: PodcastSegment,
    currentTimeMs: number,
  ): string | null {
    const analysis = this.analyzeSegment(segment);

    if (analysis.gestures.length === 0) {
      return null;
    }

    const segmentDuration = segment.endTimeMs - segment.startTimeMs;
    const timeIntoSegment = currentTimeMs - segment.startTimeMs;
    const relativePosition = timeIntoSegment / segmentDuration;

    for (const gestureHint of analysis.gestures) {
      let shouldTrigger = false;

      switch (gestureHint.timing) {
        case 'start':
          // Trigger in first 20% of segment
          shouldTrigger = relativePosition >= 0.05 && relativePosition <= 0.2;
          break;
        case 'mid':
          // Trigger in middle 40% of segment
          shouldTrigger = relativePosition >= 0.3 && relativePosition <= 0.5;
          break;
        case 'end':
          // Trigger in last 20% of segment
          shouldTrigger = relativePosition >= 0.75 && relativePosition <= 0.9;
          break;
      }

      if (shouldTrigger) {
        return gestureHint.gesture;
      }
    }

    return null;
  }

  /**
   * Get a random mood variation for variety
   * Sometimes returns a slightly different mood for visual interest
   */
  getVariedMood(baseMood: Mood): Mood {
    // 80% chance to keep the base mood
    if (Math.random() < 0.8) {
      return baseMood;
    }

    // 20% chance for a related mood variation
    const variations: Partial<Record<Mood, Mood[]>> = {
      happy: ['love', 'neutral'],
      fear: ['happy', 'neutral'],
      angry: ['disgust', 'sad'],
      sad: ['neutral', 'fear'],
    };

    const options = variations[baseMood];
    if (options && options.length > 0) {
      return options[Math.floor(Math.random() * options.length)]!;
    }

    return baseMood;
  }
}
