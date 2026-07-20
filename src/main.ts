import type { KinemaDebugApi, KinemaInteractionEvent } from "@core/KinemaDebugApi";
import { shouldUseCompatibilityRenderer } from "@core/mobilePlatform";
import type { InputState } from "@core/types";
import RAPIER from "@dimforge/rapier3d-compat";
import { getInputGlyph } from "@input/InputGlyphs";
import { pickPostEffectSettings } from "@renderer/rendererState";
import type { CarController } from "@vehicle/CarController";
import type { VehicleController } from "@vehicle/VehicleController";
import * as THREE from "three";

function isCarController(vehicle: VehicleController | null): vehicle is CarController {
  return vehicle?.type === "car";
}

function showBootstrapError(err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const pre = document.createElement("pre");
  pre.style.cssText = [
    "position:fixed",
    "inset:0",
    "margin:0",
    "padding:24px",
    "background:#111",
    "color:#f7f7f7",
    'font:14px/1.5 Consolas, "Courier New", monospace',
    "white-space:pre-wrap",
    "z-index:var(--k-z-fatal, 99999)",
  ].join(";");
  pre.textContent = `[Kinema] Fatal bootstrap error\n\n${message}`;
  if (document.body) {
    document.body.appendChild(pre);
  }
}

async function bootstrap(): Promise<void> {
  const bootstrapParams = new URLSearchParams(window.location.search);
  const forceCompatibilityRenderer = /^(1|true)$/i.test(
    bootstrapParams.get("forceWebGL") ?? bootstrapParams.get("forceCompat") ?? "",
  );
  const forceWebGPUWebGL = /^(1|true)$/i.test(bootstrapParams.get("forceWebGPUWebGL") ?? "");
  const allowExperimentalRenderer = /^(1|true)$/i.test(bootstrapParams.get("experimentalRenderer") ?? "");

  // Initialize Rapier WASM
  // `@dimforge/rapier3d-compat@0.19.3` emits this deprecation from inside its bundled
  // init wrapper and does not expose the newer object-form signature at the app layer.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      first.includes("using deprecated parameters for the initialization function; pass a single object instead")
    ) {
      return;
    }
    originalWarn(...args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = originalWarn;
  }
  console.log("[Kinema] Rapier WASM initialized");

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
    { ComfortPreferencesController },
    { UserSettingsStore },
    { AudioManager, createSilentAudioController },
    { VehicleManager },
    { MenuManager },
    { LevelSaveStore },
    { SHOWCASE_STATION_ORDER, PROCEDURAL_REVIEW_SPAWN_ORDER, resolveProceduralReviewSpawn },
    { Game },
    { AssetLoader },
  ] = await Promise.all([
    import("@renderer/RendererManager"),
    import("@physics/PhysicsWorld"),
    import("@core/GameLoop"),
    import("@core/EventBus"),
    import("@input/InputManager"),
    import("@level/LevelManager"),
    import("@character/PlayerController"),
    import("@camera/OrbitFollowCamera"),
    import("@interaction/InteractionManager"),
    import("@ui/UIManager"),
    import("@ui/ComfortPreferencesController"),
    import("@core/UserSettings"),
    import("@audio/AudioManager"),
    import("@vehicle/VehicleManager"),
    import("@ui/menus/MenuManager"),
    import("@level/LevelSaveStore"),
    import("@level/ShowcaseLayout"),
    import("./Game"),
    import("@level/AssetLoader"),
  ]);

  const settings = UserSettingsStore.load();

  const renderer = new RendererManager({
    forceWebGL: forceWebGPUWebGL,
    preferCompatibilityRenderer:
      forceCompatibilityRenderer || (shouldUseCompatibilityRenderer(window.navigator) && !allowExperimentalRenderer),
  });
  await renderer.init();
  // Wire KTX2 support early so all AssetLoader instances detect compressed texture formats.
  AssetLoader.initRendererSupport(renderer.renderer);
  renderer.setGraphicsProfile(settings.value.graphicsProfile);
  renderer.setAntiAliasingMode(settings.value.aaMode);
  renderer.setCasEnabled(settings.value.casEnabled);
  renderer.setCasStrength(settings.value.casStrength);
  renderer.applyPostEffectSettings(pickPostEffectSettings(settings.value));
  renderer.setResolutionScale(settings.value.resolutionScale);
  renderer.setShadowsEnabled(settings.value.shadowsEnabled);
  renderer.setShadowQualityTier(settings.value.shadowQuality);
  renderer.setEnvironmentRotationDegrees(settings.value.envRotationDegrees);
  console.log("[Kinema] Renderer initialized");

  const eventBus = new EventBus();
  const physicsWorld = PhysicsWorld.create();
  const inputManager = new InputManager(eventBus, renderer.canvas);
  inputManager.setRawMouseInput(settings.value.rawMouseInput);
  inputManager.setGamepadTuning(settings.value.gamepadDeadzone, settings.value.gamepadCurve);
  inputManager.setKeyboardBindings(settings.value.keyboardBindings);
  inputManager.setGamepadLookSensitivity(settings.value.gamepadLookSensitivity);
  inputManager.setTouchLookSensitivity(settings.value.touchLookSensitivity);
  inputManager.setSprintMode(settings.value.sprintMode);
  inputManager.setCrouchMode(settings.value.crouchMode);
  inputManager.initTouchControls();
  const levelManager = new LevelManager(
    renderer.scene,
    physicsWorld,
    eventBus,
    renderer.maxAnisotropy,
    renderer.supportsAdvancedGpuEffects(),
    renderer.scheduleGpuResourceMutation,
  );
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
  const interactionManager = new InteractionManager(physicsWorld, playerController, eventBus, () =>
    getInputGlyph("interact", inputManager.lastInputSource, settings.value.keyboardBindings),
  );
  const uiManager = new UIManager(eventBus, () => settings.value.keyboardBindings);
  const comfortPreferences = new ComfortPreferencesController({
    camera,
    hud: uiManager,
    root: document.documentElement,
    matchMedia: (query) => window.matchMedia(query),
  });
  comfortPreferences.apply(settings.value);
  let audioManager: import("@audio/AudioManager").AudioController;
  try {
    audioManager = new AudioManager(eventBus, playerController, inputManager, settings);
  } catch (err) {
    console.warn("[Kinema] Audio disabled due to browser compatibility issue:", err);
    audioManager = createSilentAudioController();
  }
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
  game.setGameLoop(gameLoop);
  gameLoop.setHitstop(game.hitstop);
  type EditorManagerInstance = import("@editor/EditorManager").EditorManager;
  let editorManager: EditorManagerInstance | null = null;
  let editorManagerPromise: Promise<EditorManagerInstance> | null = null;
  let editorPhysicsSyncDebug: typeof import("@editor/EditorPhysicsSync") | null = null;
  let editorBeforeUnloadRegistered = false;
  let editorBeforeUnloadPrevented = false;
  const onEditorBeforeUnload = (event: BeforeUnloadEvent): void => {
    editorBeforeUnloadPrevented = false;
    if (!editorManager?.shouldWarnBeforeUnload()) return;
    event.preventDefault();
    event.returnValue = true;
    editorBeforeUnloadPrevented = event.defaultPrevented;
  };
  const setEditorUnloadProtection = (enabled: boolean): void => {
    if (enabled === editorBeforeUnloadRegistered) return;
    editorBeforeUnloadRegistered = enabled;
    if (enabled) {
      window.addEventListener("beforeunload", onEditorBeforeUnload);
    } else {
      window.removeEventListener("beforeunload", onEditorBeforeUnload);
    }
  };
  const unsubEditorUnloadProtection = eventBus.on("editor:unloadProtectionChanged", setEditorUnloadProtection);
  let unsubEditorBootstrap = () => {};
  const ensureEditorManager = (): Promise<EditorManagerInstance> => {
    if (editorManager) return Promise.resolve(editorManager);
    if (!editorManagerPromise) {
      unsubEditorBootstrap();
      editorManagerPromise = import("@editor/EditorManager").then(async ({ EditorManager }) => {
        editorPhysicsSyncDebug = await import("@editor/EditorPhysicsSync");
        const manager = new EditorManager(
          renderer,
          physicsWorld,
          eventBus,
          gameLoop,
          levelManager,
          playerController,
          interactionManager,
        );
        editorManager = manager;
        game.setEditorManager(manager);
        return manager;
      });
    }
    return editorManagerPromise;
  };
  unsubEditorBootstrap = eventBus.on("editor:toggle", () => {
    // First toggle: lazy-load the editor module, then let EditorManager own future toggles.
    void ensureEditorManager().then((manager) => {
      if (!manager.isActive() && !manager.isPlayTesting()) manager.toggle();
    });
  });

  let levelLoaded = false;
  type ProceduralRunDescriptor = {
    kind: "procedural";
    reviewSpawnKey: string | null;
    camYaw: number | null;
    camPitch: number | null;
  };
  type RunDescriptor =
    | ProceduralRunDescriptor
    | { kind: "station"; key: import("@level/ShowcaseLayout").ShowcaseStationKey }
    | { kind: "saved"; key: string }
    | { kind: "editor-blank" };
  let currentRun: RunDescriptor | null = null;
  let restartInFlight = false;
  let menuManagerRef: import("@ui/menus/MenuManager").MenuManager | null = null;

  /** Yield to browser so CSS animations and paint can run */
  const yieldToRenderer = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
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
    if (run.kind === "procedural") {
      return { ...run };
    }
    if (run.kind === "station" || run.kind === "saved") {
      return { ...run };
    }
    return { kind: "editor-blank" };
  };

  const getProceduralRunFromLocation = (): ProceduralRunDescriptor => {
    const params = new URLSearchParams(window.location.search);
    return {
      kind: "procedural",
      reviewSpawnKey: params.get("spawn"),
      camYaw: parseFiniteParam(params.get("camYaw")),
      camPitch: parseFiniteParam(params.get("camPitch")),
    };
  };

  const closeEditorForSceneTransition = (): void => {
    editorManager?.abortPlayTest();
    if (editorManager?.isActive()) editorManager.toggle();
  };

  const unloadCurrentRun = (): void => {
    closeEditorForSceneTransition();
    if (!levelLoaded) return;
    game.teardownLevel();
    levelManager.unload();
    levelLoaded = false;
  };

  const prepareSceneLoad = async (): Promise<void> => {
    closeEditorForSceneTransition();
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
    // Input pressed while the loading screen was up must not fire on the
    // first live tick (beginFrame OR-merges edges until fixedUpdate consumes).
    game.clearBufferedInput();
    gameLoop.setSimulationEnabled(true);
    await uiManager.loadingScreen.hide();
    levelLoaded = true;
  };

  const startGame = async (descriptor = getProceduralRunFromLocation()): Promise<void> => {
    await prepareSceneLoad();
    const reviewSpawn = descriptor.reviewSpawnKey ? resolveProceduralReviewSpawn(descriptor.reviewSpawnKey) : null;

    await levelManager.load("procedural");
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
    closeEditorForSceneTransition();
    if (!levelLoaded) return;
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
      // Restart of a run whose save was deleted/corrupted: silently failing
      // would leave the player stuck retrying forever. Bail to the menu.
      if (levelLoaded) {
        currentRun = null;
        await returnToMainMenu();
        menuManagerRef?.showMainMenu();
      }
      return;
    }
    await prepareSceneLoad();
    await levelManager.loadFromJSON(data);
    playerController.spawn(levelManager.getSpawnPoint());
    physicsWorld.step();
    game.setupCustomLevel();
    currentRun = { kind: "saved", key };
    await finishSceneLoad();
  };

  const startBlankLevelForEditor = async (): Promise<void> => {
    unloadCurrentRun();
    // Minimal blank level: a floor platform so the player can stand
    const blankLevel: import("@editor/LevelSerializer").LevelDataV2 = {
      version: 2,
      name: "Untitled",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      spawnPoint: { position: [0, 2, 0] },
      objects: [
        {
          id: "floor-0",
          name: "Floor",
          parentId: null,
          source: { type: "primitive", primitive: "cube" },
          transform: {
            position: [0, -0.5, 0],
            rotation: [0, 0, 0],
            scale: [20, 1, 20],
          },
          physics: { type: "static" },
          material: {
            color: "#4a5568",
            roughness: 0.8,
            metalness: 0,
            emissive: "#000000",
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
    currentRun = { kind: "editor-blank" };
    // Open the editor
    eventBus.emit("editor:toggle", undefined);
  };

  const startStation = async (key: string): Promise<void> => {
    await prepareSceneLoad();
    await levelManager.loadStation(key as import("@level/ShowcaseLayout").ShowcaseStationKey);
    playerController.spawn(levelManager.getSpawnPoint());
    physicsWorld.step();
    game.setupStation(key as import("@level/ShowcaseLayout").ShowcaseStationKey);
    currentRun = { kind: "station", key: key as import("@level/ShowcaseLayout").ShowcaseStationKey };
    await finishSceneLoad();
  };

  const restartCurrentRun = async (): Promise<void> => {
    if (restartInFlight || !currentRun) return;
    restartInFlight = true;
    try {
      const run = cloneRun(currentRun);
      if (run.kind === "procedural") {
        await startGame(run);
      } else if (run.kind === "station") {
        await startStation(run.key);
      } else if (run.kind === "saved") {
        await startSavedLevel(run.key);
      } else {
        await startBlankLevelForEditor();
      }
    } finally {
      restartInFlight = false;
    }
  };

  eventBus.on("run:restartRequested", () => {
    void restartCurrentRun();
  });

  // The compat renderer's child-count sanitize heuristic can miss deep
  // subtree additions; a fresh level is the highest-risk moment for stray
  // NodeMaterials on the WebGL path, so request an explicit pass.
  eventBus.on("level:loaded", () => {
    gameLoop.resetFrameStats();
    renderer.requestCompatibilitySanitize();
  });

  // Expose debug API for automated testing (Playwright, etc.)
  // Gated behind DEV to tree-shake new Function() evaluator from production builds.
  if (import.meta.env.DEV) {
    let editorSaveEventCount = 0;
    const interactionEvents: KinemaInteractionEvent[] = [];
    const recordInteractionEvent = (event: KinemaInteractionEvent): void => {
      interactionEvents.push(event);
      if (interactionEvents.length > 128) interactionEvents.shift();
    };
    eventBus.on("editor:saved", () => {
      editorSaveEventCount++;
    });
    eventBus.on("interaction:triggered", (payload) => {
      recordInteractionEvent({ type: "interaction:triggered", ...payload });
    });
    eventBus.on("interaction:doorToggled", (payload) => {
      recordInteractionEvent({ type: "interaction:doorToggled", ...payload });
    });
    eventBus.on("objective:beaconActivated", (payload) => {
      recordInteractionEvent({ type: "objective:beaconActivated", ...payload });
    });
    eventBus.on("interaction:ropeAttached", (payload) => {
      recordInteractionEvent({ type: "interaction:ropeAttached", ...payload });
    });
    eventBus.on("interaction:ropeReleased", (payload) => {
      recordInteractionEvent({ type: "interaction:ropeReleased", ...payload });
    });
    eventBus.on("player:sprintStarted", () => {
      recordInteractionEvent({ type: "player:sprintStarted" });
    });
    eventBus.on("player:ladderAttached", () => {
      recordInteractionEvent({ type: "player:ladderAttached" });
    });
    eventBus.on("player:ladderReleased", () => {
      recordInteractionEvent({ type: "player:ladderReleased" });
    });
    eventBus.on("vehicle:boostChanged", ({ active }) => {
      recordInteractionEvent({ type: "vehicle:boostChanged", active });
    });
    eventBus.on("collectible:allCollected", ({ count, total }) => {
      recordInteractionEvent({ type: "collectible:allCollected", count, total });
    });
    const kinemaDebugApi = {
      getFrameStats: () => gameLoop.getFrameStats(),
      resetFrameStats: () => gameLoop.resetFrameStats(),
      getRendererMemoryState: () => renderer.getMemoryDebugState(),
      getLastLoadStats: () => levelManager.getLastLoadStats(),
      restartCurrentRun,
      getVfxDebugState: () => game.getVfxDebugState(),
      get player() {
        const pos = playerController.position;
        const vel = playerController.body.linvel();
        return {
          position: { x: pos.x, y: pos.y, z: pos.z },
          velocity: { x: vel.x, y: vel.y, z: vel.z },
          isGrounded: playerController.isGrounded,
          ropeAttached: playerController.isRopeAttached,
          state: playerController.fsm.current,
          verticalVelocity: playerController.verticalVelocity,
        };
      },
      simulateJump() {
        // Set testInputOverride on Game so beginFrame() uses it instead of
        // polling InputManager (which requires pointer lock). Keep jumpPressed
        // to a single edge; repeating it can consume the air-jump charge during
        // the initial ground-jump sequence.
        const jumpInput = {
          forward: false,
          backward: false,
          left: false,
          right: false,
          crouch: false,
          crouchPressed: false,
          jump: true,
          jumpPressed: true,
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
        };
        game.testInputOverride = jumpInput;
        game.testInputFrames = 1;
      },
      simulateCrouch() {
        const crouchInput: InputState = {
          forward: false,
          backward: false,
          left: false,
          right: false,
          crouch: true,
          crouchPressed: true,
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
        };
        game.testInputOverride = crouchInput;
        game.testInputFrames = 1;
      },
      simulateGamepadMenuInput(action) {
        inputManager.simulateGamepadMenuInput(action);
      },
      /** Set camera look angles for headless screenshot capture. */
      setCameraLook(pitch: number, yaw: number) {
        camera.snapToAngle(yaw, pitch);
      },
      getCameraPose() {
        const { position, quaternion } = renderer.camera;
        return {
          position: { x: position.x, y: position.y, z: position.z },
          quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
        };
      },
      async freezeForCapture() {
        renderer.setGraphicsProfile("performance");
        levelManager.setGraphicsProfile("performance");
        renderer.setResolutionScale(1);
        gameLoop.setSimulationEnabled(false);
        await game.freezeForCapture();
        await yieldToRenderer();
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
          forward: moveY > 0,
          backward: moveY < 0,
          left: moveX < 0,
          right: moveX > 0,
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
          moveX,
          moveY,
          sprint: false,
          mouseDeltaX: 0,
          mouseDeltaY: 0,
          mouseWheelDelta: 0,
        };
        game.testInputOverride = moveInput;
        game.testInputFrames = frames;
      },
      /** Simulate an interact hold: press on the first frames, then keep holding. */
      simulateHoldInteract(frames = 210) {
        const pressInput: InputState = {
          forward: false,
          backward: false,
          left: false,
          right: false,
          crouch: false,
          crouchPressed: false,
          jump: false,
          jumpPressed: false,
          interact: true,
          interactPressed: true,
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
        };
        const holdInput: InputState = {
          ...pressInput,
          interactPressed: false,
        };
        (game as unknown as { frameInput: InputState | null }).frameInput = pressInput;
        game.testInputOverride = holdInput;
        game.testInputFrames = Math.max(0, frames - 1);
      },
      clearSimulatedInput() {
        (game as unknown as { frameInput: InputState | null }).frameInput = null;
        game.testInputOverride = null;
        game.testInputFrames = 0;
      },
      listVehicles() {
        return vehicleManager.getVehicleIds();
      },
      getVehicleState(id: string) {
        const vehicle = vehicleManager.getVehicle(id);
        if (!vehicle) return null;
        const pos = vehicle.body.translation();
        const vel = vehicle.body.linvel();
        const rotation = vehicle.body.rotation();
        const debug = isCarController(vehicle) ? vehicle.getDebugState() : undefined;
        return {
          id,
          active: vehicleManager.isActive() && vehicleManager.getVehicle(id) === vehicle,
          position: { x: pos.x, y: pos.y, z: pos.z },
          velocity: { x: vel.x, y: vel.y, z: vel.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
          debug,
        };
      },
      enableVehicleSteeringDebug(
        id: string,
        options?: { capacity?: number; autoLog?: boolean; label?: string | null },
      ) {
        const vehicle = vehicleManager.getVehicle(id);
        return isCarController(vehicle) ? vehicle.enableSteeringDebugTrace(options) : null;
      },
      disableVehicleSteeringDebug(id: string) {
        const vehicle = vehicleManager.getVehicle(id);
        return isCarController(vehicle) ? vehicle.disableSteeringDebugTrace() : null;
      },
      clearVehicleSteeringDebug(id: string) {
        const vehicle = vehicleManager.getVehicle(id);
        if (!isCarController(vehicle)) return null;
        vehicle.clearSteeringDebugTrace();
        return vehicle.getSteeringDebugTrace();
      },
      getVehicleSteeringDebug(id: string) {
        const vehicle = vehicleManager.getVehicle(id);
        return isCarController(vehicle) ? vehicle.getSteeringDebugTrace() : null;
      },
      dumpVehicleSteeringDebug(id: string) {
        const vehicle = vehicleManager.getVehicle(id);
        return isCarController(vehicle) ? vehicle.dumpSteeringDebugTrace() : null;
      },
      getDynamicBodyState(name: string) {
        const entry = levelManager.getDynamicBodies().find((candidate) => candidate.mesh.name === name);
        if (!entry) return null;
        const pos = entry.body.translation();
        const vel = entry.body.linvel();
        return {
          name,
          position: { x: pos.x, y: pos.y, z: pos.z },
          velocity: { x: vel.x, y: vel.y, z: vel.z },
        };
      },
      getNavAgentStates() {
        return levelManager.getNavPatrolSystem()?.getAgentStates() ?? [];
      },
      getNavigationDebugState() {
        return game.getNavigationDebugState();
      },
      getLevelObjectState(name: string) {
        const object =
          levelManager.getLevelObjects().find((candidate) => candidate.name === name) ??
          levelManager.getLevelObjects().flatMap((candidate) => {
            const found = candidate.getObjectByName(name);
            return found ? [found] : [];
          })[0] ??
          null;
        if (!object) return null;
        const bounds = new THREE.Box3().setFromObject(object);
        const size = bounds.getSize(new THREE.Vector3());
        const mesh = object as THREE.Mesh;
        const material = !("material" in mesh) ? null : Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        return {
          name,
          visible: object.visible,
          position: { x: object.position.x, y: object.position.y, z: object.position.z },
          size: { x: size.x, y: size.y, z: size.z },
          material: material
            ? {
                transparent: material.transparent,
                opacity: material.opacity,
                blending: material.blending,
                depthWrite: material.depthWrite,
                emissive:
                  "emissive" in material && material.emissive instanceof THREE.Color
                    ? "#" + material.emissive.getHexString()
                    : null,
                emissiveIntensity:
                  "emissiveIntensity" in material && typeof material.emissiveIntensity === "number"
                    ? material.emissiveIntensity
                    : null,
              }
            : null,
        };
      },
      getGraphicsProfile() {
        return renderer.getDebugFlags().graphicsProfile;
      },
      getRendererDebugFlags() {
        return renderer.getDebugFlags();
      },
      async setGraphicsProfile(profile: "performance" | "balanced" | "cinematic") {
        eventBus.emit("debug:graphicsProfile", { profile });
        await renderer.waitForGpuResourceMutations();
        return renderer.getDebugFlags().graphicsProfile;
      },
      forceVehicleTransform(
        id: string,
        position: { x: number; y: number; z: number },
        yaw = 0,
        rotation?: { x: number; y: number; z: number; w: number },
      ) {
        const vehicle = vehicleManager.getVehicle(id);
        if (!vehicle) return false;
        vehicle.body.setTranslation(new RAPIER.Vector3(position.x, position.y, position.z), true);
        vehicle.body.setRotation(
          rotation
            ? new RAPIER.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
            : new RAPIER.Quaternion(0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5)),
          true,
        );
        vehicle.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
        vehicle.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
        return true;
      },
      forceVehicleVelocity(id: string, velocity: { x: number; y: number; z: number }) {
        const vehicle = vehicleManager.getVehicle(id);
        if (!vehicle) return false;
        vehicle.body.setLinvel(new RAPIER.Vector3(velocity.x, velocity.y, velocity.z), true);
        return true;
      },
      enterVehicle(id: string) {
        const vehicle = vehicleManager.getVehicle(id);
        if (!vehicle) return false;
        eventBus.emit("vehicle:enter", { vehicle });
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
      getCollectibleTotal() {
        return game.getCollectibleTotal();
      },
      getActiveCheckpoint() {
        const checkpoint = game.getActiveCheckpoint();
        if (!checkpoint) return null;
        const { position } = checkpoint.spawnPoint;
        return {
          id: checkpoint.id,
          position: { x: position.x, y: position.y, z: position.z },
        };
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
      teleportToCheckpoint() {
        return game.teleportPlayerToCheckpoint();
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
      async openEditor() {
        const manager = await ensureEditorManager();
        if (!manager.isActive() && !manager.isPlayTesting()) manager.toggle();
      },
      closeEditor() {
        if (editorManager?.isActive()) editorManager.toggle();
      },
      isEditorActive() {
        return editorManager?.isActive() ?? false;
      },
      isPlayTesting() {
        return editorManager?.isPlayTesting() ?? false;
      },
      getEditorObjectCount() {
        return editorManager?.getObjectCount() ?? 0;
      },
      getEditorSaveEventCount() {
        return editorSaveEventCount;
      },
      getEditorDocumentState() {
        const state = editorManager?.getDocumentState() ?? { name: "Untitled", dirty: false };
        return { name: state.name, dirty: state.dirty };
      },
      getEditorSnapshot() {
        return editorManager?.getEditorSnapshot() ?? { selectedId: null, objects: [] };
      },
      setEditorCameraPose(pose) {
        if (!editorManager?.isActive()) return false;
        editorManager.setEditorCameraPose({
          position: [pose.position.x, pose.position.y, pose.position.z],
          quaternion: [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w],
        });
        return true;
      },
      getEditorPhysicsSyncCounters() {
        return (
          editorPhysicsSyncDebug?.getEditorPhysicsSyncCounters() ?? {
            poseSyncs: 0,
            colliderDescriptorBuilds: 0,
            colliderReplacements: 0,
          }
        );
      },
      resetEditorPhysicsSyncCounters() {
        editorPhysicsSyncDebug?.resetEditorPhysicsSyncCounters();
      },
      getEditorUnloadProtectionState() {
        return { registered: editorBeforeUnloadRegistered, lastPrevented: editorBeforeUnloadPrevented };
      },
      getInteractionEvents() {
        return interactionEvents.map((event) => ({ ...event }));
      },
      clearInteractionEvents() {
        interactionEvents.length = 0;
      },
      editorUndo() {
        editorManager?.undo();
      },
      editorRedo() {
        editorManager?.redo();
      },
      startPlayTest() {
        editorManager?.startPlayTest();
      },
      async stopPlayTest() {
        await editorManager?.stopPlayTest();
      },
      async loadExternalEditorLevel(name: string) {
        closeEditorForSceneTransition();
        const now = new Date().toISOString();
        await levelManager.loadFromJSON({
          version: 2,
          name,
          created: now,
          modified: now,
          spawnPoint: { position: [0, 2, 0] },
          objects: [],
        });
      },
      evictEditorAsset(assetPath: string) {
        levelManager.getAssetLoader().evict(assetPath);
      },
      /** Wait for a condition on player state, polling at physics rate. */
      waitFor(predicate: string, timeoutMs = 5000): Promise<boolean> {
        const fn = new Function("p", `return ${predicate}`) as (p: any) => boolean;
        return new Promise((resolve) => {
          const deadline = Date.now() + timeoutMs;
          const check = () => {
            const pos = playerController.position;
            const vel = playerController.body.linvel();
            const p = {
              x: pos.x,
              y: pos.y,
              z: pos.z,
              vx: vel.x,
              vy: vel.y,
              vz: vel.z,
              isGrounded: playerController.isGrounded,
              ropeAttached: playerController.isRopeAttached,
              state: playerController.fsm.current,
            };
            if (fn(p)) {
              resolve(true);
              return;
            }
            if (Date.now() > deadline) {
              resolve(false);
              return;
            }
            requestAnimationFrame(check);
          };
          check();
        });
      },
    } satisfies KinemaDebugApi;
    (window as Window & { __KINEMA__?: KinemaDebugApi }).__KINEMA__ = kinemaDebugApi;
  } // if (import.meta.env.DEV)

  // Check for ?station= query param to load a single station directly.
  const params = new URLSearchParams(window.location.search);
  const stationParam = params.get("station");
  const reviewSpawnParam = params.get("spawn");
  const menuManager = new MenuManager(
    eventBus,
    gameLoop,
    renderer,
    settings,
    inputManager,
    camera,
    audioManager,
    comfortPreferences,
    startGame,
    startSavedLevel,
    returnToMainMenu,
    startBlankLevelForEditor,
  );
  menuManagerRef = menuManager;
  let pageCleanupComplete = false;
  const cleanupPage = (): void => {
    if (pageCleanupComplete) return;
    pageCleanupComplete = true;
    setEditorUnloadProtection(false);
    unsubEditorUnloadProtection();
    gameLoop.stop();
    comfortPreferences.dispose();
    game.dispose();
    menuManager.dispose();
  };
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    cleanupPage();
  });
  if (
    stationParam &&
    SHOWCASE_STATION_ORDER.includes(stationParam as import("@level/ShowcaseLayout").ShowcaseStationKey)
  ) {
    // prepareSceneLoad (inside startStation/startGame) already started the
    // loop; a second start() here would reset loop timing mid-frame.
    await startStation(stationParam);
    console.log(`[Kinema] Station "${stationParam}" started directly`);
  } else if (reviewSpawnParam) {
    await startGame(getProceduralRunFromLocation());
    console.log(`[Kinema] Procedural level started at review spawn "${reviewSpawnParam}"`);
  } else {
    menuManager.showMainMenu();

    console.log("[Kinema] Game started");
  }
}

bootstrap().catch((err) => {
  console.error("[Kinema] Fatal bootstrap error:", err);
  showBootstrapError(err);
});
