import RAPIER from '@dimforge/rapier3d-compat';

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
  const { Game } = await import('./Game');

  const renderer = new RendererManager();
  await renderer.init();
  console.log('[Kinema] Renderer initialized');

  const eventBus = new EventBus();
  const physicsWorld = PhysicsWorld.create();
  const inputManager = new InputManager(eventBus, renderer.canvas);
  const levelManager = new LevelManager(renderer.scene, physicsWorld, eventBus, renderer.maxAnisotropy);
  const playerController = new PlayerController(physicsWorld, renderer.scene, eventBus);
  const camera = new OrbitFollowCamera(renderer.camera, playerController, physicsWorld, eventBus);
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
});
