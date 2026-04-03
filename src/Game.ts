import type { AudioManager } from "@audio/AudioManager";
import type { OrbitFollowCamera } from "@camera/OrbitFollowCamera";
import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import {
  type Disposable,
  type FixedUpdatable,
  type InputState,
  type PostPhysicsUpdatable,
  STATE,
  type Updatable,
} from "@core/types";
import type { ShadowQualityTier, UserSettingsStore } from "@core/UserSettings";
import type { EditorManager } from "@editor/EditorManager";
import type { InputManager, LookState } from "@input/InputManager";
import type { InteractionManager } from "@interaction/InteractionManager";
import { FeedbackPlayer } from "@juice/FeedbackPlayer";
import { FOVPunch } from "@juice/FOVPunch";
import { Hitstop } from "@juice/Hitstop";
import type { LevelManager } from "@level/LevelManager";
import type { ShowcaseStationKey } from "@level/ShowcaseLayout";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import { CheckpointObjectiveSystem } from "@systems/CheckpointObjectiveSystem";
import { DebugRuntimeSystem } from "@systems/DebugRuntimeSystem";
import { InteractableSystem } from "@systems/InteractableSystem";
import { ParticleSystem } from "@systems/ParticleSystem";
import type { UIManager } from "@ui/UIManager";
import type { VehicleManager } from "@vehicle/VehicleManager";
import * as THREE from "three";

// Temp vector for speed calculation
const _prevPos = new THREE.Vector3();
const _currPos = new THREE.Vector3();
const SENSITIVITY_STEP = 0.0002;
const GAMEPAD_DEADZONE_STEP = 0.02;
const GAMEPAD_CURVE_STEP = 0.1;

/**
 * Top-level orchestrator.
 * Wires all systems together and delegates to the game loop.
 */
