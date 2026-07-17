/**
 * PodcastCameraController
 *
 * Manages camera transitions between podcast hosts.
 * Uses spherical interpolation with sigmoid easing for smooth, natural camera motion.
 */

import {
  AVATAR_HEIGHT,
  CAMERA_PRESETS,
  CameraFocus,
  HOST1_POSITION,
  HOST2_POSITION,
  TRANSITION_SPEED_NORMAL,
  getCameraEnergy,
  getTransitionSpeed,
  shouldUseCloseup,
  sigmoidEase,
} from '../../shared/podcast';
import * as THREE from 'three';

// Re-export CameraFocus for external use
export type { CameraFocus };

interface CameraPreset {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface PodcastCameraControllerOptions {
  host1X?: number; // X position of host1 avatar (default: HOST1_POSITION.x)
  host2X?: number; // X position of host2 avatar (default: HOST2_POSITION.x)
  avatarHeight?: number; // Height of avatars (default: AVATAR_HEIGHT)
}

export class PodcastCameraController {
  private camera: THREE.PerspectiveCamera;
  private presets: Record<CameraFocus, CameraPreset>;
  private currentTarget: THREE.Vector3;

  // Animation state
  private cameraStart: THREE.Vector3;
  private cameraEnd: THREE.Vector3;
  private targetStart: THREE.Vector3;
  private targetEnd: THREE.Vector3;
  private animationClock = 0;
  private transitionDuration = TRANSITION_SPEED_NORMAL;
  private isAnimating = false;

  // Current focus
  private currentFocus: CameraFocus = 'wide';

  constructor(
    camera: THREE.PerspectiveCamera,
    options: PodcastCameraControllerOptions = {},
  ) {
    this.camera = camera;

    // Use shared constants with optional overrides
    const host1X = options.host1X ?? HOST1_POSITION.x;
    const host2X = options.host2X ?? HOST2_POSITION.x;
    const avatarHeight = options.avatarHeight ?? AVATAR_HEIGHT;

    // Convert shared presets to THREE.Vector3 format
    this.presets = {} as Record<CameraFocus, CameraPreset>;
    for (const [key, preset] of Object.entries(CAMERA_PRESETS)) {
      // Adjust positions based on actual host positions if different from defaults
      const xOffset = key.startsWith('host1')
        ? host1X - HOST1_POSITION.x
        : key.startsWith('host2')
          ? host2X - HOST2_POSITION.x
          : 0;
      const heightScale = avatarHeight / AVATAR_HEIGHT;

      this.presets[key as CameraFocus] = {
        position: new THREE.Vector3(
          preset.position.x + xOffset,
          preset.position.y * heightScale,
          preset.position.z,
        ),
        target: new THREE.Vector3(
          preset.target.x + xOffset,
          preset.target.y * heightScale,
          preset.target.z,
        ),
      };
    }

    // Initialize camera to wide shot
    this.cameraStart = this.presets.wide.position.clone();
    this.cameraEnd = this.presets.wide.position.clone();
    this.targetStart = this.presets.wide.target.clone();
    this.targetEnd = this.presets.wide.target.clone();
    this.currentTarget = this.presets.wide.target.clone();

    // Set initial camera position
    this.camera.position.copy(this.presets.wide.position);
    this.camera.lookAt(this.currentTarget);
  }

  /**
   * Set camera focus to a specific preset
   * @param focus The focus target ('host1', 'host2', 'host1-closeup', 'host2-closeup', or 'wide')
   * @param transitionMs Duration of transition in milliseconds (default: TRANSITION_SPEED_NORMAL)
   */
  setFocus(focus: CameraFocus, transitionMs?: number): void {
    if (focus === this.currentFocus && !this.isAnimating) {
      console.debug('[Podcast Camera] Already at focus, skipping', { focus });
      return; // Already at this focus, no transition needed
    }

    const preset = this.presets[focus];
    if (!preset) {
      console.debug('[Podcast Camera] Invalid preset', { focus });
      return;
    }

    console.debug('[Podcast Camera] Setting focus', {
      from: this.currentFocus,
      to: focus,
      transitionMs: transitionMs ?? TRANSITION_SPEED_NORMAL,
    });

    // Store current position as start
    this.cameraStart = this.camera.position.clone();
    this.cameraEnd = preset.position.clone();
    this.targetStart = this.currentTarget.clone();
    this.targetEnd = preset.target.clone();

    // Reset animation clock
    this.animationClock = 0;
    this.transitionDuration = transitionMs ?? TRANSITION_SPEED_NORMAL;
    this.isAnimating = true;
    this.currentFocus = focus;
  }

