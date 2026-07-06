/**
 * PodcastSceneManager
 *
 * Manages a single Three.js scene with multiple avatars for the podcast player.
 * Handles shared rendering, lighting, camera transitions, and visual effects.
 *
 * Features:
 * - Multiple avatar management
 * - Content-reactive camera transitions (close-ups, dynamic speeds)
 * - Post-processing (bloom, vignette)
 */

import { DanceGroup } from 'ugly-app/three/client';
import { AvatarModel, AvatarModelOptions } from 'ugly-app/three/client';
import { PostProcessingManager } from 'ugly-app/three/client';
import { AvatarRoom } from 'ugly-app/three/client';
import { AvatarPosition, LightingOptions } from 'ugly-app/three/client';
import { DynamicCameraController } from 'ugly-app/three/client';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Renderer } from './Renderer';
import {
  CameraFocus,
  PodcastCameraController,
} from './PodcastCameraController';

export interface PodcastSceneManagerOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  pixelRatio?: number;
  /**
   * Whether to use WebGPU renderer (with WebGL fallback).
   * - undefined/false: Use WebGL (default)
   * - true: Use WebGPU if available, fallback to WebGL
   */
  useWebGPU?: boolean;
}

// TalkingHead default values
const DEFAULT_LIGHTING: Required<LightingOptions> = {
  lightAmbientColor: 0xffffff,
  lightAmbientIntensity: 1.4,
  lightDirectColor: 0xffffff,
  lightDirectIntensity: 3,
  lightDirectPhi: 1,
  lightDirectTheta: 2,
  lightSpotColor: 0x3388ff,
  lightSpotIntensity: 0, // Off by default
  lightSpotPhi: 0.1,
  lightSpotTheta: 4,
  lightSpotDispersion: 1,
  environmentIntensity: 0, // IBL disabled by default like TalkingHead
};

// Re-export types for backwards compatibility
export type {
  AvatarPosition,
  LightingOptions,
} from 'ugly-app/three/client';

export class PodcastSceneManager {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;

  // Lighting
  private lightAmbient: THREE.AmbientLight | null = null;
  private lightDirect: THREE.DirectionalLight | null = null;
  private lightSpot: THREE.SpotLight | null = null;
  private environmentTexture: THREE.Texture | null = null;
  private lightingOptions: Required<LightingOptions> = { ...DEFAULT_LIGHTING };

  // Avatar management
  private avatars = new Map<string, AvatarModel>();
  private avatarPositions = new Map<string, AvatarPosition>();

  // Camera controller
  private cameraController: PodcastCameraController | null = null;
  private dynamicCamera: DynamicCameraController | null = null;

  // Song mode room environment
  private songRoom: AvatarRoom | null = null;

  // Visual effects
  private postProcessing: PostProcessingManager | null = null;

  // Animation loop
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private isRunning = false;

  // Dimensions
  private width: number;
  private height: number;

  // Renderer type
  private useWebGPU: boolean;
  isWebGPU = false;

  /**
   * Factory method for creating PodcastSceneManager with WebGPU support.
   * Use this when useWebGPU option is true.
   */
  static async create(
    options: PodcastSceneManagerOptions,
  ): Promise<PodcastSceneManager> {
    const manager = new PodcastSceneManager(options, true); // Skip init
    await manager.initSceneAsync(options.pixelRatio ?? window.devicePixelRatio);
    return manager;
  }

  constructor(options: PodcastSceneManagerOptions, skipInit = false) {
    this.canvas = options.canvas;
    this.width = options.width;
    this.height = options.height;
    this.useWebGPU = options.useWebGPU ?? false;

    if (!skipInit) {
      this.initScene(options.pixelRatio ?? window.devicePixelRatio);
    }
  }

  private initScene(pixelRatio: number): void {
    // Get WebGL2 context
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.error('[PodcastSceneManager] Failed to get WebGL2 context');
      return;
    }

