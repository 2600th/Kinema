import RAPIER from '@dimforge/rapier3d-compat';

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

  // Dynamic import to ensure WASM is ready before any physics usage
  const { RendererManager } = await import('@renderer/RendererManager');
  const { PhysicsWorld } = await import('@physics/PhysicsWorld');
  const { GameLoop } = await import('@core/GameLoop');
  const { EventBus } = await import('@core/EventBus');
  const { InputManager } = await import('@input/InputManager');
  const { LevelManager } = await import('@level/LevelManager');
  const { PlayerController } = await import('@character/PlayerController');
  const { OrbitFollowCamera } = await import('@camera/OrbitFollowCamera');
  const { InteractionManager } = await import('@interaction/InteractionManager');
  const { UIManager } = await import('@ui/UIManager');
  const { UserSettingsStore } = await import('@core/UserSettings');
  const { AudioManager } = await import('@audio/AudioManager');
  const { VehicleManager } = await import('@vehicle/VehicleManager');
  const { MenuManager } = await import('@ui/menus/MenuManager');
  const { LevelSaveStore } = await import('@level/LevelSaveStore');
  const { Game } = await import('./Game');

  const settings = UserSettingsStore.load();

  const renderer = new RendererManager();
  await renderer.init();
  renderer.setGraphicsProfile(settings.value.graphicsProfile);
  renderer.setAntiAliasingMode(settings.value.aaMode);
  renderer.setResolutionScale(settings.value.resolutionScale);
  renderer.setShadowsEnabled(settings.value.shadowsEnabled);
  console.log('[Kinema] Renderer initialized');

  const eventBus = new EventBus();
  const physicsWorld = PhysicsWorld.create();
  const inputManager = new InputManager(eventBus, renderer.canvas);
  inputManager.setRawMouseInput(settings.value.rawMouseInput);
  inputManager.setGamepadTuning(settings.value.gamepadDeadzone, settings.value.gamepadCurve);
  const levelManager = new LevelManager(renderer.scene, physicsWorld, eventBus, renderer.maxAnisotropy);
  levelManager.setGraphicsProfile(settings.value.graphicsProfile);
  levelManager.setShadowsEnabled(settings.value.shadowsEnabled);
  const playerController = new PlayerController(physicsWorld, renderer.scene, eventBus);
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

  const musicUrl = (() => {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_MUSIC_URL;
    if (typeof raw !== 'string' || raw.trim().length === 0) return null;
    const trimmed = raw.trim();
    // If relative to this module, resolve as file-relative. Otherwise treat as a normal URL/path.
    if (trimmed.startsWith('.')) {
      try {
        return new URL(trimmed, import.meta.url).href;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  })();
  let levelLoaded = false;

  const startGame = async (): Promise<void> => {
    if (levelLoaded) return;
    await levelManager.load('procedural');
    playerController.spawn(levelManager.getSpawnPoint());
    game.setupLevel();
    if (musicUrl) {
      audioManager.playMusic(musicUrl, 2.0);
    }
    levelLoaded = true;
  };

  const returnToMainMenu = async (): Promise<void> => {
    if (!levelLoaded) return;
    gameLoop.stop();
    game.teardownLevel();
    levelManager.unload();
    audioManager.stopMusic(1.5);
    levelLoaded = false;
  };

  const startSavedLevel = async (key: string): Promise<void> => {
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
    await levelManager.loadFromJSON(data);
    playerController.spawn(levelManager.getSpawnPoint());
    game.setupCustomLevel();
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
    game.setupCustomLevel();
    levelLoaded = true;
    // Open the editor
    eventBus.emit('editor:toggle', undefined);
  };

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

  console.log('[Kinema] Game started');
}

bootstrap().catch((err) => {
  console.error('[Kinema] Fatal bootstrap error:', err);
  showBootstrapError(err);
});