export class Game implements FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  private speed = 0;
  private prevPlayerPos = new THREE.Vector3();
  private hasSpeedSample = false;
  private _onDebugKeyDown = this.handleDebugKeyDown.bind(this);
  private audioManager: AudioManager;
  private editorManager: EditorManager | null = null;
  private readonly fallRespawnY = -25;
  private isDying = false;
  private unsubs: (() => void)[] = [];

  // Input polling cache (populated once per frame in beginFrame)
  private frameInput: InputState | null = null;
  private frameLook: LookState | null = null;
  /** When set, beginFrame uses this override for N frames (for testing). */
  testInputOverride: InputState | null = null;
  testInputFrames = 0;

  // Debug stats throttle (4 Hz)
  private debugSampleTimer = 0;
  private cachedDebugStats = { physicsMs: 0, drawCalls: 0, triangles: 0, lines: 0, points: 0 };

  // Juice systems
  readonly feedbackPlayer = new FeedbackPlayer();
  readonly hitstop = new Hitstop();
  readonly fovPunch = new FOVPunch();

  // Runtime subsystems
  private systems: RuntimeSystem[] = [];
  private readonly interactableSystem: InteractableSystem;
  private readonly debugSystem: DebugRuntimeSystem;

  constructor(
    private renderer: RendererManager,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    private inputManager: InputManager,
    private levelManager: LevelManager,
    private playerController: PlayerController,
    private camera: OrbitFollowCamera,
    private interactionManager: InteractionManager,
    private uiManager: UIManager,
    private settings: UserSettingsStore,
    private vehicleManager: VehicleManager,
    audioManager: AudioManager,
  ) {
    this.audioManager = audioManager;

    // Wire juice systems
    this.camera.setFOVPunch(this.fovPunch);

    // Create and register subsystems
    this.interactableSystem = new InteractableSystem(
      renderer,
      physicsWorld,
      eventBus,
      interactionManager,
      playerController,
      vehicleManager,
      levelManager,
      uiManager,
    );
    this.registerSystem(this.interactableSystem);

    const particleSystem = new ParticleSystem(renderer, eventBus, playerController, vehicleManager);
    this.registerSystem(particleSystem);

    this.debugSystem = new DebugRuntimeSystem(renderer, physicsWorld, eventBus, levelManager);
    this.registerSystem(this.debugSystem);

    const checkpointSystem = new CheckpointObjectiveSystem(renderer, physicsWorld, eventBus, playerController);
    this.registerSystem(checkpointSystem);

    // Respawn at the midpoint of the iris wipe (screen is black)
    this.unsubs.push(
      this.eventBus.on('player:deathMidpoint', () => {
        this.playerController.respawn();
        this.eventBus.emit('player:respawned', { reason: 'fall' });
        this.isDying = false;
      }),
    );

    // Listen for interact state to trigger interactions
    this.unsubs.push(
      this.eventBus.on("player:stateChanged", ({ current }) => {
        if (current === STATE.interact) {
          this.interactionManager.refreshFocusFromPosition(this.playerController.position);
          this.interactionManager.triggerInteraction();
        }
      }),
      // Camera/juice event handlers (stay in Game)
      this.eventBus.on("player:jumped", ({ airJump }) => {
        if (airJump) {
          this.camera.addTrauma(0.08);
          this.fovPunch.punch(1.5);
        } else {
          this.fovPunch.punch(0.75);
        }
      }),
      this.eventBus.on("player:landed", ({ impactSpeed }) => {
        // Screen shake: scale trauma with fall speed, cap at 0.5
        this.camera.addTrauma(Math.min(0.5, impactSpeed * 0.05));
        // High-impact landings get hitstop + FOV punch
        if (impactSpeed > 5) {
          this.hitstop.trigger(0.05);
          this.fovPunch.punch(3);
        }
      }),
      // Debug event handlers that control the renderer (stay in Game)
      this.eventBus.on("debug:showLightHelpers", (enabled) => {
        this.levelManager.setLightDebugEnabled(enabled);
      }),
      this.eventBus.on("debug:postProcessing", (enabled) => {
        this.renderer.setPostProcessingEnabled(enabled);
      }),
      this.eventBus.on("debug:shadows", (enabled) => {
        this.settings.update({ shadowsEnabled: enabled });
        this.renderer.setShadowsEnabled(enabled);
        this.levelManager.setShadowsEnabled(enabled);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:cameraCollision", (enabled) => {
        this.camera.setCollisionEnabled(enabled);
      }),
      this.eventBus.on("camera:applyConfig", (config) => {
        this.camera.applyCameraConfig(config);
      }),
      this.eventBus.on("camera:resetConfig", () => {
        this.camera.resetCameraConfig();
      }),
      this.eventBus.on("debug:exposure", (value) => {
        this.renderer.setExposure(value);
      }),
      this.eventBus.on("debug:graphicsProfile", ({ profile }) => {
        this.renderer.setGraphicsProfile(profile);
        const flags = this.renderer.getDebugFlags();
        const s = this.settings.update({ graphicsProfile: profile, aaMode: flags.aaMode });
        this.levelManager.setGraphicsProfile(s.graphicsProfile);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:aoOnly", (enabled) => {
        this.renderer.setAoOnlyView(enabled);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:aaMode", ({ mode }) => {
        this.settings.update({ aaMode: mode });
        this.renderer.setAntiAliasingMode(mode);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:ssaoEnabled", (enabled) => {
        this.renderer.setSsaoEnabled(enabled);
      }),
      this.eventBus.on("debug:ssrEnabled", (enabled) => {
        this.renderer.setSsrEnabled(enabled);
      }),
      this.eventBus.on("debug:ssrOpacity", (opacity) => {
        this.renderer.setSsrOpacity(opacity);
      }),
      this.eventBus.on("debug:ssrResolutionScale", (scale) => {
        this.renderer.setSsrResolutionScale(scale);
      }),
      this.eventBus.on("debug:bloomEnabled", (enabled) => {
        this.renderer.setBloomEnabled(enabled);
      }),
      this.eventBus.on("debug:bloomStrength", (strength) => {
        this.renderer.setBloomStrength(strength);
      }),
      this.eventBus.on("debug:vignetteEnabled", (enabled) => {
        this.renderer.setVignetteEnabled(enabled);
      }),
      this.eventBus.on("debug:vignetteDarkness", (darkness) => {
        this.renderer.setVignetteDarkness(darkness);
      }),
      this.eventBus.on("debug:lutEnabled", (enabled) => {
        this.renderer.setLutEnabled(enabled);
      }),
      this.eventBus.on("debug:lutStrength", (strength) => {
        this.renderer.setLutStrength(strength);
      }),
      this.eventBus.on("debug:lutName", (name) => {
        this.renderer.setLutName(name);
      }),
      this.eventBus.on("debug:envBackgroundIntensity", (intensity) => {
        this.renderer.setBackgroundIntensity(intensity);
      }),
      this.eventBus.on("debug:envBackgroundBlurriness", (blurriness) => {
        this.renderer.setBackgroundBlurriness(blurriness);
      }),
      this.eventBus.on("debug:environmentRotation", (rotationDegrees) => {
        this.settings.update({ envRotationDegrees: rotationDegrees });
        this.renderer.setEnvironmentRotationDegrees(rotationDegrees);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:environment", (name) => {
        void this.renderer.setEnvironment(name);
      }),
      this.eventBus.on("debug:shadowQuality", ({ tier }) => {
        const shadowQuality = tier as ShadowQualityTier;
        this.settings.update({ shadowQuality });
        this.renderer.setShadowQualityTier(shadowQuality);
        this.levelManager.setShadowQualityTier(shadowQuality);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:casEnabled", (enabled) => {
        this.settings.update({ casEnabled: enabled });
        this.renderer.setCasEnabled(enabled);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:casStrength", (strength) => {
        this.settings.update({ casStrength: strength });
        this.renderer.setCasStrength(strength);
        this.syncDebugPanel();
      }),
      this.eventBus.on("debug:showShadowFrustums", (enabled) => {
        this.levelManager.setShadowDebugEnabled(enabled);
        this.syncDebugPanel();
      }),
    );
    this.syncDebugPanel();

    // Debug toggle on backtick
    window.addEventListener("keydown", this._onDebugKeyDown);
  }

  registerSystem(system: RuntimeSystem): void {
    this.systems.push(system);
  }

  /** Called once per frame before the fixed-step loop to cache input.
   *  Edge triggers (jumpPressed, etc.) are OR-merged across render frames
   *  so they persist until fixedUpdate consumes them. Without this, high
   *  refresh rates (144Hz+) can drop a jump press that arrives between
   *  physics ticks because a subsequent render-frame poll clears it. */
  beginFrame(dt: number): void {
    if (this.testInputOverride && this.testInputFrames > 0) {
      this.frameInput = this.testInputOverride;
      this.testInputFrames--;
      if (this.testInputFrames <= 0) {
        this.testInputOverride = null;
      }
    } else {
      const fresh = this.inputManager.poll();
      if (this.frameInput) {
        // Merge: keep continuous state from fresh poll, but OR edge triggers
        // so a press that happened in a prior render frame isn't lost.
        this.frameInput = {
          ...fresh,
          jumpPressed: this.frameInput.jumpPressed || fresh.jumpPressed,
          crouchPressed: this.frameInput.crouchPressed || fresh.crouchPressed,
          interactPressed: this.frameInput.interactPressed || fresh.interactPressed,
          primaryPressed: this.frameInput.primaryPressed || fresh.primaryPressed,
        };
      } else {
        this.frameInput = fresh;
      }
    }
    this.frameLook = this.inputManager.pollLook(dt);
  }

  /** Fixed 60Hz tick. */
  fixedUpdate(dt: number): void {
    // Consume cached input from beginFrame. Nulling it ensures edge triggers
    // (jumpPressed etc.) don't re-fire on subsequent substeps in the same frame.
    const input = this.frameInput ?? this.inputManager.poll();
    this.frameInput = null;
    this.playerController.setInput(input);
    this.vehicleManager.setInput(input);
    if (this.vehicleManager.isActive() && input.interactPressed) {
      this.vehicleManager.requestExit();
    }

    // Update dynamic level elements (moving platforms, etc.)
    this.levelManager.fixedUpdate(dt);

    // Interaction detection first -- ensures focus is current before player FSM runs
    this.interactionManager.fixedUpdate(dt);

    // Always tick vehicles: active vehicle control OR parked vehicle behaviors (e.g., drone auto-landing).
    this.vehicleManager.fixedUpdate(dt);

    if (!this.vehicleManager.isActive()) {
      // Feed input + camera yaw to player
      this.playerController.cameraYaw = this.camera.getYaw();
      this.playerController.setLadderZones(this.levelManager.getLadderZones());
      this.playerController.fixedUpdate(dt);
      if (this.playerController.position.y < this.fallRespawnY && !this.isDying) {
        this.isDying = true;
        this.eventBus.emit('player:dying', { reason: 'fall' });
      }
    }
    this.audioManager.fixedUpdate(dt);

    // Tick all registered systems
    for (const system of this.systems) {
      system.fixedUpdate?.(dt);
    }
  }

  /** Runs after each Rapier step so visual sync uses integrated positions. */
  postPhysicsUpdate(dt: number): void {
    if (!this.vehicleManager.isActive()) {
      this.playerController.postPhysicsUpdate(dt);
    }
    this.levelManager.postPhysicsUpdate(dt);
    this.vehicleManager.postPhysicsUpdate(dt);

    // Speed calculation (for debug)
    if (this.vehicleManager.isActive()) {
      this.speed = 0;
      this.hasSpeedSample = false;
    } else {
      _currPos.copy(this.playerController.position);
      if (!this.hasSpeedSample) {
        this.prevPlayerPos.copy(_currPos);
        this.speed = 0;
        this.hasSpeedSample = true;
      } else {
        _prevPos.copy(this.prevPlayerPos);
        const dx = _currPos.x - _prevPos.x;
        const dz = _currPos.z - _prevPos.z;
        this.speed = Math.sqrt(dx * dx + dz * dz) / dt;
        this.prevPlayerPos.copy(_currPos);
      }
    }

    // Tick all registered systems
    for (const system of this.systems) {
      system.postPhysicsUpdate?.(dt);
    }
  }

  /** Render-frame tick. */
  update(dt: number, alpha: number): void {
    if (this.editorManager?.isActive()) {
      this.editorManager.update(dt);
      // Still tick debug system for physics debug view in editor
      this.debugSystem.update?.(dt, alpha);
      this.frameInput = null;
      this.frameLook = null;
      return;
    }
    // Advance feedback effects
    this.feedbackPlayer.update(dt);
    // Update visual interpolation
    if (!this.vehicleManager.isActive()) {
      this.playerController.update(dt, alpha);
    }
    const lightingPos = this.playerController.renderPosition;
    this.levelManager.updateLighting(lightingPos);
    this.levelManager.update(dt, alpha);
    // Always update vehicles (active + parked) so parked drone/vehicles visually follow physics.
    this.vehicleManager.update(dt, alpha);

    // Tick all registered systems
    for (const system of this.systems) {
      system.update?.(dt, alpha);
    }

    // Use cached look deltas from beginFrame
    const look = this.frameLook ?? this.inputManager.pollLook(dt);
    const lookMode = this.vehicleManager.getCameraLookMode();
    this.camera.handleMouseInput(look.lookDX, lookMode === "yawOnly" ? 0 : look.lookDY);
    this.camera.handleZoomInput(look.wheelDelta);

    // Camera follows player (runs every render frame for smoothness)
    this.camera.update(dt, alpha);

    // Debug stats throttled to 4 Hz
    this.debugSampleTimer -= dt;
    if (this.debugSampleTimer <= 0) {
      const renderStats = this.renderer.getRenderStats();
      this.cachedDebugStats.physicsMs = this.physicsWorld.getLastStepMs();
      this.cachedDebugStats.drawCalls = renderStats.drawCalls;
      this.cachedDebugStats.triangles = renderStats.triangles;
      this.cachedDebugStats.lines = renderStats.lines;
      this.cachedDebugStats.points = renderStats.points;
      this.debugSampleTimer = 0.25;
    }

    // Debug panel (frameMs still updates every frame)
    const stateId = this.vehicleManager.isActive() ? "vehicle" : this.playerController.fsm.current;
    const grounded = this.vehicleManager.isActive() ? false : this.playerController.isGrounded;
    this.uiManager.debugPanel.tick(this.speed, stateId, grounded, {
      frameMs: dt * 1000,
      physicsMs: this.cachedDebugStats.physicsMs,
      drawCalls: this.cachedDebugStats.drawCalls,
      triangles: this.cachedDebugStats.triangles,
      lines: this.cachedDebugStats.lines,
      points: this.cachedDebugStats.points,
    });

    // frameInput is consumed by fixedUpdate (set to null there).
    // Do NOT clear it here -- on high-refresh displays, update() runs
    // multiple times between physics ticks, and clearing here would
    // destroy edge triggers before fixedUpdate ever sees them.
    this.frameLook = null;
  }

  /** Push current renderer state to the debug panel. */
  private syncDebugPanel(): void {
    const f = this.renderer.getDebugFlags();
    this.uiManager.debugPanel.syncRenderSettings({
      activeBackend: f.activeBackend,
      postProcessingEnabled: f.postProcessingEnabled,
      shadowsEnabled: f.shadowsEnabled,
      shadowQuality: f.shadowQuality,
      graphicsProfile: f.graphicsProfile,
      envRotationDegrees: f.envRotationDegrees,
      aaMode: f.aaMode,
      aoOnly: f.aoOnly,
      exposure: f.exposure,
      ssaoEnabled: f.ssaoEnabled,
      ssrEnabled: f.ssrEnabled,
      ssrOpacity: f.ssrOpacity,
      ssrResolutionScale: f.ssrResolutionScale,
      bloomEnabled: f.bloomEnabled,
      bloomStrength: f.bloomStrength,
      casEnabled: f.casEnabled,
      casStrength: f.casStrength,
      vignetteEnabled: f.vignetteEnabled,
      vignetteDarkness: f.vignetteDarkness,
      lutEnabled: f.lutEnabled,
      lutStrength: f.lutStrength,
      lutName: f.lutName,
      envName: f.envName,
      shadowFrustums: this.levelManager.getShadowDebugEnabled(),
    });
  }

  setupLevel(): void {
    for (const system of this.systems) {
      system.setupLevel?.();
    }
    // Ambient sci-fi drone sound
    this.audioManager.playMusic(2.0);
  }

  /** Minimal level setup for custom/editor levels -- no procedural showcase content. */
  setupCustomLevel(): void {
    this.interactableSystem.setupCustomLevel();
  }

  /** Setup only the interactables for a single showcase station (debug/test). */
  setupStation(key: ShowcaseStationKey): void {
    this.interactableSystem.setupStation(key);
  }

  teardownLevel(): void {
    for (const system of this.systems) {
      system.teardownLevel?.();
    }
  }

  setEditorManager(manager: EditorManager): void {
    this.editorManager = manager;
    this.debugSystem.setEditorManager(manager);
  }

  private handleDebugKeyDown(e: KeyboardEvent): void {
    if (e.code === "Backquote") {
      this.eventBus.emit("debug:toggle", undefined);
      return;
    }
    if (e.code === "F6") {
      e.preventDefault();
      const cycled = this.settings.cycleGraphicsProfile();
      this.renderer.setGraphicsProfile(cycled.graphicsProfile);
      const flags = this.renderer.getDebugFlags();
      const s = this.settings.update({ aaMode: flags.aaMode });
      this.levelManager.setGraphicsProfile(s.graphicsProfile);
      this.syncDebugPanel();
      console.log(`[Settings] graphicsProfile=${s.graphicsProfile}, aaMode=${s.aaMode}`);
      return;
    }
    if (e.code === "F7") {
      e.preventDefault();
      const s = this.settings.update({ invertY: !this.settings.value.invertY });
      this.camera.setInvertY(s.invertY);
      console.log(`[Settings] invertY=${s.invertY}`);
      return;
    }
    if (e.code === "F8") {
      e.preventDefault();
      const s = this.settings.adjustMouseSensitivity(-SENSITIVITY_STEP);
      this.camera.setMouseSensitivity(s.mouseSensitivity);
      console.log(`[Settings] mouseSensitivity=${s.mouseSensitivity.toFixed(4)}`);
      return;
    }
    if (e.code === "F9") {
      e.preventDefault();
      const s = this.settings.adjustMouseSensitivity(SENSITIVITY_STEP);
      this.camera.setMouseSensitivity(s.mouseSensitivity);
      console.log(`[Settings] mouseSensitivity=${s.mouseSensitivity.toFixed(4)}`);
      return;
    }
    if (e.code === "F10") {
      e.preventDefault();
      const s = this.settings.update({ rawMouseInput: !this.settings.value.rawMouseInput });
      this.inputManager.setRawMouseInput(s.rawMouseInput);
      console.log(`[Settings] rawMouseInput=${s.rawMouseInput}`);
      return;
    }
    if (e.code === "F11") {
      e.preventDefault();
      const s = this.settings.update({
        gamepadDeadzone: this.settings.value.gamepadDeadzone - GAMEPAD_DEADZONE_STEP,
      });
      this.inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
      console.log(`[Settings] gamepadDeadzone=${s.gamepadDeadzone.toFixed(2)}`);
      return;
    }
    if (e.code === "F12") {
      e.preventDefault();
      const s = this.settings.update({
        gamepadDeadzone: this.settings.value.gamepadDeadzone + GAMEPAD_DEADZONE_STEP,
      });
      this.inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
      console.log(`[Settings] gamepadDeadzone=${s.gamepadDeadzone.toFixed(2)}`);
      return;
    }
    if (e.code === "BracketLeft") {
      e.preventDefault();
      const s = this.settings.update({
        gamepadCurve: this.settings.value.gamepadCurve - GAMEPAD_CURVE_STEP,
      });
      this.inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
      console.log(`[Settings] gamepadCurve=${s.gamepadCurve.toFixed(2)}`);
      return;
    }
    if (e.code === "BracketRight") {
      e.preventDefault();
      const s = this.settings.update({
        gamepadCurve: this.settings.value.gamepadCurve + GAMEPAD_CURVE_STEP,
      });
      this.inputManager.setGamepadTuning(s.gamepadDeadzone, s.gamepadCurve);
      console.log(`[Settings] gamepadCurve=${s.gamepadCurve.toFixed(2)}`);
    }

    // Simulate GPU device loss (debug only)
    if (e.ctrlKey && e.shiftKey && e.code === "KeyL") {
      e.preventDefault();
      const r = this.renderer.renderer as any;
      if (typeof r.onDeviceLost === "function") {
        r.onDeviceLost({ api: "WebGPU", message: "Simulated device loss (debug)", reason: null });
        console.warn("[Game] Simulated GPU device loss via Ctrl+Shift+L");
      }
      return;
    }

    // Delegate nav debug keys to DebugRuntimeSystem
    if (this.debugSystem.handleDebugKeyDown(e)) return;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    window.removeEventListener("keydown", this._onDebugKeyDown);

    // Dispose all registered systems
    for (const system of this.systems) {
      system.dispose();
    }

    this.interactionManager.dispose();
    this.playerController.dispose();
    this.camera.dispose();
    this.audioManager.dispose();
    this.vehicleManager.dispose();
    this.editorManager?.dispose();
    this.uiManager.dispose();
    this.levelManager.dispose();
    this.inputManager.dispose();
    this.physicsWorld.dispose();
    this.renderer.dispose();
    this.eventBus.clear();
  }
}
