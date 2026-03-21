import RAPIER from '@dimforge/rapier3d-compat';
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
    { SHOWCASE_STATION_ORDER },
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

  const renderer = new RendererManager();
  await renderer.init();
  // Wire KTX2 support early so all AssetLoader instances detect compressed texture formats.
  AssetLoader.initRendererSupport(renderer.renderer as THREE.WebGLRenderer);
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

  /** Yield to browser so CSS animations and paint can run */
  const yieldToRenderer = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  const startGame = async (): Promise<void> => {
    if (levelLoaded) return;
    if (editorManager?.isActive()) editorManager.toggle();
    await uiManager.loadingScreen.show();
    // Start render loop with simulation DISABLED so the loading screen CSS
    // animations stay alive. Physics/game logic is skipped — only the renderer
    // paints frames (hidden behind the loading screen at z-index 1300).
    gameLoop.setSimulationEnabled(false);
    if (!gameLoop.isRunning()) gameLoop.start();
    await yieldToRenderer();
    await levelManager.load('procedural');
    playerController.spawn(levelManager.getSpawnPoint());
    // Warm the Rapier query pipeline so first-tick raycasts are valid.
    physicsWorld.step();
    game.setupLevel();
    gameLoop.setSimulationEnabled(true);
    await uiManager.loadingScreen.hide();
    levelLoaded = true;
  };

  const returnToMainMenu = async (): Promise<void> => {
    if (!levelLoaded) return;
    if (editorManager?.isActive()) editorManager.toggle();
    gameLoop.stop();
    game.teardownLevel();
    levelManager.unload();
    audioManager.stopMusic(1.5);
    levelLoaded = false;
  };

  const startSavedLevel = async (key: string): Promise<void> => {
    if (editorManager?.isActive()) editorManager.toggle();
    if (levelLoaded) {
      game.teardownLevel();
      levelManager.unload();
      levelLoaded = false;
    }
    const data = LevelSaveStore.load(key);
    if (!data) {
      console.error(`[Kinema] Failed to load saved level "${key}"`);
      return;
    }
    await uiManager.loadingScreen.show();
    gameLoop.setSimulationEnabled(false);
    if (!gameLoop.isRunning()) gameLoop.start();
    await yieldToRenderer();
    await levelManager.loadFromJSON(data);
    playerController.spawn(levelManager.getSpawnPoint());
    physicsWorld.step();
    game.setupCustomLevel();
    gameLoop.setSimulationEnabled(true);
    await uiManager.loadingScreen.hide();
    levelLoaded = true;
  };

  const startBlankLevelForEditor = async (): Promise<void> => {
    if (levelLoaded) {
      game.teardownLevel();
      levelManager.unload();
      levelLoaded = false;
    }
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
    // Open the editor
    eventBus.emit('editor:toggle', undefined);
  };

  const startStation = async (key: string): Promise<void> => {
    if (levelLoaded) {
      game.teardownLevel();
      levelManager.unload();
      levelLoaded = false;
    }
    await uiManager.loadingScreen.show();
    gameLoop.setSimulationEnabled(false);
    if (!gameLoop.isRunning()) gameLoop.start();
    await yieldToRenderer();
    await levelManager.loadStation(key as import('@level/ShowcaseLayout').ShowcaseStationKey);
    playerController.spawn(levelManager.getSpawnPoint());
    physicsWorld.step();
    game.setupStation(key as import('@level/ShowcaseLayout').ShowcaseStationKey);
    gameLoop.setSimulationEnabled(true);
    await uiManager.loadingScreen.hide();
    levelLoaded = true;
  };

  // Expose debug API for automated testing (Playwright, etc.)
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
        altitudeUp: false, altitudeDown: false, moveX: 0, moveY: 0,
        sprint: false, mouseDeltaX: 0, mouseDeltaY: 0, mouseWheelDelta: 0,
      };
      game.testInputOverride = jumpInput;
      game.testInputFrames = 10; // Active for 10 render frames
    },
    /** Set camera look angles for headless screenshot capture. */
    setCameraLook(pitch: number, yaw: number) {
      camera.snapToAngle(yaw, pitch);
    },
    /** Simulate movement input for several frames (headless testing). */
    simulateMove(moveX: number, moveY: number, frames = 30) {
      const moveInput = {
        forward: moveY > 0, backward: moveY < 0, left: moveX < 0, right: moveX > 0,
        crouch: false, crouchPressed: false, jump: false, jumpPressed: false,
        interact: false, interactPressed: false, primary: false, primaryPressed: false,
        altitudeUp: false, altitudeDown: false, moveX, moveY,
        sprint: false, mouseDeltaX: 0, mouseDeltaY: 0, mouseWheelDelta: 0,
      };
      game.testInputOverride = moveInput;
      game.testInputFrames = frames;
    },
    get config() {
      return playerController.config;
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

  // Check for ?station= query param to load a single station directly.
  const params = new URLSearchParams(window.location.search);
  const stationParam = params.get('station');
  if (stationParam && SHOWCASE_STATION_ORDER.includes(stationParam as import('@level/ShowcaseLayout').ShowcaseStationKey)) {
    await startStation(stationParam);
    gameLoop.start();
    console.log(`[Kinema] Station "${stationParam}" started directly`);
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

    // Cleanup on page unload to release GPU / audio / physics resources.
    window.addEventListener('beforeunload', () => {
      gameLoop.stop();
      game.dispose();
      menuManager.dispose();
    });

    console.log('[Kinema] Game started');
  }
}

bootstrap().catch((err) => {
  console.error('[Kinema] Fatal bootstrap error:', err);
  showBootstrapError(err);
});
