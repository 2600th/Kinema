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
  const { Game } = await import('./Game');

  const settings = UserSettingsStore.load();

  const renderer = new RendererManager();
  await renderer.init();
  renderer.setGraphicsQuality(settings.value.graphicsQuality);
  console.log('[Kinema] Renderer initialized');

  const eventBus = new EventBus();
  const physicsWorld = PhysicsWorld.create();
  const inputManager = new InputManager(eventBus, renderer.canvas);
  inputManager.setRawMouseInput(settings.value.rawMouseInput);
  inputManager.setGamepadTuning(settings.value.gamepadDeadzone, settings.value.gamepadCurve);
  const levelManager = new LevelManager(renderer.scene, physicsWorld, eventBus, renderer.maxAnisotropy);
  levelManager.setGraphicsQuality(settings.value.graphicsQuality);
  const playerController = new PlayerController(physicsWorld, renderer.scene, eventBus);
  const camera = new OrbitFollowCamera(renderer.camera, playerController, physicsWorld, eventBus);
  camera.setMouseSensitivity(settings.value.mouseSensitivity);
  camera.setInvertY(settings.value.invertY);
  renderer.camera.fov = settings.value.cameraFov;
  camera.setBaseFov(settings.value.cameraFov);
  renderer.camera.updateProjectionMatrix();
  const interactionManager = new InteractionManager(physicsWorld, playerController, eventBus);
  const uiManager = new UIManager(eventBus);

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
  );

  const gameLoop = new GameLoop(game, renderer, physicsWorld);

  // Load the test level and start
  await levelManager.load('procedural');
  playerController.spawn(levelManager.getSpawnPoint());
  gameLoop.start();

  console.log('[Kinema] Game started');
}

bootstrap().catch((err) => {
  console.error('[Kinema] Fatal bootstrap error:', err);
  showBootstrapError(err);
});