  /**
   * Set camera focus based on content analysis (legacy - uses keyword detection)
   * Automatically determines close-up vs normal shot and transition speed
   * @param speakerHost 'host1' or 'host2'
   * @param text The segment text for content analysis
   * @deprecated Use setFocusFromScript instead
   */
  setFocusForContent(speakerHost: 'host1' | 'host2', text: string): void {
    // Determine if close-up is warranted based on content
    const useCloseup = shouldUseCloseup(text);
    const focus: CameraFocus = useCloseup
      ? speakerHost === 'host1'
        ? 'host1-closeup'
        : 'host2-closeup'
      : speakerHost;

    // Determine transition speed based on content energy
    const energy = getCameraEnergy(text);
    const transitionSpeed = getTransitionSpeed(energy);

    console.debug('[Podcast Camera] Content analysis', {
      speakerHost,
      useCloseup,
      focus,
      energy,
      transitionSpeed,
      textPreview: text.slice(0, 50) + '...',
    });

    this.setFocus(focus, transitionSpeed);
  }

  /**
   * Set camera focus using script-generated directions
   * @param speakerHost 'host1' or 'host2'
   * @param cameraShot 'normal' or 'closeup' from script
   * @param cameraEnergy 'fast', 'normal', or 'slow' from script
   */
  setFocusFromScript(
    speakerHost: 'host1' | 'host2',
    cameraShot: 'normal' | 'closeup',
    cameraEnergy: 'fast' | 'normal' | 'slow',
  ): void {
    // Determine focus based on script direction
    const focus: CameraFocus =
      cameraShot === 'closeup'
        ? speakerHost === 'host1'
          ? 'host1-closeup'
          : 'host2-closeup'
        : speakerHost;

    // Get transition speed from script energy
    const transitionSpeed = getTransitionSpeed(cameraEnergy);

    console.debug('[Podcast Camera] Script direction', {
      speakerHost,
      cameraShot,
      cameraEnergy,
      focus,
      transitionSpeed,
    });

    this.setFocus(focus, transitionSpeed);
  }

  /**
   * Get the current camera focus
   */
  getFocus(): CameraFocus {
    return this.currentFocus;
  }

  /**
   * Check if camera is currently animating
   */
  getIsAnimating(): boolean {
    return this.isAnimating;
  }

  /**
   * Update camera position (call each frame)
   * @param deltaTime Time since last frame in milliseconds
   */
  update(deltaTime: number): void {
    if (!this.isAnimating) {
      return;
    }

    this.animationClock += deltaTime;

    if (this.animationClock >= this.transitionDuration) {
      // Animation complete
      this.camera.position.copy(this.cameraEnd);
      this.currentTarget.copy(this.targetEnd);
      this.camera.lookAt(this.currentTarget);
      this.isAnimating = false;
      return;
    }

    // Calculate eased progress using shared sigmoid easing
    const t = this.animationClock / this.transitionDuration;
    const eased = sigmoidEase(t);

    // Interpolate camera position using spherical coordinates for natural arc motion
    const startSpherical = new THREE.Spherical().setFromVector3(
      this.cameraStart,
    );
    const endSpherical = new THREE.Spherical().setFromVector3(this.cameraEnd);

    const currentSpherical = new THREE.Spherical(
      startSpherical.radius +
        eased * (endSpherical.radius - startSpherical.radius),
      startSpherical.phi + eased * (endSpherical.phi - startSpherical.phi),
      startSpherical.theta +
        eased * (endSpherical.theta - startSpherical.theta),
    );
    currentSpherical.makeSafe();

    this.camera.position.setFromSpherical(currentSpherical);

    // Interpolate look-at target linearly
    this.currentTarget.lerpVectors(this.targetStart, this.targetEnd, eased);
    this.camera.lookAt(this.currentTarget);
  }

  /**
   * Update preset positions (e.g., if avatar positions change)
   */
  updatePresets(options: PodcastCameraControllerOptions): void {
    const host1X = options.host1X ?? HOST1_POSITION.x;
    const host2X = options.host2X ?? HOST2_POSITION.x;
    const avatarHeight = options.avatarHeight ?? AVATAR_HEIGHT;

    // Recalculate all presets based on shared definitions with adjustments
    for (const [key, preset] of Object.entries(CAMERA_PRESETS)) {
      const xOffset = key.startsWith('host1')
        ? host1X - HOST1_POSITION.x
        : key.startsWith('host2')
          ? host2X - HOST2_POSITION.x
          : 0;
      const heightScale = avatarHeight / AVATAR_HEIGHT;

      this.presets[key as CameraFocus] = {
        position: new THREE.Vector3(
          preset.position.x + xOffset,
          preset.position.y * heightScale,
          preset.position.z,
        ),
        target: new THREE.Vector3(
          preset.target.x + xOffset,
          preset.target.y * heightScale,
          preset.target.z,
        ),
      };
    }
  }

  /**
   * Immediately snap to a focus without animation
   */
  snapToFocus(focus: CameraFocus): void {
    const preset = this.presets[focus];
    if (!preset) {
      return;
    }

    this.camera.position.copy(preset.position);
    this.currentTarget.copy(preset.target);
    this.camera.lookAt(this.currentTarget);
    this.currentFocus = focus;
    this.isAnimating = false;
  }
}
