/**
 * PodcastEasing - Shared easing functions for podcast camera and animations
 *
 * Used by both client (PodcastCameraController) and server (PodcastVideoExporter)
 * for consistent camera motion behavior.
 */

/**
 * Sigmoid easing function for smooth camera transitions.
 * Returns value between 0 and 1 with natural acceleration/deceleration.
 *
 * @param t Progress value (0 to 1)
 * @param steepness Controls the steepness of the S-curve (default: 5)
 * @returns Eased value between 0 and 1
 */
export function sigmoidEase(t: number, steepness = 5): number {
  return 1 / (1 + Math.exp(-steepness * (2 * t - 1)));
}

/**
 * Linear interpolation between two values.
 *
 * @param a Start value
 * @param b End value
 * @param t Progress (0 to 1)
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate between two 3D positions.
 *
 * @param start Start position
 * @param end End position
 * @param t Progress (0 to 1)
 * @returns Interpolated position
 */
export function lerpPosition(
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
    z: lerp(start.z, end.z, t),
  };
}
