/**
 * Shared Podcast Module
 *
 * Provides unified logic for podcast rendering used by both:
 * - Client (PodcastCameraController, PodcastMoodEngine, usePodcastPlayer)
 * - Server (PodcastVideoExporter)
 */

// Easing functions
export { lerp, lerpPosition, sigmoidEase } from './PodcastEasing';

// Camera presets and constants
export {
  AVATAR_HEIGHT,
  CAMERA_PRESETS,
  CLOSEUP_CAMERA_FOV,
  DEFAULT_CAMERA_FOV,
  HOST1_POSITION,
  HOST2_POSITION,
  MIN_SEGMENT_DURATION_FOR_CAMERA_SWITCH,
  TRANSITION_SPEED_FAST,
  TRANSITION_SPEED_NORMAL,
  TRANSITION_SPEED_SLOW,
  getCameraFOV,
  getCameraPreset,
  getHostCloseupFocus,
  getHostFocus,
  getTransitionSpeed,
  type CameraFocus,
  type CameraPreset,
} from './PodcastCameraPresets';

// Content analysis
export {
  detectGestures,
  getAuraForContent,
  getAuraIntensity,
  getAuraSpeed,
  getCameraEnergy,
  getListenerReaction,
  getMoodForContent,
  shouldUseCloseup,
  type CameraEnergy,
  type GestureHint,
  type GestureTiming,
  type GestureType,
  type ListenerReaction,
} from './PodcastContentAnalysis';

// Animation timing
export {
  GESTURE_TIMING,
  REACTION_TIMING,
  calculateGestureTiming,
  calculateReactionTiming,
  calculateSegmentProgress,
  createGestureKey,
  createReactionKey,
  type GestureTimingResult,
  type ReactionTimingResult,
} from './PodcastAnimationTiming';
