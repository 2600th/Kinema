import * as THREE from 'three';
import type { EventBus } from '@core/EventBus';
import type { FixedUpdatable, Updatable, Disposable, PostPhysicsUpdatable } from '@core/types';
import { UserSettingsStore } from '@core/UserSettings';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { InputManager } from '@input/InputManager';
import type { LevelManager } from '@level/LevelManager';
import type { PlayerController } from '@character/PlayerController';
import type { OrbitFollowCamera } from '@camera/OrbitFollowCamera';
import type { InteractionManager } from '@interaction/InteractionManager';
import type { UIManager } from '@ui/UIManager';
import { Door } from '@interaction/interactables/Door';
import { ObjectiveBeacon } from '@interaction/interactables/ObjectiveBeacon';
import { PhysicsRope } from '@interaction/interactables/PhysicsRope';
import { CheckpointManager } from '@level/CheckpointManager';
import { ObjectiveManager } from '@core/ObjectiveManager';
import { AudioManager } from './audio/AudioManager';
import { PhysicsDebugView } from '@physics/PhysicsDebugView';
import type { AntiAliasingMode } from '@renderer/RendererManager';

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
  private checkpointManager: CheckpointManager;
  private objectiveManager: ObjectiveManager;
  private audioManager: AudioManager;
  private physicsDebugView: PhysicsDebugView;
  private readonly fallRespawnY = -25;

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
  ) {
    this.checkpointManager = new CheckpointManager(this.renderer.scene, this.playerController, this.eventBus);
    this.objectiveManager = new ObjectiveManager(this.eventBus);
    this.audioManager = new AudioManager(this.eventBus, this.playerController, this.inputManager);
    this.physicsDebugView = new PhysicsDebugView(this.renderer.scene, this.physicsWorld);

    // Listen for interact state to trigger interactions
    this.eventBus.on('player:stateChanged', ({ current }) => {
      if (current === 'interact') {
        this.interactionManager.refreshFocusFromPosition(this.playerController.position);
        this.interactionManager.triggerInteraction();
      }
    });
    this.eventBus.on('interaction:triggered', ({ id }) => {
      if (id === 'beacon1') {
        this.objectiveManager.complete('activate-beacon');
      }
    });
    this.eventBus.on('checkpoint:activated', ({ position }) => {
      this.playerController.setRespawnPoint({
        position: new THREE.Vector3(position.x, position.y, position.z),
      });
      this.objectiveManager.complete('reach-checkpoint');
    });
    this.eventBus.on('debug:showColliders', (enabled) => {
      this.physicsDebugView.setEnabled(enabled);
    });
    this.eventBus.on('debug:showLightHelpers', (enabled) => {
      this.levelManager.setLightDebugEnabled(enabled);
    });
    this.eventBus.on('debug:postProcessing', (enabled) => {
      this.renderer.setPostProcessingEnabled(enabled);
    });
    this.eventBus.on('debug:shadows', (enabled) => {
      this.renderer.setShadowsEnabled(enabled);
      this.levelManager.setShadowsEnabled(enabled);
    });
    this.eventBus.on('debug:cameraCollision', (enabled) => {
      this.camera.setCollisionEnabled(enabled);
    });
    this.eventBus.on('debug:exposure', (value) => {
      this.renderer.setExposure(value);
    });
    this.eventBus.on('debug:graphicsQuality', ({ quality }) => {
      const settings = this.settings.update({ graphicsQuality: quality });
      this.renderer.setGraphicsQuality(settings.graphicsQuality);
      this.levelManager.setGraphicsQuality(settings.graphicsQuality);
      const debugFlags = this.renderer.getDebugFlags();
      this.uiManager.debugPanel.syncRenderSettings({
        postProcessingEnabled: debugFlags.postProcessingEnabled,
        shadowsEnabled: debugFlags.shadowsEnabled,
        graphicsQuality: debugFlags.graphicsQuality,
        aaMode: debugFlags.aaMode as AntiAliasingMode,
        exposure: debugFlags.exposure,
        ssaoEnabled: debugFlags.ssaoEnabled,
        ssaoRadius: debugFlags.ssaoRadius,
        ssrEnabled: debugFlags.ssrEnabled,
        ssrOpacity: debugFlags.ssrOpacity,
        ssrResolutionScale: debugFlags.ssrResolutionScale,
        bloomEnabled: debugFlags.bloomEnabled,
        bloomStrength: debugFlags.bloomStrength,
        vignetteEnabled: debugFlags.vignetteEnabled,
        vignetteDarkness: debugFlags.vignetteDarkness,
        lutEnabled: debugFlags.lutEnabled,
        lutStrength: debugFlags.lutStrength,
        ssgiEnabled: debugFlags.ssgiEnabled,
        ssgiPreset: debugFlags.ssgiPreset,
        ssgiRadius: debugFlags.ssgiRadius,
        ssgiGiIntensity: debugFlags.ssgiGiIntensity,
        traaEnabled: debugFlags.traaEnabled,
      });
    });
    this.eventBus.on('debug:aaMode', ({ mode }) => {
      this.renderer.setAntiAliasingMode(mode);
    });
    this.eventBus.on('debug:ssaoEnabled', (enabled) => {
      this.renderer.setSsaoEnabled(enabled);
    });
    this.eventBus.on('debug:ssaoRadius', (radius) => {
      this.renderer.setSsaoRadius(radius);
    });
    this.eventBus.on('debug:ssrEnabled', (enabled) => {
      this.renderer.setSsrEnabled(enabled);
    });
    this.eventBus.on('debug:ssrOpacity', (opacity) => {
      this.renderer.setSsrOpacity(opacity);
    });
    this.eventBus.on('debug:ssrResolutionScale', (scale) => {
      this.renderer.setSsrResolutionScale(scale);
    });
    this.eventBus.on('debug:bloomEnabled', (enabled) => {
      this.renderer.setBloomEnabled(enabled);
    });
    this.eventBus.on('debug:bloomStrength', (strength) => {
      this.renderer.setBloomStrength(strength);
    });
    this.eventBus.on('debug:vignetteEnabled', (enabled) => {
      this.renderer.setVignetteEnabled(enabled);
    });
    this.eventBus.on('debug:vignetteDarkness', (darkness) => {
      this.renderer.setVignetteDarkness(darkness);
    });
    this.eventBus.on('debug:lutEnabled', (enabled) => {
      this.renderer.setLutEnabled(enabled);
    });
    this.eventBus.on('debug:lutStrength', (strength) => {
      this.renderer.setLutStrength(strength);
    });
    this.eventBus.on('debug:ssgiEnabled', (enabled) => {
      this.renderer.setSsgiEnabled(enabled);
    });
    this.eventBus.on('debug:ssgiPreset', (preset) => {
      this.renderer.setSsgiPreset(preset);
    });
    this.eventBus.on('debug:ssgiRadius', (radius) => {
      this.renderer.setSsgiRadius(radius);
    });
    this.eventBus.on('debug:ssgiGiIntensity', (intensity) => {
      this.renderer.setSsgiGiIntensity(intensity);
    });
    this.eventBus.on('debug:traaEnabled', (enabled) => {
      this.renderer.setTraaEnabled(enabled);
    });

    const debugFlags = this.renderer.getDebugFlags();
    this.uiManager.debugPanel.syncRenderSettings({
      postProcessingEnabled: debugFlags.postProcessingEnabled,
      shadowsEnabled: debugFlags.shadowsEnabled,
      graphicsQuality: debugFlags.graphicsQuality,
      aaMode: debugFlags.aaMode as AntiAliasingMode,
      exposure: debugFlags.exposure,
      ssaoEnabled: debugFlags.ssaoEnabled,
      ssaoRadius: debugFlags.ssaoRadius,
      ssrEnabled: debugFlags.ssrEnabled,
      ssrOpacity: debugFlags.ssrOpacity,
      ssrResolutionScale: debugFlags.ssrResolutionScale,
      bloomEnabled: debugFlags.bloomEnabled,
      bloomStrength: debugFlags.bloomStrength,
      vignetteEnabled: debugFlags.vignetteEnabled,
      vignetteDarkness: debugFlags.vignetteDarkness,
      lutEnabled: debugFlags.lutEnabled,
      lutStrength: debugFlags.lutStrength,
      ssgiEnabled: debugFlags.ssgiEnabled,
      ssgiPreset: debugFlags.ssgiPreset,
      ssgiRadius: debugFlags.ssgiRadius,
      ssgiGiIntensity: debugFlags.ssgiGiIntensity,
      traaEnabled: debugFlags.traaEnabled,
    });

    // Debug toggle on backtick
    window.addEventListener('keydown', this._onDebugKeyDown);

    // Create a sample door interactable
    this.spawnInteractables();
    this.spawnCheckpoints();
    this.objectiveManager.setObjectives([
      { id: 'reach-checkpoint', text: 'Reach a checkpoint' },
      { id: 'activate-beacon', text: 'Activate the beacon' },
    ]);
  }

  /** Fixed 60Hz tick. */
  fixedUpdate(dt: number): void {
    // Poll input — captures accumulated mouse deltas
    const input = this.inputManager.poll();
    this.playerController.setInput(input);

    // Apply mouse deltas to camera (consumed here, not in render loop)
    this.camera.handleMouseInput(input.mouseDeltaX, input.mouseDeltaY);
    this.camera.handleZoomInput(input.mouseWheelDelta);

    // Update dynamic level elements (moving platforms, etc.)
    this.levelManager.fixedUpdate(dt);

    // Interaction detection first — ensures focus is current before player FSM runs
    this.interactionManager.fixedUpdate(dt);

    // Feed input + camera yaw to player
    this.playerController.cameraYaw = this.camera.getYaw();
    this.playerController.setLadderZones(this.levelManager.getLadderZones());
    this.playerController.fixedUpdate(dt);
    this.audioManager.fixedUpdate(dt);
    this.checkpointManager.fixedUpdate(dt);
    if (this.playerController.position.y < this.fallRespawnY) {
      this.playerController.respawn();
      this.eventBus.emit('player:respawned', { reason: 'fall' });
    }

  }

  /** Runs after each Rapier step so visual sync uses integrated positions. */
  postPhysicsUpdate(dt: number): void {
    this.playerController.postPhysicsUpdate(dt);

    // Speed calculation (for debug)
    _currPos.copy(this.playerController.position);
    if (!this.hasSpeedSample) {
      this.prevPlayerPos.copy(_currPos);
      this.speed = 0;
      this.hasSpeedSample = true;
      return;
    }
    _prevPos.copy(this.prevPlayerPos);
    const dx = _currPos.x - _prevPos.x;
    const dz = _currPos.z - _prevPos.z;
    this.speed = Math.sqrt(dx * dx + dz * dz) / dt;
    this.prevPlayerPos.copy(_currPos);
  }

  /** Render-frame tick. */
  update(dt: number, alpha: number): void {
    // Update visual interpolation
    this.playerController.update(dt, alpha);
    this.levelManager.updateLighting(this.playerController.position);
    this.physicsDebugView.update();

    // Camera follows player (runs every render frame for smoothness)
    this.camera.update(dt, alpha);
    const renderStats = this.renderer.getRenderStats();

    // Debug panel
    this.uiManager.debugPanel.tick(
      this.speed,
      this.playerController.fsm.current,
      this.playerController.isGrounded,
      {
        frameMs: dt * 1000,
        physicsMs: this.physicsWorld.getLastStepMs(),
        drawCalls: renderStats.drawCalls,
        triangles: renderStats.triangles,
        lines: renderStats.lines,
        points: renderStats.points,
      },
    );
  }

  private spawnInteractables(): void {
    const rope = new PhysicsRope(
      'rope1',
      new THREE.Vector3(-18, 3.9, 6),
      this.renderer.scene,
      this.physicsWorld,
      this.playerController,
    );
    this.interactionManager.register(rope);

    const beacon = new ObjectiveBeacon(
      'beacon1',
      new THREE.Vector3(1.5, -1, 2.5),
      this.renderer.scene,
      this.physicsWorld,
    );
    this.interactionManager.register(beacon);

    const door = new Door(
      'door1',
      new THREE.Vector3(12, -1, -6),
      this.renderer.scene,
      this.physicsWorld,
    );
    this.interactionManager.register(door);
  }

  private spawnCheckpoints(): void {
    this.checkpointManager.addCheckpoint('door-side', new THREE.Vector3(5, 0.1, -5), 2.2);
  }

  private handleDebugKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Backquote') {
      this.eventBus.emit('debug:toggle', undefined);
      return;
    }
    if (e.code === 'F6') {
      e.preventDefault();
      const settings = this.settings.cycleGraphicsQuality();
      this.renderer.setGraphicsQuality(settings.graphicsQuality);
      this.levelManager.setGraphicsQuality(settings.graphicsQuality);
      const debugFlags = this.renderer.getDebugFlags();
      this.uiManager.debugPanel.syncRenderSettings({
        postProcessingEnabled: debugFlags.postProcessingEnabled,
        shadowsEnabled: debugFlags.shadowsEnabled,
        graphicsQuality: debugFlags.graphicsQuality,
        aaMode: debugFlags.aaMode as AntiAliasingMode,
        exposure: debugFlags.exposure,
        ssaoEnabled: debugFlags.ssaoEnabled,
        ssaoRadius: debugFlags.ssaoRadius,
        ssrEnabled: debugFlags.ssrEnabled,
        ssrOpacity: debugFlags.ssrOpacity,
        ssrResolutionScale: debugFlags.ssrResolutionScale,
        bloomEnabled: debugFlags.bloomEnabled,
        bloomStrength: debugFlags.bloomStrength,
        vignetteEnabled: debugFlags.vignetteEnabled,
        vignetteDarkness: debugFlags.vignetteDarkness,
        lutEnabled: debugFlags.lutEnabled,
        lutStrength: debugFlags.lutStrength,
        ssgiEnabled: debugFlags.ssgiEnabled,
        ssgiPreset: debugFlags.ssgiPreset,
        ssgiRadius: debugFlags.ssgiRadius,
        ssgiGiIntensity: debugFlags.ssgiGiIntensity,
        traaEnabled: debugFlags.traaEnabled,
      });
      console.log(`[Settings] graphicsQuality=${settings.graphicsQuality}`);
      return;
    }
    if (e.code === 'F7') {
      e.preventDefault();
      const settings = this.settings.update({ invertY: !this.settings.value.invertY });
      this.camera.setInvertY(settings.invertY);
      console.log(`[Settings] invertY=${settings.invertY}`);
      return;
    }
    if (e.code === 'F8') {
      e.preventDefault();
      const settings = this.settings.adjustMouseSensitivity(-SENSITIVITY_STEP);
      this.camera.setMouseSensitivity(settings.mouseSensitivity);
      console.log(`[Settings] mouseSensitivity=${settings.mouseSensitivity.toFixed(4)}`);
      return;
    }
    if (e.code === 'F9') {
      e.preventDefault();
      const settings = this.settings.adjustMouseSensitivity(SENSITIVITY_STEP);
      this.camera.setMouseSensitivity(settings.mouseSensitivity);
      console.log(`[Settings] mouseSensitivity=${settings.mouseSensitivity.toFixed(4)}`);
      return;
    }
    if (e.code === 'F10') {
      e.preventDefault();
      const settings = this.settings.update({ rawMouseInput: !this.settings.value.rawMouseInput });
      this.inputManager.setRawMouseInput(settings.rawMouseInput);
      console.log(`[Settings] rawMouseInput=${settings.rawMouseInput}`);
      return;
    }
    if (e.code === 'F11') {
      e.preventDefault();
      const settings = this.settings.update({
        gamepadDeadzone: this.settings.value.gamepadDeadzone - GAMEPAD_DEADZONE_STEP,
      });
      this.inputManager.setGamepadTuning(settings.gamepadDeadzone, settings.gamepadCurve);
      console.log(`[Settings] gamepadDeadzone=${settings.gamepadDeadzone.toFixed(2)}`);
      return;
    }
    if (e.code === 'F12') {
      e.preventDefault();
      const settings = this.settings.update({
        gamepadDeadzone: this.settings.value.gamepadDeadzone + GAMEPAD_DEADZONE_STEP,
      });
      this.inputManager.setGamepadTuning(settings.gamepadDeadzone, settings.gamepadCurve);
      console.log(`[Settings] gamepadDeadzone=${settings.gamepadDeadzone.toFixed(2)}`);
      return;
    }
    if (e.code === 'BracketLeft') {
      e.preventDefault();
      const settings = this.settings.update({
        gamepadCurve: this.settings.value.gamepadCurve - GAMEPAD_CURVE_STEP,
      });
      this.inputManager.setGamepadTuning(settings.gamepadDeadzone, settings.gamepadCurve);
      console.log(`[Settings] gamepadCurve=${settings.gamepadCurve.toFixed(2)}`);
      return;
    }
    if (e.code === 'BracketRight') {
      e.preventDefault();
      const settings = this.settings.update({
        gamepadCurve: this.settings.value.gamepadCurve + GAMEPAD_CURVE_STEP,
      });
      this.inputManager.setGamepadTuning(settings.gamepadDeadzone, settings.gamepadCurve);
      console.log(`[Settings] gamepadCurve=${settings.gamepadCurve.toFixed(2)}`);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this._onDebugKeyDown);
    this.interactionManager.dispose();
    this.playerController.dispose();
    this.camera.dispose();
    this.checkpointManager.dispose();
    this.objectiveManager.dispose();
    this.audioManager.dispose();
    this.physicsDebugView.dispose();
    this.uiManager.dispose();
    this.levelManager.dispose();
    this.inputManager.dispose();
    this.physicsWorld.dispose();
    this.renderer.dispose();
    this.eventBus.clear();
  }
}