    // Create renderer using shared Renderer class
    // No clearColor - use transparent background so article card can show through
    // The container div provides the dark background color
    this.renderer = new Renderer({
      gl,
      canvas: this.canvas,
      pixelRatio: Math.min(pixelRatio, 2), // Cap at 2x for performance
      width: this.width,
      height: this.height,
      antialias: true,
    });
    // Set clear color with 0 alpha for transparency
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      15, // Narrow FOV for more cinematic look
      this.width / this.height,
      0.1,
      100,
    );

    // Create scene with transparent background
    // This allows the article card (positioned behind with zIndex: -1) to show through
    this.scene = new THREE.Scene();
    this.scene.background = null; // Transparent - container provides the dark background

    // Setup lighting (matches TalkingHead)
    this.setupLighting();

    // Create environment map for reflections (but disable by default like TalkingHead)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.environmentTexture = pmremGenerator.fromScene(
      new RoomEnvironment(),
    ).texture;
    // IBL disabled by default (environmentIntensity = 0)
    this.scene.environment = null;

    // Initialize camera controller
    this.cameraController = new PodcastCameraController(this.camera, {
      host1X: -0.9,
      host2X: 0.9,
      avatarHeight: 1.7,
    });

    // Initialize post-processing effects
    this.postProcessing = new PostProcessingManager();
    this.postProcessing.init(
      this.renderer,
      this.scene,
      this.camera,
      this.width,
      this.height,
    );
    console.log('[PodcastSceneManager] Scene initialized');
  }

  /**
   * Async scene initialization with WebGPU support.
   */
  private async initSceneAsync(pixelRatio: number): Promise<void> {
    // Check if WebGPU is available in the browser
    let webgpuAvailable = false;
    if (this.useWebGPU) {
      const gpu = (
        navigator as { gpu?: { requestAdapter(): Promise<unknown> } }
      ).gpu;
      if (gpu) {
        try {
          const adapter = await gpu.requestAdapter();
          if (adapter) {
            webgpuAvailable = true;
          }
        } catch {
          console.log(
            '[PodcastSceneManager] WebGPU not available, falling back to WebGL',
          );
        }
      }
    }

    if (!webgpuAvailable) {
      // Fall back to WebGL
      this.initScene(pixelRatio);
      return;
    }

    // WebGPU path
    this.isWebGPU = true;
    console.log('[PodcastSceneManager] Using WebGPU renderer');

    // Import WebGPURenderer dynamically using ESM import()
    const threeWebGPU = (await import('three/webgpu')) as unknown as {
      WebGPURenderer: new (options: {
        canvas: HTMLCanvasElement;
        antialias: boolean;
        alpha: boolean;
      }) => THREE.WebGLRenderer & { init: () => Promise<void> };
    };

    // Create WebGPU renderer
    this.renderer = new threeWebGPU.WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });

    // WebGPURenderer requires async initialization
    await (this.renderer as unknown as { init: () => Promise<void> }).init();

    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setPixelRatio(Math.min(pixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      15,
      this.width / this.height,
      0.1,
      100,
    );

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = null;

    // Setup lighting
    this.setupLighting();

    // Skip PMREMGenerator in WebGPU mode - it's not compatible with WebGPU/WebGL2 fallback
    // and can leave the renderer in a corrupted state when it fails
    this.environmentTexture = null;
    this.scene.environment = null;
    console.log('[PodcastSceneManager] Skipping PMREMGenerator in WebGPU mode');

    // Initialize camera controller
    this.cameraController = new PodcastCameraController(this.camera, {
      host1X: -0.9,
      host2X: 0.9,
      avatarHeight: 1.7,
    });

    // Initialize post-processing effects
    // Pass isWebGPU explicitly since renderer.isWebGPURenderer may be unreliable in fallback mode
    this.postProcessing = new PostProcessingManager();
    this.postProcessing.init(
      this.renderer,
      this.scene,
      this.camera,
      this.width,
      this.height,
      true, // isWebGPU - we're in WebGPU mode (even if using WebGL2 fallback)
    );
    // Test render to verify the renderer is working
    this.renderer.render(this.scene, this.camera);
    console.log(
      '[PodcastSceneManager] Scene initialized with WebGPU, test render complete',
    );
    console.log('[PodcastSceneManager] Camera position:', this.camera.position);
    console.log(
      '[PodcastSceneManager] Scene children:',
      this.scene.children.length,
    );
  }

  private setupLighting(): void {
    if (!this.scene) {
      return;
    }

    const opt = this.lightingOptions;

    // Ambient light (like TalkingHead)
    this.lightAmbient = new THREE.AmbientLight(
      new THREE.Color(opt.lightAmbientColor),
      opt.lightAmbientIntensity,
    );
    this.scene.add(this.lightAmbient);

    // Directional light (like TalkingHead)
    this.lightDirect = new THREE.DirectionalLight(
      new THREE.Color(opt.lightDirectColor),
      opt.lightDirectIntensity,
    );
    this.lightDirect.position.setFromSphericalCoords(
      2,
      opt.lightDirectPhi,
      opt.lightDirectTheta,
    );
    this.scene.add(this.lightDirect);

    // Spot light (like TalkingHead)
    this.lightSpot = new THREE.SpotLight(
      new THREE.Color(opt.lightSpotColor),
      opt.lightSpotIntensity,
      0,
      opt.lightSpotDispersion,
    );
    this.lightSpot.position.setFromSphericalCoords(
      2,
      opt.lightSpotPhi,
      opt.lightSpotTheta,
    );
    this.lightSpot.position.add(new THREE.Vector3(0, 1.5, 0));
    this.lightSpot.visible = opt.lightSpotIntensity !== 0;
    this.scene.add(this.lightSpot);
  }

  /**
   * Update lighting options (like TalkingHead.setLighting)
   */
  setLighting(opt: LightingOptions): void {
    // Ambient light
    if (this.lightAmbient) {
      if (opt.lightAmbientColor !== undefined) {
        this.lightAmbient.color.set(new THREE.Color(opt.lightAmbientColor));
        this.lightingOptions.lightAmbientColor = opt.lightAmbientColor;
      }
      if (opt.lightAmbientIntensity !== undefined) {
        this.lightAmbient.intensity = opt.lightAmbientIntensity;
        this.lightAmbient.visible = opt.lightAmbientIntensity !== 0;
        this.lightingOptions.lightAmbientIntensity = opt.lightAmbientIntensity;
      }
    }

    // Directional light
    if (this.lightDirect) {
      if (opt.lightDirectColor !== undefined) {
        this.lightDirect.color.set(new THREE.Color(opt.lightDirectColor));
        this.lightingOptions.lightDirectColor = opt.lightDirectColor;
      }
      if (opt.lightDirectIntensity !== undefined) {
        this.lightDirect.intensity = opt.lightDirectIntensity;
        this.lightDirect.visible = opt.lightDirectIntensity !== 0;
        this.lightingOptions.lightDirectIntensity = opt.lightDirectIntensity;
      }
      if (
        opt.lightDirectPhi !== undefined &&
        opt.lightDirectTheta !== undefined
      ) {
        this.lightDirect.position.setFromSphericalCoords(
          2,
          opt.lightDirectPhi,
          opt.lightDirectTheta,
        );
        this.lightingOptions.lightDirectPhi = opt.lightDirectPhi;
        this.lightingOptions.lightDirectTheta = opt.lightDirectTheta;
      }
    }

    // Spot light
    if (this.lightSpot) {
      if (opt.lightSpotColor !== undefined) {
        this.lightSpot.color.set(new THREE.Color(opt.lightSpotColor));
        this.lightingOptions.lightSpotColor = opt.lightSpotColor;
      }
      if (opt.lightSpotIntensity !== undefined) {
        this.lightSpot.intensity = opt.lightSpotIntensity;
        this.lightSpot.visible = opt.lightSpotIntensity !== 0;
        this.lightingOptions.lightSpotIntensity = opt.lightSpotIntensity;
      }
      if (opt.lightSpotPhi !== undefined && opt.lightSpotTheta !== undefined) {
        this.lightSpot.position.setFromSphericalCoords(
          2,
          opt.lightSpotPhi,
          opt.lightSpotTheta,
        );
        this.lightSpot.position.add(new THREE.Vector3(0, 1.5, 0));
        this.lightingOptions.lightSpotPhi = opt.lightSpotPhi;
        this.lightingOptions.lightSpotTheta = opt.lightSpotTheta;
      }
      if (opt.lightSpotDispersion !== undefined) {
        this.lightSpot.angle = opt.lightSpotDispersion;
        this.lightingOptions.lightSpotDispersion = opt.lightSpotDispersion;
      }
    }

    // Environment map (IBL) intensity
    if (this.scene && opt.environmentIntensity !== undefined) {
      this.lightingOptions.environmentIntensity = opt.environmentIntensity;
      if (opt.environmentIntensity === 0) {
        // Disable environment map completely
        this.scene.environment = null;
      } else if (this.environmentTexture) {
        // Re-enable environment map
        this.scene.environment = this.environmentTexture;
        // Update envMapIntensity on all materials
        this.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
            const materials = Array.isArray((child as THREE.Mesh).material)
              ? ((child as THREE.Mesh).material as THREE.Material[])
              : [(child as THREE.Mesh).material as THREE.Material];
            for (const mat of materials) {
              if (
                mat instanceof THREE.MeshStandardMaterial ||
                mat instanceof THREE.MeshPhysicalMaterial
              ) {
                mat.envMapIntensity = opt.environmentIntensity!;
              }
            }
          }
        });
      }
    }
  }

  /**
   * Get current lighting options
   */
  getLighting(): Required<LightingOptions> {
    return { ...this.lightingOptions };
  }

  /**
   * Add an avatar to the scene
   * @param id Unique identifier for the avatar (e.g., 'host1', 'host2')
   * @param avatarUrl URL to the GLTF/GLB avatar model
   * @param position Position and rotation for the avatar
   */
  async addAvatar(
    id: string,
    avatarUrl: string,
    position: AvatarPosition,
  ): Promise<AvatarModel | null> {
    if (!this.scene) {
      console.error(
        '[PodcastSceneManager] Cannot add avatar - scene not initialized',
      );
      return null;
    }

    // Create avatar options
    const avatarOptions: AvatarModelOptions = {
      scene: this.scene,
      avatarUrl,
      position,
    };

    // Create and load avatar
    const avatar = new AvatarModel(avatarOptions);
    try {
      await avatar.load();

      // Preload dance animations so startDanceLoop() can use them synchronously
      await avatar.preloadCoreAnimations();

      // Disable idle/bored animations during podcast playback
      // Avatar animations are controlled by segment data and visemes instead
      avatar.setIdleLoopEnabled(false);

      this.avatars.set(id, avatar);
      this.avatarPositions.set(id, position);
      console.log(`[PodcastSceneManager] Added avatar: ${id}`);
      return avatar;
    } catch (error) {
      console.error(
        `[PodcastSceneManager] Failed to load avatar ${id}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get an avatar by ID
   */
  getAvatar(id: string): AvatarModel | undefined {
    return this.avatars.get(id);
  }

  /**
   * Focus camera on a specific avatar or show wide shot
   */
  focusCamera(focus: CameraFocus, transitionMs?: number): void {
    this.cameraController?.setFocus(focus, transitionMs);
  }

  /**
   * Start song performance mode on all loaded avatars.
   * Enables dance loops and beat-synced head nodding, matching the video exporter.
   */
  startSongMode(
    bpm: number,
    beatOffsetMs: number,
    danceGroup?: DanceGroup,
    backgroundUrl?: string,
  ): void {
    // Create room environment
    if (this.scene) {
      this.songRoom = new AvatarRoom(this.scene);
      if (backgroundUrl) {
        void this.songRoom.applyTextureFromUrl(backgroundUrl);
      }
      // Skip IBL environment map in song mode — it adds significant extra
      // light that the server renderer doesn't have, making browser much
      // brighter than exported video.
      this.scene.environment = null;
    }

    const avatarList = [...this.avatars.values()];
    if (avatarList.length > 1) {
      const leader = avatarList[0]!;
      const followers = avatarList.slice(1);
      // Start followers first so they're ready to receive sync
      for (const follower of followers) {
        follower.startDanceLoop(danceGroup);
        follower.enableBeatNod(bpm, 0.06, beatOffsetMs);
      }
      // Wire callback, then start leader — its initial dance broadcasts to followers
      leader.syncDanceCallback = (danceId, nextChangeTime) => {
        for (const follower of followers) {
          follower.syncDance(danceId, nextChangeTime);
        }
      };
      leader.startDanceLoop(danceGroup);
      leader.enableBeatNod(bpm, 0.06, beatOffsetMs);
    } else {
      for (const avatar of avatarList) {
        avatar.startDanceLoop(danceGroup);
        avatar.enableBeatNod(bpm, 0.06, beatOffsetMs);
      }
    }
    console.log('[PodcastSceneManager] Song mode started', {
      bpm,
      beatOffsetMs,
    });
  }

  /**
   * Enable reactive dynamic camera for song mode.
   * Tracks avatar bones and adjusts FOV/distance based on movement intensity.
   */
  enableDynamicCamera(): void {
    if (!this.camera) {
      return;
    }
    if (!this.dynamicCamera) {
      this.dynamicCamera = new DynamicCameraController(this.camera);
    }
    // Register all avatars with the controller
    for (const [id, avatar] of this.avatars.entries()) {
      const armature = avatar.getArmature();
      const pos = this.avatarPositions.get(id);
      if (armature && pos) {
        this.dynamicCamera.addAvatar(id, armature, {
          x: pos.x,
          y: pos.y,
          z: pos.z,
        });
      }
    }
    this.dynamicCamera.enable();
  }

  /**
   * Disable reactive dynamic camera (returns to PodcastCameraController).
   */
  disableDynamicCamera(): void {
    this.dynamicCamera?.disable();
  }

  /**
   * Set which avatar the dynamic camera should focus on.
   * Pass null to center between all avatars.
   */
  setDynamicCameraTarget(avatarId: string | null): void {
    this.dynamicCamera?.setActiveAvatar(avatarId);
  }

  /**
   * Focus camera using script-generated directions
   * @param speakerHost 'host1' or 'host2'
   * @param cameraShot 'normal' or 'closeup' from script
   * @param cameraEnergy 'fast', 'normal', or 'slow' from script
   */
  focusCameraFromScript(
    speakerHost: 'host1' | 'host2',
    cameraShot: 'normal' | 'closeup',
    cameraEnergy: 'fast' | 'normal' | 'slow',
  ): void {
    this.cameraController?.setFocusFromScript(
      speakerHost,
      cameraShot,
      cameraEnergy,
    );
  }

  /**
   * Get current camera focus
   */
  getCameraFocus(): CameraFocus {
    return this.cameraController?.getFocus() ?? 'wide';
  }

  /**
   * Enable/disable post-processing effects (currently no-op, effects disabled)
   */
  setPostProcessingEnabled(_enabled: boolean): void {
    // Post-processing effects (bloom, vignette) are disabled
  }

  /**
   * Start the animation loop
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.animate();
    console.log('[PodcastSceneManager] Animation loop started');
  }

  /**
   * Stop the animation loop
   */
  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    console.log('[PodcastSceneManager] Animation loop stopped');
  }

  /**
   * Main animation loop
   */
  private animate = (): void => {
    if (!this.isRunning) {
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.animate);

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // Update camera — dynamic takes priority during song mode
    if (this.dynamicCamera?.isEnabled()) {
      this.dynamicCamera.update(deltaTime);
    } else {
      this.cameraController?.update(deltaTime);
    }

    // Update all avatars
    for (const avatar of this.avatars.values()) {
      avatar.update(deltaTime);
    }

    // Render
    this.render();
  };

  /**
   * Render the scene
   */
  private render(): void {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    // Use post-processing if available, otherwise direct render
    if (this.postProcessing) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handle resize
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    if (this.renderer) {
      this.renderer.setSize(width, height);
    }

    // Resize post-processing
    this.postProcessing?.setSize(width, height);
  }

  /**
   * Clean up and dispose of all resources
   */
  dispose(): void {
    this.stop();

    // Dispose avatars
    for (const avatar of this.avatars.values()) {
      avatar.dispose();
    }
    this.avatars.clear();

    // Dispose song room
    if (this.songRoom) {
      this.songRoom.dispose();
      this.songRoom = null;
    }

    // Dispose post-processing
    if (this.postProcessing) {
      this.postProcessing.dispose();
      this.postProcessing = null;
    }

    // Dispose scene objects
    if (this.scene) {
      this.scene.traverse((object) => {
        if ((object as THREE.Mesh).geometry) {
          (object as THREE.Mesh).geometry.dispose();
        }
        if ((object as THREE.Mesh).material) {
          const material = (object as THREE.Mesh).material;
          if (Array.isArray(material)) {
            material.forEach((m) => { m.dispose(); });
          } else {
            material.dispose();
          }
        }
      });
      this.scene.clear();
      this.scene = null;
    }

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.camera = null;
    this.cameraController = null;

    console.log('[PodcastSceneManager] Disposed');
  }
}
