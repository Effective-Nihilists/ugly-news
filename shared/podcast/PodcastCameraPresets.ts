/**
 * PodcastCameraPresets - Shared camera configurations for podcast rendering
 *
 * Used by both client (PodcastCameraController) and server (PodcastVideoExporter)
 * for consistent camera positioning and framing.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Camera focus targets for podcast scenes
 */
export type CameraFocus =
  'host1' | 'host2' | 'host1-closeup' | 'host2-closeup' | 'wide';

/**
 * Camera preset configuration
 */
export interface CameraPreset {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number; // Optional FOV override for dramatic effect
}

// ============================================================================
// Constants
// ============================================================================

/** Standard avatar height for camera calculations */
export const AVATAR_HEIGHT = 1.7;

/** Host 1 (left) avatar position */
export const HOST1_POSITION = { x: -0.65, y: 0, z: 0, rotationY: 0.25 };

/** Host 2 (right) avatar position */
export const HOST2_POSITION = { x: 0.65, y: 0, z: 0, rotationY: -0.25 };

/** Minimum segment duration to trigger camera switch (ms) */
// Reduced from 2000ms to enable more frequent camera switches for short interjections
export const MIN_SEGMENT_DURATION_FOR_CAMERA_SWITCH = 800;

/** Camera transition speeds based on content energy */
export const TRANSITION_SPEED_FAST = 250; // Quick cuts for energetic content
export const TRANSITION_SPEED_NORMAL = 500; // Standard transitions (faster for more dynamic feel)
export const TRANSITION_SPEED_SLOW = 800; // Dramatic moments

/** Default camera FOV */
export const DEFAULT_CAMERA_FOV = 15;

/** Close-up camera FOV (tighter framing) */
export const CLOSEUP_CAMERA_FOV = 12;

// ============================================================================
// Camera Presets
// ============================================================================

/**
 * Camera presets for different focus targets.
 * Includes standard shots and dramatic close-ups.
 */
export const CAMERA_PRESETS: Record<CameraFocus, CameraPreset> = {
  // Standard mid shots
  'host1': {
    position: { x: HOST1_POSITION.x + 0.5, y: AVATAR_HEIGHT * 0.75, z: 4.5 },
    target: { x: HOST1_POSITION.x, y: AVATAR_HEIGHT * 0.85, z: 0 },
  },
  'host2': {
    position: { x: HOST2_POSITION.x - 0.5, y: AVATAR_HEIGHT * 0.75, z: 4.5 },
    target: { x: HOST2_POSITION.x, y: AVATAR_HEIGHT * 0.85, z: 0 },
  },
  // Dramatic close-up shots (tighter framing)
  'host1-closeup': {
    position: { x: HOST1_POSITION.x + 0.3, y: AVATAR_HEIGHT * 0.85, z: 3.2 },
    target: { x: HOST1_POSITION.x, y: AVATAR_HEIGHT * 0.9, z: 0 },
    fov: CLOSEUP_CAMERA_FOV,
  },
  'host2-closeup': {
    position: { x: HOST2_POSITION.x - 0.3, y: AVATAR_HEIGHT * 0.85, z: 3.2 },
    target: { x: HOST2_POSITION.x, y: AVATAR_HEIGHT * 0.9, z: 0 },
    fov: CLOSEUP_CAMERA_FOV,
  },
  // Wide establishing shot
  'wide': {
    position: { x: 0, y: AVATAR_HEIGHT * 0.8, z: 7 },
    target: { x: 0, y: AVATAR_HEIGHT * 0.8, z: 0 },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the camera preset for a given focus target.
 */
export function getCameraPreset(focus: CameraFocus): CameraPreset {
  return CAMERA_PRESETS[focus];
}

/**
 * Get the FOV for a given camera preset.
 */
export function getCameraFOV(focus: CameraFocus): number {
  return CAMERA_PRESETS[focus].fov ?? DEFAULT_CAMERA_FOV;
}

/**
 * Get the standard (non-closeup) focus for a host.
 */
export function getHostFocus(isHost1: boolean): CameraFocus {
  return isHost1 ? 'host1' : 'host2';
}

/**
 * Get the closeup focus for a host.
 */
export function getHostCloseupFocus(isHost1: boolean): CameraFocus {
  return isHost1 ? 'host1-closeup' : 'host2-closeup';
}

/**
 * Get the transition speed for a given camera energy level.
 */
export function getTransitionSpeed(energy: 'fast' | 'normal' | 'slow'): number {
  switch (energy) {
    case 'fast':
      return TRANSITION_SPEED_FAST;
    case 'slow':
      return TRANSITION_SPEED_SLOW;
    default:
      return TRANSITION_SPEED_NORMAL;
  }
}
