/**
 * PodcastAnimationTiming - Shared animation timing calculations
 *
 * Provides unified timing logic for gesture triggers, reaction timing,
 * and animation synchronization.
 *
 * Used by both client (usePodcastPlayer) and server (PodcastVideoExporter)
 * for consistent animation behavior.
 */

import { GestureTiming } from './PodcastContentAnalysis';

// ============================================================================
// Types
// ============================================================================

export interface GestureTimingResult {
  /** Whether the gesture should be triggered at this time */
  shouldTrigger: boolean;
  /** Progress through the segment (0 to 1) */
  progress: number;
}

export interface ReactionTimingResult {
  /** Whether a reaction should be triggered at this time */
  shouldTrigger: boolean;
  /** Progress through the segment (0 to 1) */
  progress: number;
}

// ============================================================================
// Timing Constants
// ============================================================================

/** Timing windows for gesture triggers (as percentage of segment duration) */
export const GESTURE_TIMING = {
  start: { min: 0.05, max: 0.15 },
  mid: { min: 0.4, max: 0.6 },
  end: { min: 0.85, max: 0.95 },
} as const;

/** Timing window for listener reactions */
export const REACTION_TIMING = {
  min: 0.25,
  max: 0.35,
} as const;

// ============================================================================
// Timing Functions
// ============================================================================

/**
 * Calculate segment progress (0 to 1) based on current time.
 *
 * @param currentTimeMs Current playback time in milliseconds
 * @param segmentStartMs Segment start time in milliseconds
 * @param segmentEndMs Segment end time in milliseconds
 * @returns Progress value (0 to 1)
 */
export function calculateSegmentProgress(
  currentTimeMs: number,
  segmentStartMs: number,
  segmentEndMs: number,
): number {
  const segmentDuration = segmentEndMs - segmentStartMs;
  if (segmentDuration <= 0) {
    return 0;
  }

  const timeIntoSegment = currentTimeMs - segmentStartMs;
  return Math.max(0, Math.min(1, timeIntoSegment / segmentDuration));
}

/**
 * Determine if a gesture should be triggered at a given time within a segment.
 *
 * @param currentTimeMs Current playback time in milliseconds
 * @param segmentStartMs Segment start time in milliseconds
 * @param segmentEndMs Segment end time in milliseconds
 * @param timing The gesture timing ('start', 'mid', or 'end')
 * @returns Result with shouldTrigger flag and progress value
 */
export function calculateGestureTiming(
  currentTimeMs: number,
  segmentStartMs: number,
  segmentEndMs: number,
  timing: GestureTiming,
): GestureTimingResult {
  const progress = calculateSegmentProgress(
    currentTimeMs,
    segmentStartMs,
    segmentEndMs,
  );

  const timingWindow = GESTURE_TIMING[timing];
  const shouldTrigger =
    progress >= timingWindow.min && progress <= timingWindow.max;

  return { shouldTrigger, progress };
}

/**
 * Determine if a listener reaction should be triggered at a given time.
 *
 * @param currentTimeMs Current playback time in milliseconds
 * @param segmentStartMs Segment start time in milliseconds
 * @param segmentEndMs Segment end time in milliseconds
 * @returns Result with shouldTrigger flag and progress value
 */
export function calculateReactionTiming(
  currentTimeMs: number,
  segmentStartMs: number,
  segmentEndMs: number,
): ReactionTimingResult {
  const progress = calculateSegmentProgress(
    currentTimeMs,
    segmentStartMs,
    segmentEndMs,
  );

  const shouldTrigger =
    progress >= REACTION_TIMING.min && progress <= REACTION_TIMING.max;

  return { shouldTrigger, progress };
}

/**
 * Create a unique key for tracking triggered gestures.
 * Used to prevent re-triggering the same gesture multiple times.
 *
 * @param hostId The host bot ID
 * @param segmentStartMs The segment start time
 * @param gestureType The type of gesture
 * @returns A unique string key
 */
export function createGestureKey(
  hostId: string,
  segmentStartMs: number,
  gestureType: string,
): string {
  return `${hostId}-${segmentStartMs}-${gestureType}`;
}

/**
 * Create a unique key for tracking triggered reactions.
 *
 * @param hostId The host bot ID
 * @param segmentStartMs The segment start time
 * @returns A unique string key
 */
export function createReactionKey(
  hostId: string,
  segmentStartMs: number,
): string {
  return `listener-${hostId}-${segmentStartMs}-reaction`;
}
