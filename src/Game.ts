import * as THREE from 'three';
import type { EventBus } from '@core/EventBus';
import { STATE, type FixedUpdatable, type InputState, type Updatable, type Disposable, type PostPhysicsUpdatable } from '@core/types';
import { UserSettingsStore, type ShadowQualityTier } from '@core/UserSettings';
import { COLLISION_GROUP_INTERACTABLE, COLLISION_GROUP_WORLD } from '@core/constants';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { InputManager, LookState } from '@input/InputManager';
import type { LevelManager } from '@level/LevelManager';
import { getShowcaseBayTopY, getShowcaseStationZ, type ShowcaseStationKey } from '@level/ShowcaseLayout';
import type { PlayerController } from '@character/PlayerController';
import type { OrbitFollowCamera } from '@camera/OrbitFollowCamera';
import type { InteractionManager } from '@interaction/InteractionManager';
import type { UIManager } from '@ui/UIManager';
import RAPIER from '@dimforge/rapier3d-compat';
import { Door } from '@interaction/interactables/Door';
import { ObjectiveBeacon } from '@interaction/interactables/ObjectiveBeacon';
import { PhysicsRope } from '@interaction/interactables/PhysicsRope';
import { GrabbableObject } from '@interaction/interactables/GrabbableObject';
import { ThrowableObject } from '@interaction/interactables/ThrowableObject';
import { VehicleSeat } from '@interaction/interactables/VehicleSeat';
import { CheckpointManager } from '@level/CheckpointManager';
import { ObjectiveManager } from '@core/ObjectiveManager';
import type { PhysicsDebugView } from '@physics/PhysicsDebugView';
import type { AudioManager } from '@audio/AudioManager';
import type { VehicleManager } from '@vehicle/VehicleManager';
import { DroneController } from '@vehicle/DroneController';
import { CarController } from '@vehicle/CarController';
import type { EditorManager } from '@editor/EditorManager';
import type { NavPatrolSystem } from '@navigation/NavPatrolSystem';
import type { NavDebugOverlay } from '@navigation/NavDebugOverlay';
import { FeedbackPlayer } from '@juice/FeedbackPlayer';
import { Hitstop } from '@juice/Hitstop';
import { FOVPunch } from '@juice/FOVPunch';
import type { GameParticles } from '@juice/GameParticles';

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
  private editorManager: EditorManager | null = null;
  private physicsDebugView: PhysicsDebugView | null = null;
  private readonly fallRespawnY = -25;
  private runtimeInteractables: Array<{ id: string; dispose: () => void }> = [];
  private throwableObjects = new Map<number, ThrowableObject>();
  private throwableMaterial: THREE.Material | null = null;
  private carriedThrowable: ThrowableObject | null = null;
  private rope: PhysicsRope | null = null;
  private navPatrolSystem: NavPatrolSystem | null = null;
  private navDebugOverlay: NavDebugOverlay | null = null;
  private navTargetMode = false;
  private _onNavTargetClick: ((e: MouseEvent) => void) | null = null;
  private navTargetMarker: THREE.Mesh | null = null;
  private navMarkerFade = 0;
  private readonly navRaycaster = new THREE.Raycaster();
  private readonly navPointer = new THREE.Vector2();
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

  // Shared throwable geometries (reused across all throwable objects)
  private readonly throwableGeometries = {
    sphere: new THREE.SphereGeometry(1, 8, 6),
    box: new THREE.BoxGeometry(2, 2, 2),
    cylinder: new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12),
  };

  // Juice systems
  readonly feedbackPlayer = new FeedbackPlayer();
  readonly hitstop = new Hitstop();
  readonly fovPunch = new FOVPunch();
  private gameParticles: GameParticles | null = null;
  private particleFootstepTimer = 0;

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
    this.checkpointManager = new CheckpointManager(this.renderer.scene, this.playerController, this.eventBus);
    this.objectiveManager = new ObjectiveManager(this.eventBus);
    this.audioManager = audioManager;

    // Wire juice systems
    this.camera.setFOVPunch(this.fovPunch);

    // Listen for interact state to trigger interactions
    this.unsubs.push(
      this.eventBus.on('player:stateChanged', ({ current }) => {
        if (current === STATE.interact) {
          this.interactionManager.refreshFocusFromPosition(this.playerController.position);
          this.interactionManager.triggerInteraction();
        }
      }),
      this.eventBus.on('player:jumped', ({ airJump, groundPosition, position }) => {
        if (airJump) {
          this.camera.addTrauma(0.08);
          this.fovPunch.punch(1.5);
          if (this.gameParticles) {
            this.gameParticles.airJumpBurst(position);
          } else {
            void this.ensureGameParticles().then((p) => p.airJumpBurst(position));
          }
        } else {
          this.fovPunch.punch(0.75);
          if (this.gameParticles) {
            this.gameParticles.jumpPuff(groundPosition);
          } else {
            void this.ensureGameParticles().then((p) => p.jumpPuff(groundPosition));
          }
        }
      }),
      this.eventBus.on('player:landed', ({ impactSpeed }) => {
        // Screen shake: scale trauma with fall speed, cap at 0.5
        this.camera.addTrauma(Math.min(0.5, impactSpeed * 0.05));
        // High-impact landings get hitstop + FOV punch
        if (impactSpeed > 5) {
          this.hitstop.trigger(0.05);
          this.fovPunch.punch(3);
        }
        // Landing dust particles
        if (this.gameParticles) {
          this.gameParticles.landingImpact(this.playerController.groundPosition, impactSpeed);
        } else {
          void this.ensureGameParticles().then((p) => p.landingImpact(this.playerController.groundPosition, impactSpeed));
        }
      }),
      this.eventBus.on('interaction:triggered', ({ id }) => {
        if (id === 'beacon1') {
          this.objectiveManager.complete('activate-beacon');
        }
      }),
      this.eventBus.on('interaction:grabStart', ({ body, offset }) => {
        this.playerController.startGrab(body, offset);
      }),
      this.eventBus.on('interaction:pickUp', ({ object }) => {
        this.carriedThrowable = object;
        this.playerController.startCarry(object);
        this.interactionManager.unregister(object.id);
      }),
      this.eventBus.on('interaction:throw', () => {
        this.restoreThrownObject();
      }),
      this.eventBus.on('interaction:drop', () => {
        this.restoreThrownObject();
      }),
      this.eventBus.on('checkpoint:activated', ({ position }) => {
        this.playerController.setRespawnPoint({
          position: new THREE.Vector3(position.x, position.y, position.z),
        });
        this.objectiveManager.complete('reach-checkpoint');
      }),
      this.eventBus.on('debug:showColliders', (enabled) => {
        if (this.physicsDebugView) {
          this.physicsDebugView.setEnabled(enabled);
        } else {
          void this.ensurePhysicsDebugView().then((v) => v.setEnabled(enabled));
        }
      }),
      this.eventBus.on('debug:showLightHelpers', (enabled) => {
        this.levelManager.setLightDebugEnabled(enabled);
      }),
      this.eventBus.on('debug:postProcessing', (enabled) => {
        this.renderer.setPostProcessingEnabled(enabled);
      }),
      this.eventBus.on('debug:shadows', (enabled) => {
        this.settings.update({ shadowsEnabled: enabled });
        this.renderer.setShadowsEnabled(enabled);
        this.levelManager.setShadowsEnabled(enabled);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:cameraCollision', (enabled) => {
        this.camera.setCollisionEnabled(enabled);
      }),
      this.eventBus.on('debug:exposure', (value) => {
        this.renderer.setExposure(value);
      }),
      this.eventBus.on('debug:graphicsProfile', ({ profile }) => {
        this.renderer.setGraphicsProfile(profile);
        const flags = this.renderer.getDebugFlags();
        const settings = this.settings.update({ graphicsProfile: profile, aaMode: flags.aaMode });
        this.levelManager.setGraphicsProfile(settings.graphicsProfile);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:aoOnly', (enabled) => {
        this.renderer.setAoOnlyView(enabled);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:aaMode', ({ mode }) => {
        this.settings.update({ aaMode: mode });
        this.renderer.setAntiAliasingMode(mode);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:ssaoEnabled', (enabled) => {
        this.renderer.setSsaoEnabled(enabled);
      }),
      this.eventBus.on('debug:ssrEnabled', (enabled) => {
        this.renderer.setSsrEnabled(enabled);
      }),
      this.eventBus.on('debug:ssrOpacity', (opacity) => {
        this.renderer.setSsrOpacity(opacity);
      }),
      this.eventBus.on('debug:ssrResolutionScale', (scale) => {
        this.renderer.setSsrResolutionScale(scale);
      }),
      this.eventBus.on('debug:bloomEnabled', (enabled) => {
        this.renderer.setBloomEnabled(enabled);
      }),
      this.eventBus.on('debug:bloomStrength', (strength) => {
        this.renderer.setBloomStrength(strength);
      }),
      this.eventBus.on('debug:vignetteEnabled', (enabled) => {
        this.renderer.setVignetteEnabled(enabled);
      }),
      this.eventBus.on('debug:vignetteDarkness', (darkness) => {
        this.renderer.setVignetteDarkness(darkness);
      }),
      this.eventBus.on('debug:lutEnabled', (enabled) => {
        this.renderer.setLutEnabled(enabled);
      }),
      this.eventBus.on('debug:lutStrength', (strength) => {
        this.renderer.setLutStrength(strength);
      }),
      this.eventBus.on('debug:lutName', (name) => {
        this.renderer.setLutName(name);
      }),
      this.eventBus.on('debug:envBackgroundIntensity', (intensity) => {
        this.renderer.setBackgroundIntensity(intensity);
      }),
      this.eventBus.on('debug:envBackgroundBlurriness', (blurriness) => {
        this.renderer.setBackgroundBlurriness(blurriness);
      }),
      this.eventBus.on('debug:environmentRotation', (rotationDegrees) => {
        this.settings.update({ envRotationDegrees: rotationDegrees });
        this.renderer.setEnvironmentRotationDegrees(rotationDegrees);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:environment', (name) => {
        void this.renderer.setEnvironment(name);
      }),
      this.eventBus.on('debug:shadowQuality', ({ tier }) => {
        const shadowQuality = tier as ShadowQualityTier;
        this.settings.update({ shadowQuality });
        this.renderer.setShadowQualityTier(shadowQuality);
        this.levelManager.setShadowQualityTier(shadowQuality);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:casEnabled', (enabled) => {
        this.settings.update({ casEnabled: enabled });
        this.renderer.setCasEnabled(enabled);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:casStrength', (strength) => {
        this.settings.update({ casStrength: strength });
        this.renderer.setCasStrength(strength);
        this.syncDebugPanel();
      }),
      this.eventBus.on('debug:showShadowFrustums', (enabled) => {
        this.levelManager.setShadowDebugEnabled(enabled);
        this.syncDebugPanel();
      }),
    );
    this.syncDebugPanel();

    // Debug toggle on backtick
    window.addEventListener('keydown', this._onDebugKeyDown);

  }

  /** Called once per frame before the fixed-step loop to cache input. */
  beginFrame(dt: number): void {
    if (this.testInputOverride && this.testInputFrames > 0) {
      this.frameInput = this.testInputOverride;
      this.testInputFrames--;
      if (this.testInputFrames <= 0) {
        this.testInputOverride = null;
      }
    } else {
      this.frameInput = this.inputManager.poll();
    }
    this.frameLook = this.inputManager.pollLook(dt);
  }

  /** Fixed 60Hz tick. */
  fixedUpdate(dt: number): void {
    // Use cached input from beginFrame (polled once per frame, not per substep)
    const input = this.frameInput ?? this.inputManager.poll();
    this.playerController.setInput(input);
    this.vehicleManager.setInput(input);
    if (this.vehicleManager.isActive() && input.interactPressed) {
      this.vehicleManager.requestExit();
    }

    // Update dynamic level elements (moving platforms, etc.)
    this.levelManager.fixedUpdate(dt);

    // Interaction detection first — ensures focus is current before player FSM runs
    this.interactionManager.fixedUpdate(dt);

    // Always tick vehicles: active vehicle control OR parked vehicle behaviors (e.g., drone auto-landing).
    this.vehicleManager.fixedUpdate(dt);

    if (!this.vehicleManager.isActive()) {
      // Feed input + camera yaw to player
      this.playerController.cameraYaw = this.camera.getYaw();
      this.playerController.setLadderZones(this.levelManager.getLadderZones());
      this.playerController.fixedUpdate(dt);
      this.checkpointManager.fixedUpdate(dt);
      if (this.playerController.position.y < this.fallRespawnY) {
        this.playerController.respawn();
        this.eventBus.emit('player:respawned', { reason: 'fall' });
      }
    }
    this.audioManager.fixedUpdate(dt);

    // Footstep dust particles — mirrors AudioManager footstep timing
    if (!this.vehicleManager.isActive() && this.playerController.body) {
      const vel = this.playerController.body.linvel();
      const planarSpeed = Math.hypot(vel.x, vel.z);
      const movingOnGround = this.playerController.isGrounded && planarSpeed > 1.15;
      if (!movingOnGround) {
        this.particleFootstepTimer = 0;
      } else {
        this.particleFootstepTimer -= dt;
        if (this.particleFootstepTimer <= 0) {
          if (this.gameParticles) {
            this.gameParticles.footstepDust(this.playerController.groundPosition, planarSpeed);
          } else {
            void this.ensureGameParticles().then((p) => p.footstepDust(this.playerController.groundPosition, planarSpeed));
          }
          const speedN = Math.min((planarSpeed - 1.15) / 6.5, 1);
          this.particleFootstepTimer = 0.42 - speedN * 0.2;
        }
      }
    }

    this.navPatrolSystem?.update(dt);

  }

  /** Runs after each Rapier step so visual sync uses integrated positions. */
  postPhysicsUpdate(dt: number): void {
    if (!this.vehicleManager.isActive()) {
      this.playerController.postPhysicsUpdate(dt);
    }
    this.levelManager.postPhysicsUpdate(dt);
    this.vehicleManager.postPhysicsUpdate(dt);
    this.rope?.postPhysicsUpdate();
    for (const throwable of this.throwableObjects.values()) {
      throwable.postPhysicsUpdate();
    }

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

    if (this.throwableObjects.size > 0) {
      this.physicsWorld.eventQueue.drainContactForceEvents((event) => {
        const h1 = event.collider1();
        const h2 = event.collider2();
        const obj = this.throwableObjects.get(h1) ?? this.throwableObjects.get(h2);
        if (!obj) return;
        if (event.totalForceMagnitude() > 12) {
          this.uiManager.hud.showStatus('Impact!', 700);
        }
      });
    }
  }

  /** Render-frame tick. */
  update(dt: number, alpha: number): void {
    if (this.editorManager?.isActive()) {
      this.editorManager.update(dt);
      this.physicsDebugView?.update();
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
    const lightingPos = this.playerController.position;
    this.levelManager.updateLighting(lightingPos);
    this.levelManager.update(dt, alpha);
    // Always update vehicles (active + parked) so parked drone/vehicles visually follow physics.
    this.vehicleManager.update(dt, alpha);
    this.rope?.renderUpdate(alpha);
    for (const throwable of this.throwableObjects.values()) {
      throwable.renderUpdate(alpha);
    }
    this.physicsDebugView?.update();
    this.gameParticles?.update(dt, this.renderer.camera);

    // Nav target marker fade
    if (this.navMarkerFade > 0 && this.navTargetMarker) {
      this.navMarkerFade = Math.max(0, this.navMarkerFade - dt / 3);
      (this.navTargetMarker.material as THREE.MeshBasicMaterial).opacity = 0.8 * this.navMarkerFade;
      if (this.navMarkerFade <= 0) {
        this.renderer.scene.remove(this.navTargetMarker);
        this.navTargetMarker.geometry.dispose();
        (this.navTargetMarker.material as THREE.Material).dispose();
        this.navTargetMarker = null;
      }
    }

    // Use cached look deltas from beginFrame
    const look = this.frameLook ?? this.inputManager.pollLook(dt);
    const lookMode = this.vehicleManager.getCameraLookMode();
    this.camera.handleMouseInput(look.lookDX, lookMode === 'yawOnly' ? 0 : look.lookDY);
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
    const stateId = this.vehicleManager.isActive() ? 'vehicle' : this.playerController.fsm.current;
    const grounded = this.vehicleManager.isActive() ? false : this.playerController.isGrounded;
    this.uiManager.debugPanel.tick(
      this.speed,
      stateId,
      grounded,
      {
        frameMs: dt * 1000,
        physicsMs: this.cachedDebugStats.physicsMs,
        drawCalls: this.cachedDebugStats.drawCalls,
        triangles: this.cachedDebugStats.triangles,
        lines: this.cachedDebugStats.lines,
        points: this.cachedDebugStats.points,
      },
    );

    // Clear per-frame input cache
    this.frameInput = null;
    this.frameLook = null;
  }

  private async ensurePhysicsDebugView(): Promise<PhysicsDebugView> {
    if (!this.physicsDebugView) {
      const { PhysicsDebugView } = await import('@physics/PhysicsDebugView');
      this.physicsDebugView = new PhysicsDebugView(this.renderer.scene, this.physicsWorld);
    }
    return this.physicsDebugView;
  }

  private async ensureGameParticles(): Promise<GameParticles> {
    if (!this.gameParticles) {
      const { GameParticles } = await import('@juice/GameParticles');
      this.gameParticles = new GameParticles(this.renderer.scene);
    }
    return this.gameParticles;
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
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();
    this.spawnInteractables();
    this.spawnCheckpoints();
    this.objectiveManager.setObjectives([
      { id: 'reach-checkpoint', text: 'Reach a checkpoint' },
      { id: 'activate-beacon', text: 'Activate the beacon' },
    ]);
    // Ambient sci-fi drone sound
    this.audioManager.playMusic(2.0);

    // Wire navigation systems from LevelManager.
    this.navPatrolSystem = this.levelManager.getNavPatrolSystem();
    this.navDebugOverlay = this.levelManager.getNavDebugOverlay();
  }

  /** Minimal level setup for custom/editor levels — no procedural showcase content. */
  setupCustomLevel(): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();
  }

  /** Setup only the interactables for a single showcase station (debug/test). */
  setupStation(key: ShowcaseStationKey): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();

    switch (key) {
      case 'door': {
        const bayTopY = getShowcaseBayTopY();
        const zDoor = getShowcaseStationZ('door');
        const beacon = new ObjectiveBeacon(
          'beacon1',
          new THREE.Vector3(4, bayTopY, zDoor),
          this.renderer.scene,
          this.physicsWorld,
        );
        this.interactionManager.register(beacon);
        const door = new Door(
          'door1',
          new THREE.Vector3(0, bayTopY, zDoor),
          this.renderer.scene,
          this.physicsWorld,
        );
        this.interactionManager.register(door);
        this.runtimeInteractables.push(beacon, door);
        break;
      }
      case 'movement': {
        const bayTopY = getShowcaseBayTopY();
        const zMovement = getShowcaseStationZ('movement');
        const rope = new PhysicsRope(
          'rope1',
          new THREE.Vector3(-14, bayTopY + 6.2, zMovement + 2),
          this.renderer.scene,
          this.physicsWorld,
          this.playerController,
        );
        this.rope = rope;
        this.interactionManager.register(rope);
        this.runtimeInteractables.push(rope);
        break;
      }
      case 'grab':
        this.spawnGrabbables();
        break;
      case 'throw':
        this.spawnThrowableObjects();
        break;
      case 'vehicles':
        this.spawnVehicles();
        break;
      // Other stations only have LevelManager geometry (no runtime interactables)
    }
  }

  teardownLevel(): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();
    this.navPatrolSystem = null;
    this.navDebugOverlay = null;
    this.navTargetMode = false;
    if (this._onNavTargetClick) {
      window.removeEventListener('click', this._onNavTargetClick);
      this._onNavTargetClick = null;
    }
    if (this.navTargetMarker) {
      this.renderer.scene.remove(this.navTargetMarker);
      this.navTargetMarker.geometry.dispose();
      (this.navTargetMarker.material as THREE.Material).dispose();
      this.navTargetMarker = null;
    }
  }

  setEditorManager(manager: EditorManager): void {
    this.editorManager = manager;
  }

  private spawnInteractables(): void {
    // Showcase station Z positions (must match the procedural showcase layout in LevelManager).
    const bayTopY = getShowcaseBayTopY();
    const zDoor = getShowcaseStationZ('door');
    const zMovement = getShowcaseStationZ('movement');
    const rope = new PhysicsRope(
      'rope1',
      new THREE.Vector3(-14, bayTopY + 6.2, zMovement + 2),
      this.renderer.scene,
      this.physicsWorld,
      this.playerController,
    );
    this.rope = rope;
    this.interactionManager.register(rope);

    const beacon = new ObjectiveBeacon(
      'beacon1',
      new THREE.Vector3(4, bayTopY, zDoor),
      this.renderer.scene,
      this.physicsWorld,
    );
    this.interactionManager.register(beacon);

    const door = new Door(
      'door1',
      new THREE.Vector3(0, bayTopY, zDoor),
      this.renderer.scene,
      this.physicsWorld,
    );
    this.interactionManager.register(door);

    this.runtimeInteractables.push(rope, beacon, door);

    this.spawnGrabbables();
    this.spawnThrowableObjects();
    this.spawnVehicles();
  }

  private spawnCheckpoints(): void {
    // Place checkpoint in the showcase corridor.
    this.checkpointManager.addCheckpoint(
      'showcase-checkpoint',
      new THREE.Vector3(10, getShowcaseBayTopY() + 0.12, getShowcaseStationZ('door')),
      2.2,
    );
  }

  private spawnGrabbables(): void {
    const dynamicBodies = this.levelManager.getDynamicBodies();
    dynamicBodies.forEach((entry, index) => {
      if (entry.mesh.userData?.grabbable !== true) return;
      const id = `grab-${index}`;
      const collider = entry.body.collider(0);
      if (!collider) return;
      const grab = new GrabbableObject(id, entry.body, collider, this.eventBus, entry.mesh);
      this.interactionManager.register(grab);
      this.runtimeInteractables.push(grab);
    });
  }

  private spawnThrowableObjects(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9d7b52, roughness: 0.7 });
    this.throwableMaterial = mat;
    const zThrow = getShowcaseStationZ('throw');
    const bayTopY = getShowcaseBayTopY();
    const placements = [
      // Showcase lane (kept away from moving platforms).
      { shape: 'sphere', pos: new THREE.Vector3(-3, 0, zThrow + 2), size: 0.3, force: 8 },
      { shape: 'sphere', pos: new THREE.Vector3(-1, 0, zThrow), size: 0.25, force: 7 },
      { shape: 'box', pos: new THREE.Vector3(1, 0, zThrow + 2), size: 0.35, force: 8 },
      { shape: 'box', pos: new THREE.Vector3(3, 0, zThrow), size: 0.45, force: 9 },
      { shape: 'cylinder', pos: new THREE.Vector3(-3, 0, zThrow - 2), size: 0.25, force: 7.5 },
      { shape: 'cylinder', pos: new THREE.Vector3(3, 0, zThrow - 2), size: 0.28, force: 8.5 },
    ] as const;

    placements.forEach((entry, index) => {
      const id = `throw-${index}`;
      const mesh = this.createThrowableMesh(entry.shape, entry.size, mat);
      // Place on top of the bay pedestal (consistent with procedural stage height).
      let halfHeight = entry.size;
      if (entry.shape === 'cylinder') {
        halfHeight = entry.size * 0.6;
      }
      mesh.position.set(entry.pos.x, bayTopY + halfHeight + 0.04, entry.pos.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.renderer.scene.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z);
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);
      // Prevent tunneling when thrown at high speed.
      body.enableCcd(true);

      let colliderDesc: RAPIER.ColliderDesc;
      if (entry.shape === 'sphere') {
        colliderDesc = RAPIER.ColliderDesc.ball(entry.size);
      } else if (entry.shape === 'cylinder') {
        // Rapier cylinder uses (halfHeight, radius). Match the Three mesh.
        colliderDesc = RAPIER.ColliderDesc.cylinder(entry.size * 0.6, entry.size * 0.6);
      } else {
        colliderDesc = RAPIER.ColliderDesc.cuboid(entry.size, entry.size, entry.size);
      }

      colliderDesc
        .setDensity(1.0)
        .setCollisionGroups(COLLISION_GROUP_WORLD)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(8);
      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

      const throwable = new ThrowableObject(id, mesh, body, collider, entry.force, this.eventBus);
      this.throwableObjects.set(collider.handle, throwable);
      this.interactionManager.register(throwable);
      this.runtimeInteractables.push(throwable);
    });
  }

  private createThrowableMesh(
    shape: 'sphere' | 'box' | 'cylinder',
    size: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.throwableGeometries[shape], material);
    // Shared geometry has unit dimensions; scale the mesh to match the requested size.
    if (shape === 'sphere') {
      mesh.scale.setScalar(size);
    } else if (shape === 'cylinder') {
      mesh.scale.setScalar(size);
    } else {
      mesh.scale.setScalar(size);
    }
    return mesh;
  }

  private spawnVehicles(): void {
    const zVehicles = getShowcaseStationZ('vehicles');
    const bayTopY = getShowcaseBayTopY();
    const drone = new DroneController(
      'drone-1',
      new THREE.Vector3(-3.5, bayTopY + 2.2, zVehicles),
      this.physicsWorld,
      this.renderer.scene,
    );
    const car = new CarController(
      'car-1',
      new THREE.Vector3(3.5, bayTopY + 0.42, zVehicles),
      this.physicsWorld,
      this.renderer.scene,
    );
    this.vehicleManager.register(drone);
    this.vehicleManager.register(car);

    const droneSeat = this.createVehicleSeat('seat-drone', 'Fly', drone, new THREE.Vector3(0, 0.6, 0));
    const carSeat = this.createVehicleSeat('seat-car', 'Drive', car, new THREE.Vector3(-1.5, 0.5, -1.0));
    this.interactionManager.register(droneSeat);
    this.interactionManager.register(carSeat);
    this.runtimeInteractables.push(droneSeat, carSeat);
  }

  private createVehicleSeat(
    id: string,
    label: string,
    vehicle: DroneController | CarController,
    offset: THREE.Vector3,
  ): VehicleSeat {
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.6, 0.8, 0.6)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_INTERACTABLE)
      .setTranslation(offset.x, offset.y, offset.z);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, vehicle.body);
    return new VehicleSeat(id, label, collider, vehicle, this.eventBus, offset);
  }

  private restoreThrownObject(): void {
    if (!this.carriedThrowable) return;
    this.interactionManager.register(this.carriedThrowable);
    this.carriedThrowable = null;
  }

  private clearRuntimeInteractables(): void {
    this.rope = null;
    for (const interactable of this.runtimeInteractables) {
      this.interactionManager.unregister(interactable.id);
      if (interactable instanceof ThrowableObject) {
        this.physicsWorld.removeCollider(interactable.collider);
        this.physicsWorld.removeBody(interactable.body);
        this.renderer.scene.remove(interactable.mesh);
      }
      if (interactable instanceof VehicleSeat) {
        this.physicsWorld.removeCollider(interactable.collider);
      }
      interactable.dispose();
    }
    this.runtimeInteractables = [];
    this.throwableObjects.clear();
    this.carriedThrowable = null;
    if (this.throwableMaterial) {
      this.throwableMaterial.dispose();
      this.throwableMaterial = null;
    }
  }

  private handleDebugKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Backquote') {
      this.eventBus.emit('debug:toggle', undefined);
      return;
    }
    if (e.code === 'F6') {
      e.preventDefault();
      const cycled = this.settings.cycleGraphicsProfile();
      this.renderer.setGraphicsProfile(cycled.graphicsProfile);
      const flags = this.renderer.getDebugFlags();
      const settings = this.settings.update({ aaMode: flags.aaMode });
      this.levelManager.setGraphicsProfile(settings.graphicsProfile);
      this.syncDebugPanel();
      console.log(`[Settings] graphicsProfile=${settings.graphicsProfile}, aaMode=${settings.aaMode}`);
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

    // Simulate GPU device loss (debug only)
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
      e.preventDefault();
      const r = this.renderer.renderer as any;
      if (typeof r.onDeviceLost === 'function') {
        r.onDeviceLost({ api: 'WebGPU', message: 'Simulated device loss (debug)', reason: null });
        console.warn('[Game] Simulated GPU device loss via Ctrl+Shift+L');
      }
      return;
    }

    // Navigation debug keys — only when editor is NOT active.
    if (this.editorManager?.isActive()) return;

    if (e.code === 'KeyN') {
      this.navDebugOverlay?.toggle();
      console.log(`[Nav] debug overlay toggled`);
      return;
    }
    if (e.code === 'KeyT') {
      if (!this.navPatrolSystem) return;
      this.navTargetMode = !this.navTargetMode;
      console.log(`[Nav] target mode ${this.navTargetMode ? 'ON — click floor to redirect nearest agent' : 'OFF'}`);
      if (this.navTargetMode) {
        // Exit pointer lock so the user gets a free cursor for clicking
        document.exitPointerLock();
        this._onNavTargetClick = (ev: MouseEvent) => this.handleNavTargetClick(ev);
        window.addEventListener('click', this._onNavTargetClick);
      } else {
        if (this._onNavTargetClick) {
          window.removeEventListener('click', this._onNavTargetClick);
          this._onNavTargetClick = null;
        }
      }
      return;
    }
  }

  private handleNavTargetClick(ev: MouseEvent): void {
    if (!this.navPatrolSystem || !this.navTargetMode) return;

    // Only raycast the walkable navigation platform — not the whole scene.
    const navPlatform = this.renderer.scene.getObjectByName('NavPlatform');
    if (!navPlatform) return;

    const rect = this.renderer.canvas.getBoundingClientRect();
    const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.navPointer.set(ndcX, ndcY);
    this.navRaycaster.setFromCamera(this.navPointer, this.renderer.camera);
    const hits = this.navRaycaster.intersectObjects([navPlatform], false);

    if (hits.length === 0) return;

    const hit = hits[0];
    const agent = this.navPatrolSystem.requestTargetForNearest(hit.point);

    if (agent) {
      console.log(`[Nav] target set at (${hit.point.x.toFixed(1)}, ${hit.point.y.toFixed(1)}, ${hit.point.z.toFixed(1)})`);
      this.showNavTargetMarker(hit.point);
      agent.highlight();
    } else {
      console.log('[Nav] click did not resolve to a walkable navmesh point');
    }

    // Auto-disable target mode; next canvas click will re-acquire pointer lock
    this.navTargetMode = false;
    if (this._onNavTargetClick) {
      window.removeEventListener('click', this._onNavTargetClick);
      this._onNavTargetClick = null;
    }
  }

  private showNavTargetMarker(position: THREE.Vector3): void {
    // Remove previous marker
    if (this.navTargetMarker) {
      this.renderer.scene.remove(this.navTargetMarker);
      this.navTargetMarker.geometry.dispose();
      (this.navTargetMarker.material as THREE.Material).dispose();
    }

    const geo = new THREE.RingGeometry(0.3, 0.5, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.navTargetMarker = new THREE.Mesh(geo, mat);
    this.navTargetMarker.position.set(position.x, position.y + 0.05, position.z);
    this.navTargetMarker.name = 'NavTargetMarker';
    this.renderer.scene.add(this.navTargetMarker);

    // Fade is driven from the render-loop update()
    this.navMarkerFade = 1;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    window.removeEventListener('keydown', this._onDebugKeyDown);
    if (this._onNavTargetClick) {
      window.removeEventListener('click', this._onNavTargetClick);
      this._onNavTargetClick = null;
    }
    if (this.navTargetMarker) {
      this.renderer.scene.remove(this.navTargetMarker);
      this.navTargetMarker.geometry.dispose();
      (this.navTargetMarker.material as THREE.Material).dispose();
      this.navTargetMarker = null;
    }
    this.interactionManager.dispose();
    this.playerController.dispose();
    this.camera.dispose();
    this.checkpointManager.dispose();
    this.objectiveManager.dispose();
    this.audioManager.dispose();
    this.gameParticles?.dispose();
    this.physicsDebugView?.dispose();
    this.throwableGeometries.sphere.dispose();
    this.throwableGeometries.box.dispose();
    this.throwableGeometries.cylinder.dispose();
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
