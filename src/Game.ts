import * as THREE from 'three';
import type { EventBus } from '@core/EventBus';
import type { FixedUpdatable, Updatable, Disposable, PostPhysicsUpdatable } from '@core/types';
import { UserSettingsStore } from '@core/UserSettings';
import { COLLISION_GROUP_INTERACTABLE, COLLISION_GROUP_WORLD } from '@core/constants';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { InputManager } from '@input/InputManager';
import type { LevelManager } from '@level/LevelManager';
import { getShowcaseBayTopY, getShowcaseStationZ } from '@level/ShowcaseLayout';
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
import { PhysicsDebugView } from '@physics/PhysicsDebugView';
import type { AudioManager } from '@audio/AudioManager';
import type { VehicleManager } from '@vehicle/VehicleManager';
import { DroneController } from '@vehicle/DroneController';
import { CarController } from '@vehicle/CarController';
import type { EditorManager } from '@editor/EditorManager';

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
  private physicsDebugView: PhysicsDebugView;
  private readonly fallRespawnY = -25;
  private runtimeInteractables: Array<{ id: string; dispose: () => void }> = [];
  private throwableObjects = new Map<number, ThrowableObject>();
  private carriedThrowable: ThrowableObject | null = null;
  private rope: PhysicsRope | null = null;

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
    this.eventBus.on('interaction:grabStart', ({ body, offset }) => {
      this.playerController.startGrab(body, offset);
    });
    this.eventBus.on('interaction:pickUp', ({ object }) => {
      this.carriedThrowable = object;
      this.playerController.startCarry(object);
      this.interactionManager.unregister(object.id);
    });
    this.eventBus.on('interaction:throw', () => {
      this.restoreThrownObject();
    });
    this.eventBus.on('interaction:drop', () => {
      this.restoreThrownObject();
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
      this.settings.update({ shadowsEnabled: enabled });
      this.renderer.setShadowsEnabled(enabled);
      this.levelManager.setShadowsEnabled(enabled);
      this.syncDebugPanel();
    });
    this.eventBus.on('debug:cameraCollision', (enabled) => {
      this.camera.setCollisionEnabled(enabled);
    });
    this.eventBus.on('debug:exposure', (value) => {
      this.renderer.setExposure(value);
    });
    this.eventBus.on('debug:graphicsProfile', ({ profile }) => {
      const settings = this.settings.update({ graphicsProfile: profile });
      this.renderer.setGraphicsProfile(settings.graphicsProfile);
      this.levelManager.setGraphicsProfile(settings.graphicsProfile);
      this.syncDebugPanel();
    });
    this.eventBus.on('debug:aoOnly', (enabled) => {
      this.renderer.setAoOnlyView(enabled);
      this.syncDebugPanel();
    });
    this.eventBus.on('debug:aaMode', ({ mode }) => {
      this.settings.update({ aaMode: mode });
      this.renderer.setAntiAliasingMode(mode);
    });
    this.eventBus.on('debug:ssaoEnabled', (enabled) => {
      this.renderer.setSsaoEnabled(enabled);
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
    this.eventBus.on('debug:lutName', (name) => {
      this.renderer.setLutName(name);
    });
    this.eventBus.on('debug:traaEnabled', (enabled) => {
      this.renderer.setTraaEnabled(enabled);
    });
    this.eventBus.on('debug:envBackgroundIntensity', (intensity) => {
      this.renderer.setBackgroundIntensity(intensity);
    });
    this.eventBus.on('debug:envBackgroundBlurriness', (blurriness) => {
      this.renderer.setBackgroundBlurriness(blurriness);
    });
    this.eventBus.on('debug:environment', (name) => {
      void this.renderer.setEnvironment(name);
    });
    this.eventBus.on('debug:showShadowFrustums', (enabled) => {
      this.levelManager.setShadowDebugEnabled(enabled);
      this.syncDebugPanel();
    });
    this.eventBus.on('debug:flythrough', () => {
      this.playerController.setActive(false);
      this.playerController.setEnabled(false);
      this.uiManager.hud.hideObjective();
      this.uiManager.hud.hidePrompt();
      const crosshair = document.getElementById('crosshair');
      if (crosshair) crosshair.style.opacity = '0';
      this.camera.startFlythrough();
    });
    this.eventBus.on('debug:flythroughEnd', () => {
      this.playerController.setActive(true);
      this.playerController.setEnabled(true);
      this.uiManager.hud.showObjective();
      const crosshair = document.getElementById('crosshair');
      if (crosshair) crosshair.style.opacity = '0.5';
      this.playerController.respawn();
    });

    this.syncDebugPanel();

    // Debug toggle on backtick
    window.addEventListener('keydown', this._onDebugKeyDown);

  }

  /** Fixed 60Hz tick. */
  fixedUpdate(dt: number): void {
    // Poll input — captures accumulated mouse deltas
    const input = this.inputManager.poll();
    this.playerController.setInput(input);
    this.vehicleManager.setInput(input);
    if (this.vehicleManager.isActive() && input.interactPressed) {
      this.vehicleManager.requestExit();
    }

    // Apply mouse deltas to camera (consumed here, not in render loop)
    const lookMode = this.vehicleManager.getCameraLookMode();
    this.camera.handleMouseInput(input.mouseDeltaX, lookMode === 'yawOnly' ? 0 : input.mouseDeltaY);
    this.camera.handleZoomInput(input.mouseWheelDelta);

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
        return;
      }
      _prevPos.copy(this.prevPlayerPos);
      const dx = _currPos.x - _prevPos.x;
      const dz = _currPos.z - _prevPos.z;
      this.speed = Math.sqrt(dx * dx + dz * dz) / dt;
      this.prevPlayerPos.copy(_currPos);
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
      this.physicsDebugView.update();
      return;
    }
    // Update visual interpolation
    if (!this.vehicleManager.isActive()) {
      this.playerController.update(dt, alpha);
    }
    const lightingPos = this.camera.isFlythrough ? this.camera.position : this.playerController.position;
    this.levelManager.updateLighting(lightingPos);
    this.levelManager.update(dt, alpha);
    // Always update vehicles (active + parked) so parked drone/vehicles visually follow physics.
    this.vehicleManager.update(dt, alpha);
    this.rope?.renderUpdate(alpha);
    for (const throwable of this.throwableObjects.values()) {
      throwable.renderUpdate(alpha);
    }
    this.physicsDebugView.update();

    // Camera follows player (runs every render frame for smoothness)
    this.camera.update(dt, alpha);
    const renderStats = this.renderer.getRenderStats();

    // Debug panel
    const stateId = this.vehicleManager.isActive() ? 'vehicle' : this.playerController.fsm.current;
    const grounded = this.vehicleManager.isActive() ? false : this.playerController.isGrounded;
    this.uiManager.debugPanel.tick(
      this.speed,
      stateId,
      grounded,
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

  /** Push current renderer state to the debug panel. */
  private syncDebugPanel(): void {
    const f = this.renderer.getDebugFlags();
    this.uiManager.debugPanel.syncRenderSettings({
      postProcessingEnabled: f.postProcessingEnabled,
      shadowsEnabled: f.shadowsEnabled,
      graphicsProfile: f.graphicsProfile,
      aaMode: f.aaMode,
      aoOnly: f.aoOnly,
      exposure: f.exposure,
      ssaoEnabled: f.ssaoEnabled,
      ssrEnabled: f.ssrEnabled,
      ssrOpacity: f.ssrOpacity,
      ssrResolutionScale: f.ssrResolutionScale,
      bloomEnabled: f.bloomEnabled,
      bloomStrength: f.bloomStrength,
      vignetteEnabled: f.vignetteEnabled,
      vignetteDarkness: f.vignetteDarkness,
      lutEnabled: f.lutEnabled,
      lutStrength: f.lutStrength,
      lutName: f.lutName,
      traaEnabled: f.traaEnabled,
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
    this.audioManager.playMusic('/assets/audio/ambient.mp3', 2.0);
  }

  teardownLevel(): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();
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
    if (shape === 'sphere') {
      return new THREE.Mesh(new THREE.SphereGeometry(size, 16, 16), material);
    }
    if (shape === 'cylinder') {
      return new THREE.Mesh(new THREE.CylinderGeometry(size * 0.6, size * 0.6, size * 1.2, 16), material);
    }
    return new THREE.Mesh(new THREE.BoxGeometry(size * 2, size * 2, size * 2), material);
  }

  private spawnVehicles(): void {
    const zVehicles = getShowcaseStationZ('vehicles');
    const bayTopY = getShowcaseBayTopY();
    const drone = new DroneController(
      'drone-1',
      new THREE.Vector3(-6, bayTopY + 2.2, zVehicles),
      this.physicsWorld,
      this.renderer.scene,
    );
    const car = new CarController(
      'car-1',
      new THREE.Vector3(6, bayTopY + 0.42, zVehicles),
      this.physicsWorld,
      this.renderer.scene,
    );
    this.vehicleManager.register(drone);
    this.vehicleManager.register(car);

    const droneSeat = this.createVehicleSeat('seat-drone', 'Fly', drone, new THREE.Vector3(0, 0.6, 0));
    const carSeat = this.createVehicleSeat('seat-car', 'Drive', car, new THREE.Vector3(0, 0.5, 1));
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
  }

  private handleDebugKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Backquote') {
      this.eventBus.emit('debug:toggle', undefined);
      return;
    }
    if (e.code === 'F5') {
      e.preventDefault();
      this.eventBus.emit('debug:flythrough', undefined);
      return;
    }
    if (e.code === 'F6') {
      e.preventDefault();
      const settings = this.settings.cycleGraphicsProfile();
      this.renderer.setGraphicsProfile(settings.graphicsProfile);
      this.levelManager.setGraphicsProfile(settings.graphicsProfile);
      this.syncDebugPanel();
      console.log(`[Settings] graphicsProfile=${settings.graphicsProfile}`);
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
