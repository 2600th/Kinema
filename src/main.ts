import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState } from '@core/types';
import * as THREE from 'three';

function showBootstrapError(err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const pre = document.createElement('pre');
  pre.style.cssText = [
    'position:fixed',
    'inset:0',
    'margin:0',
    'padding:24px',
    'background:#111',
    'color:#f7f7f7',
    'font:14px/1.5 Consolas, "Courier New", monospace',
    'white-space:pre-wrap',
    'z-index:99999',
  ].join(';');
  pre.textContent = `[Kinema] Fatal bootstrap error\n\n${message}`;
  if (document.body) {
    document.body.appendChild(pre);
  }
}

async function bootstrap(): Promise<void> {
  const bootstrapParams = new URLSearchParams(window.location.search);
  const forceWebGL = /^(1|true)$/i.test(bootstrapParams.get('forceWebGL') ?? '');

  // Initialize Rapier WASM
  await RAPIER.init();
  console.log('[Kinema] Rapier WASM initialized');

  // Dynamic imports — parallelized so bundler/browser can fetch all chunks concurrently.
  const [
    { RendererManager },
    { PhysicsWorld },
    { GameLoop },
    { EventBus },
    { InputManager },
    { LevelManager },
    { PlayerController },
    { OrbitFollowCamera },
    { InteractionManager },
    { UIManager },
    { UserSettingsStore },
    { AudioManager },
    { VehicleManager },
    { MenuManager },
    { LevelSaveStore },
    { SHOWCASE_STATION_ORDER, PROCEDURAL_REVIEW_SPAWN_ORDER, resolveProceduralReviewSpawn },
    { Game },
    { AssetLoader },
  ] = await Promise.all([
    import('@renderer/RendererManager'),
    import('@physics/PhysicsWorld'),
    import('@core/GameLoop'),
    import('@core/EventBus'),
    import('@input/InputManager'),
    import('@level/LevelManager'),
    import('@character/PlayerController'),
    import('@camera/OrbitFollowCamera'),
    import('@interaction/InteractionManager'),
    import('@ui/UIManager'),
    import('@core/UserSettings'),
    import('@audio/AudioManager'),
    import('@vehicle/VehicleManager'),
    import('@ui/menus/MenuManager'),
    import('@level/LevelSaveStore'),
    import('@level/ShowcaseLayout'),
    import('./Game'),
    import('@level/AssetLoader'),
  ]);

  const settings = UserSettingsStore.load();

  const renderer = new RendererManager({ forceWebGL });
  await renderer.init();
  // Wire KTX2 support early so all AssetLoader instances detect compressed texture formats.
  AssetLoader.initRendererSupport(renderer.renderer);
  renderer.setGraphicsProfile(settings.value.graphicsProfile);
  renderer.setAntiAliasingMode(settings.value.aaMode);
  renderer.setResolutionScale(settings.value.resolutionScale);
  renderer.setShadowsEnabled(settings.value.shadowsEnabled);
  renderer.setShadowQualityTier(settings.value.shadowQuality);
  renderer.setEnvironmentRotationDegrees(settings.value.envRotationDegrees);
  renderer.setCasEnabled(settings.value.casEnabled);
  renderer.setCasStrength(settings.value.casStrength);
  console.log('[Kinema] Renderer initialized');

  const eventBus = new EventBus();
  const physicsWorld = PhysicsWorld.create();
  const inputManager = new InputManager(eventBus, renderer.canvas);
  inputManager.setRawMouseInput(settings.value.rawMouseInput);
  inputManager.setGamepadTuning(settings.value.gamepadDeadzone, settings.value.gamepadCurve);
  inputManager.initTouchControls();
  const levelManager = new LevelManager(renderer.scene, physicsWorld, eventBus, renderer.maxAnisotropy);
  levelManager.setGraphicsProfile(settings.value.graphicsProfile);
  levelManager.setShadowsEnabled(settings.value.shadowsEnabled);
  levelManager.setShadowQualityTier(settings.value.shadowQuality);
  const playerController = new PlayerController(physicsWorld, renderer.scene, eventBus, levelManager.getAssetLoader());
  const camera = new OrbitFollowCamera(renderer.camera, playerController, physicsWorld, eventBus);
  camera.setMouseSensitivity(settings.value.mouseSensitivity);
  camera.setInvertY(settings.value.invertY);
  renderer.camera.fov = settings.value.cameraFov;
  camera.setBaseFov(settings.value.cameraFov);
  renderer.camera.updateProjectionMatrix();
  const interactionManager = new InteractionManager(physicsWorld, playerController, eventBus);
  const uiManager = new UIManager(eventBus);
  const audioManager = new AudioManager(eventBus, playerController, inputManager, settings);
  const vehicleManager = new VehicleManager(eventBus, playerController, camera, interactionManager);

  const game = new Game(
    renderer,
    physicsWorld,
    eventBus,
    inputManager,
    levelManager,
    playerController,
    camera,
    interactionManager,
    uiManager,
    settings,
    vehicleManager,
    audioManager,
  );

  const gameLoop = new GameLoop(game, renderer, physicsWorld);
  gameLoop.setHitstop(game.hitstop);
  let editorManager: import('@editor/EditorManager').EditorManager | null = null;
  const unsubEditorBootstrap = eventBus.on('editor:toggle', () => {
    // First toggle: lazy-load the editor module, then let EditorManager own future toggles.
    void (async () => {
      if (editorManager) return;
      unsubEditorBootstrap();
      const { EditorManager } = await import('@editor/EditorManager');
      editorManager = new EditorManager(
        renderer,
        physicsWorld,
        eventBus,
        gameLoop,
        levelManager,
        playerController,
        interactionManager,
      );
      game.setEditorManager(editorManager);
      editorManager.toggle();
    })();
  });

  let levelLoaded = false;
  type ProceduralRunDescriptor = {
    kind: 'procedural';
    reviewSpawnKey: string | null;
    camYaw: number | null;
    camPitch: number | null;
  };
  type RunDescriptor =
    | ProceduralRunDescriptor
    | { kind: 'station'; key: import('@level/ShowcaseLayout').ShowcaseStationKey }
    | { kind: 'saved'; key: string }
    | { kind: 'editor-blank' };
  let currentRun: RunDescriptor | null = null;
  let restartInFlight = false;

  /** Yield to browser so CSS animations and paint can run */
  const yieldToRenderer = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const parseFiniteParam = (value: string | null): number | null => {
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const applyCameraPose = (yaw: number | null, pitch: number | null): void => {
    if (yaw == null || pitch == null) return;
    camera.snapToAngle(yaw, pitch);
  };

  const cloneRun = (run: RunDescriptor): RunDescriptor => {
    if (run.kind === 'procedural') {
      return { ...run };
    }
    if (run.kind === 'station' || run.kind === 'saved') {
      return { ...run };
    }
    return { kind: 'editor-blank' };
  };

  const getProceduralRunFromLocation = (): ProceduralRunDescriptor => {
    const params = new URLSearchParams(window.location.search);
    return {
      kind: 'procedural',
      reviewSpawnKey: params.get('spawn'),
      camYaw: parseFiniteParam(params.get('camYaw')),
      camPitch: parseFiniteParam(params.get('camPitch')),
    };
  };

  const unloadCurrentRun = (): void => {
    if (!levelLoaded) return;
    game.teardownLevel();
    levelManager.unload();
    levelLoaded = false;
  };

  const prepareSceneLoad = async (): Promise<void> => {
    if (editorManager?.isActive()) editorManager.toggle();
    await uiManager.loadingScreen.show();
    // Start render loop with simulation DISABLED so the loading screen CSS
    // animations stay alive. Physics/game logic is skipped — only the renderer
    // paints frames (hidden behind the loading screen at z-index 1300).
    gameLoop.setSimulationEnabled(false);
    if (!gameLoop.isRunning()) gameLoop.start();
    unloadCurrentRun();
    await yieldToRenderer();
  };

  const finishSceneLoad = async (): Promise<void> => {
    gameLoop.setSimulationEnabled(true);
    await uiManager.loadingScreen.hide();
    levelLoaded = true;
  };

  const startGame = async (descriptor = getProceduralRunFromLocation()): Promise<void> => {
    await prepareSceneLoad();
    const reviewSpawn = descriptor.reviewSpawnKey ? resolveProceduralReviewSpawn(descriptor.reviewSpawnKey) : null;

    await levelManager.load('procedural');
    playerController.spawn(reviewSpawn?.spawn ?? levelManager.getSpawnPoint());
    applyCameraPose(
      descriptor.camYaw ?? reviewSpawn?.cameraYaw ?? null,
      descriptor.camPitch ?? reviewSpawn?.cameraPitch ?? null,
    );
    // Warm the Rapier query pipeline so first-tick raycasts are valid.
    physicsWorld.step();
    game.setupLevel();
    currentRun = cloneRun(descriptor);
    await finishSceneLoad();
  };

  const returnToMainMenu = async (): Promise<void> => {
    if (!levelLoaded) return;
    if (editorManager?.isActive()) editorManager.toggle();
    gameLoop.stop();
    game.teardownLevel();
    levelManager.unload();
    audioManager.stopMusic(1.5);
    levelLoaded = false;
    currentRun = null;
    restartInFlight = false;
  };

  const startSavedLevel = async (key: string): Promise<void> => {
    const data = LevelSaveStore.load(key);
    if (!data) {
      console.error(`[Kinema] Failed to load saved level "${key}"`);
      return;
    }
    await prepareSceneLoad();
    await levelManager.loadFromJSON(data);
    playerController.spawn(levelManager.getSpawnPoint());
    physicsWorld.step();
    game.setupCustomLevel();
    currentRun = { kind: 'saved', key };
    await finishSceneLoad();
  };

  const startBlankLevelForEditor = async (): Promise<void> => {
    unloadCurrentRun();
    // Minimal blank level: a floor platform so the player can stand
    const blankLevel: import('@editor/LevelSerializer').LevelDataV2 = {
      version: 2,
      name: 'Untitled',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      spawnPoint: { position: [0, 2, 0] },
      objects: [
        {
          id: 'floor-0',
          name: 'Floor',
          parentId: null,
          source: { type: 'primitive', primitive: 'cube' },
          transform: {
            position: [0, -0.5, 0],
            rotation: [0, 0, 0],
            scale: [20, 1, 20],
          },
          physics: { type: 'static' },
          material: {
            color: '#4a5568',
            roughness: 0.8,
            metalness: 0,
            emissive: '#000000',
            emissiveIntensity: 0,
            opacity: 1,
          },
        },
      ],
    };
    await levelManager.loadFromJSON(blankLevel);
    playerController.spawn(levelManager.getSpawnPoint());
    physicsWorld.step();
    game.setupCustomLevel();
    levelLoaded = true;
    currentRun = { kind: 'editor-blank' };
    // Open the editor
    eventBus.emit('editor:toggle', undefined);
  };

  const startStation = async (key: string): Promise<void> => {
    await prepareSceneLoad();
    await levelManager.loadStation(key as import('@level/ShowcaseLayout').ShowcaseStationKey);
    playerController.spawn(levelManager.getSpawnPoint());
    physicsWorld.step();
    game.setupStation(key as import('@level/ShowcaseLayout').ShowcaseStationKey);
    currentRun = { kind: 'station', key: key as import('@level/ShowcaseLayout').ShowcaseStationKey };
    await finishSceneLoad();
  };

  const restartCurrentRun = async (): Promise<void> => {
    if (restartInFlight || !currentRun) return;
    restartInFlight = true;
    try {
      const run = cloneRun(currentRun);
      if (run.kind === 'procedural') {
        await startGame(run);
      } else if (run.kind === 'station') {
        await startStation(run.key);
      } else if (run.kind === 'saved') {
        await startSavedLevel(run.key);
      } else {
        await startBlankLevelForEditor();
      }
    } finally {
      restartInFlight = false;
    }
  };

  eventBus.on('run:restartRequested', () => {
    void restartCurrentRun();
  });

  // Expose debug API for automated testing (Playwright, etc.)
  // Gated behind DEV to tree-shake new Function() evaluator from production builds.
  if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__KINEMA__ = {
    get player() {
      const pos = playerController.position;
      const vel = playerController.body.linvel();
      return {
        position: { x: pos.x, y: pos.y, z: pos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
        isGrounded: playerController.isGrounded,
        state: playerController.fsm.current,
        verticalVelocity: playerController.verticalVelocity,
      };
    },
    simulateJump() {
      // Set testInputOverride on Game so beginFrame() uses it for several
      // frames instead of polling InputManager (which requires pointer lock).
      // At ~4 FPS (SwiftShader), we need several frames to ensure the input
      // is seen by at least one fixedUpdate physics tick.
      const jumpInput = {
        forward: false, backward: false, left: false, right: false,
        crouch: false, crouchPressed: false, jump: true, jumpPressed: true,
        interact: false, interactPressed: false, primary: false, primaryPressed: false,
        altitudeUp: false, altitudeDown: false, vehicleVertical: 0, moveX: 0, moveY: 0,
        sprint: false, mouseDeltaX: 0, mouseDeltaY: 0, mouseWheelDelta: 0,
      };
      game.testInputOverride = jumpInput;
      game.testInputFrames = 10; // Active for 10 render frames
    },
    /** Set camera look angles for headless screenshot capture. */
    setCameraLook(pitch: number, yaw: number) {
      camera.snapToAngle(yaw, pitch);
    },
    listReviewSpawns() {
      return [...PROCEDURAL_REVIEW_SPAWN_ORDER];
    },
    teleportToReviewSpawn(key: string) {
      const reviewSpawn = resolveProceduralReviewSpawn(key);
      if (!reviewSpawn) return false;
      playerController.spawn(reviewSpawn.spawn);
      camera.snapToAngle(reviewSpawn.cameraYaw, reviewSpawn.cameraPitch);
      return true;
    },
    /** Simulate movement input for several frames (headless testing). */
    simulateMove(moveX: number, moveY: number, frames = 30) {
      const moveInput = {
        forward: moveY > 0, backward: moveY < 0, left: moveX < 0, right: moveX > 0,
        crouch: false, crouchPressed: false, jump: false, jumpPressed: false,
        interact: false, interactPressed: false, primary: false, primaryPressed: false,
        altitudeUp: false, altitudeDown: false, vehicleVertical: 0, moveX, moveY,
        sprint: false, mouseDeltaX: 0, mouseDeltaY: 0, mouseWheelDelta: 0,
      };
      game.testInputOverride = moveInput;
      game.testInputFrames = frames;
    },
    listVehicles() {
      return vehicleManager.getVehicleIds();
    },
    getVehicleState(id: string) {
      const vehicle = vehicleManager.getVehicle(id);
      if (!vehicle) return null;
      const pos = vehicle.body.translation();
      const vel = vehicle.body.linvel();
      const debug = (vehicle as { getDebugState?: () => unknown }).getDebugState?.();
      return {
        id,
        active: vehicleManager.isActive() && vehicleManager.getVehicle(id) === vehicle,
        position: { x: pos.x, y: pos.y, z: pos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
        debug,
      };
    },
    enterVehicle(id: string) {
      const vehicle = vehicleManager.getVehicle(id);
      if (!vehicle) return false;
      eventBus.emit('vehicle:enter', { vehicle });
      return true;
    },
    resetVehicle(id: string) {
      const vehicle = vehicleManager.getVehicle(id);
      if (!vehicle?.resetToSpawn) return false;
      vehicle.resetToSpawn();
      return true;
    },
    simulateVehicleInput(input: Partial<InputState>, frames = 30) {
      const vehicleInput: InputState = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        crouch: false,
        crouchPressed: false,
        jump: false,
        jumpPressed: false,
        interact: false,
        interactPressed: false,
        primary: false,
        primaryPressed: false,
        altitudeUp: false,
        altitudeDown: false,
        vehicleVertical: 0,
        moveX: 0,
        moveY: 0,
        sprint: false,
        mouseDeltaX: 0,
        mouseDeltaY: 0,
        mouseWheelDelta: 0,
        ...input,
      };
      game.testInputOverride = vehicleInput;
      game.testInputFrames = frames;
    },
    get config() {
      return playerController.config;
    },
    getCollectibleCount() {
      return game.getCollectibleCount();
    },
    getHealth() {
      return game.getHealthState();
    },
    listCollectibles() {
      return game.listRemainingCollectibles();
    },
    listHazards() {
      return game.listHazards();
    },
    teleportToCollectible(id?: string) {
      return game.teleportPlayerToCollectible(id);
    },
    teleportToHazard(id?: string) {
      return game.teleportPlayerToHazard(id);
    },
    teleportPlayer(position: { x: number; y: number; z: number }) {
      return game.teleportPlayer(new THREE.Vector3(position.x, position.y, position.z));
    },
    forcePlayerPosition(position: { x: number; y: number; z: number }) {
      playerController.body.setTranslation(new RAPIER.Vector3(position.x, position.y, position.z), true);
      playerController.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
      playerController.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
      return true;
    },
    /** Wait for a condition on player state, polling at physics rate. */
    waitFor(predicate: string, timeoutMs = 5000): Promise<boolean> {
      const fn = new Function('p', `return ${predicate}`) as (p: any) => boolean;
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const check = () => {
          const pos = playerController.position;
          const vel = playerController.body.linvel();
          const p = {
            x: pos.x, y: pos.y, z: pos.z,
            vx: vel.x, vy: vel.y, vz: vel.z,
            isGrounded: playerController.isGrounded,
            state: playerController.fsm.current,
          };
          if (fn(p)) { resolve(true); return; }
          if (Date.now() > deadline) { resolve(false); return; }
          requestAnimationFrame(check);
        };
        check();
      });
    },
  };
  } // if (import.meta.env.DEV)

  // Check for ?station= query param to load a single station directly.
  const params = new URLSearchParams(window.location.search);
  const stationParam = params.get('station');
  const reviewSpawnParam = params.get('spawn');
  const registerUnload = (menuManager: import('@ui/menus/MenuManager').MenuManager | null): void => {
    window.addEventListener('beforeunload', () => {
      gameLoop.stop();
      game.dispose();
      menuManager?.dispose();
    });
  };
  if (stationParam && SHOWCASE_STATION_ORDER.includes(stationParam as import('@level/ShowcaseLayout').ShowcaseStationKey)) {
    await startStation(stationParam);
    gameLoop.start();
    registerUnload(null);
    console.log(`[Kinema] Station "${stationParam}" started directly`);
  } else if (reviewSpawnParam) {
    await startGame(getProceduralRunFromLocation());
    gameLoop.start();
    registerUnload(null);
    console.log(`[Kinema] Procedural level started at review spawn "${reviewSpawnParam}"`);
  } else {
    const menuManager = new MenuManager(
      eventBus,
      gameLoop,
      renderer,
      settings,
      inputManager,
      camera,
      audioManager,
      startGame,
      startSavedLevel,
      returnToMainMenu,
      startBlankLevelForEditor,
    );
    menuManager.showMainMenu();
    registerUnload(menuManager);

    console.log('[Kinema] Game started');
  }
}

bootstrap().catch((err) => {
  console.error('[Kinema] Fatal bootstrap error:', err);
  showBootstrapError(err);
});
