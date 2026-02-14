# Kinema

**Kinema** is a modular third-person gameplay playground built with **Three.js** (WebGPU) and **Rapier** physics. It is structured like a small game engine: movement, camera, rendering, levels, interaction, audio, and UI are separate systems that communicate through a typed event bus, so you can work on one area without touching the rest.

---

## What's in the box

- **Player controller** — Rigid-body movement with slope handling, step assist, ladders, coyote time, jump buffer, double jump, and crouch.
- **Rope traversal** — Attach from ground or mid-air; swing with `W A S D`, climb with `Shift + W/S`, jump off or drop with `Space` / `C`.
- **Orbit follow camera** — Collision-aware (shapecast), zoom, damping, sprint FOV boost, and rope-aware behavior.
- **Interaction system** — Proximity and line-of-sight filtering, hold-to-interact, lock conditions; framework for doors, beacons, ropes, etc.
- **Physics object interactions** — Grab/pull crates and barrels, pick up small objects, and throw them.
- **Vehicles** — A drivable car and a flyable drone with camera handoff and input routing.
- **Showcase level** — A centered, labeled corridor that contains all features (old + new) in non-overlapping stations for quick testing.
- **Menus & settings** — Main menu, pause menu, and settings with persistent graphics/audio controls.
- **Level editor** — In-game edit mode with free camera, gizmos, snapping, asset browser, and save/load.
- **Ambient audio** — Background music with Web Audio mixing and volume controls.
- **Gameplay** — Checkpoints/respawn, objective tracking, HUD prompts and status messages.
- **Debug panel** — FPS, physics/render metrics, and grouped controls for quality, environment, post-processing, and input tuning.
- **Rendering** — Three-tier TSL post-processing when WebGPU is available: **High** (SSGI + TRAA + bloom), **Medium** (SSR + GTAO + TRAA + bloom), **Low** (GTAO + FXAA). HDR environment maps, 11 LUT color grades. Falls back to WebGL2 otherwise.

---

## Getting started

### Prerequisites

- **Node.js 20+** (recommended; needed for modern ESM and Vite).
- **npm 10+** (or compatible package manager).

The project uses **Rapier** via `@dimforge/rapier3d-compat` (WASM). No extra native tools are required; the first run will load the WASM module in the browser.

### 1. Clone and install

```bash
git clone <repository-url>
cd Kinema
npm install
```

### 2. Run the dev server

```bash
npm run dev
```

Vite will start a local server (typically `http://localhost:5173`). Open that URL in a modern browser (Chrome, Edge, or Firefox with WebGPU support recommended).

### 3. Focus the game and play

- **Click "Play"** in the main menu to load the level.
- **Click the canvas** so the page can capture the pointer (required for mouse look and pointer lock).
- Move with **W A S D**, look with the **mouse**, jump with **Space**, interact with **E**.
- Press **`` ` ``** (backtick) to open or close the **debug panel** for graphics and tuning.
- Press **ESC** to open the pause menu; **F1** toggles the in-game editor.

That's enough to run the project and try the **procedural showcase corridor** (steps, slopes + SSR test, ladder, crouch/double-jump lanes, grab/pull, throwables, door/beacon, rope, vehicles, and moving platforms).

---

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with HMR. |
| `npm run build` | Type-check with `tsc`, then production build with Vite. |
| `npm run preview` | Serve the production build locally (run after `npm run build`). |
| `npm run test` | Run Vitest once. |
| `npm run test:watch` | Run Vitest in watch mode. |

---

## Controls

### On foot

| Input | Action |
|-------|--------|
| `W A S D` / Arrow keys | Move |
| Mouse | Look (after clicking canvas) |
| Mouse wheel | Zoom camera |
| `Space` | Jump / double jump |
| `Shift` | Sprint |
| `C` or `Left Ctrl` | Crouch / drop carried object |
| `E` | Interact / grab / enter vehicles |
| Left mouse | Throw carried object |
| `` ` `` | Toggle debug panel |
| `F1` | Toggle editor mode |

### On the rope (after attaching with `E`)

| Input | Action |
|-------|--------|
| `W A S D` | Build swing momentum |
| `Shift + W` | Climb up |
| `Shift + S` | Climb down |
| `Space` | Jump off rope |
| `C` or `Left Ctrl` | Drop from rope |

You can attach to the rope with `E` from the ground or in the air when in range.

### Vehicles

| Input | Action |
|-------|--------|
| `E` | Enter/exit vehicle |
| `W A S D` | Drive/strafe |
| Mouse | Drone yaw/pitch |
| `Shift` | Drone speed boost |
| `Space` | Drone up / car handbrake |
| `C` | Drone down |

### Editor mode

| Input | Action |
|-------|--------|
| Left mouse | Select object / place asset |
| `W` / `E` / `R` | Translate / rotate / scale gizmo |
| `G` | Toggle grid |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Esc` | Cancel placement |
| `Delete` / `Backspace` | Remove selected object |

### Runtime tuning (hotkeys)

| Input | Action |
|-------|--------|
| `F6` | Cycle graphics quality (low → medium → high) |
| `F7` | Toggle invert Y |
| `F8` / `F9` | Decrease / increase mouse sensitivity |
| `F10` | Toggle raw mouse input request |
| `F11` / `F12` | Decrease / increase gamepad deadzone |
| `[` / `]` | Decrease / increase gamepad response curve |

---

## Debug panel

Open with **`` ` ``**. Sections:

- **Runtime views** — FPS / frame-time / memory graphs, collider wireframes, light helpers, camera collision toggle.
- **Environment** — Background intensity, background blur, HDR environment map selector (7 presets).
- **Quality** — Graphics preset (Low / Medium / High), post-processing master toggle, shadows, exposure.
- **Post FX** — Controls shown depend on the active quality tier:
  - **High**: SSGI (toggle, quality preset, radius, GI intensity), bloom, vignette, LUT color grading. TRAA is mandatory (denoises SSGI).
  - **Medium**: SSR (toggle, opacity, resolution scale), GTAO, TRAA (toggle), bloom, vignette, LUT color grading.
  - **Low**: GTAO, vignette, LUT color grading. FXAA is always applied.

---

## Rendering pipeline

The WebGPU path uses Three.js r182 `WebGPURenderer` + TSL `PostProcessing` with a single MRT (Multiple Render Target) scene pass that outputs five G-buffers in one draw:

| G-buffer | Content | Precision |
|----------|---------|-----------|
| `output` | Final lit color | RGBA16Float |
| `diffuseColor` | Unlit albedo (for SSGI composite) | RGBA8 |
| `normal` | View-space normals (encoded via `directionToColor`) | RGBA8 |
| `velocity` | Per-pixel motion vectors (for TRAA) | RGBA16Float |
| `metalrough` | Metalness (R) + roughness (G) (for SSR) | RGBA8 |

`depth` is implicitly available from any `pass()` node and does not need to be declared in the MRT.

### Quality tiers

| Tier | GI / AO | Anti-aliasing | Extras | Pixel ratio |
|------|---------|---------------|--------|-------------|
| **High** | SSGI (GI + AO in one pass) | TRAA (mandatory — denoises SSGI) | Bloom, vignette, LUT | 2x |
| **Medium** | SSR + GTAO | TRAA (optional) | Bloom, vignette, LUT | 1.5x |
| **Low** | GTAO | FXAA | Vignette, LUT | 1x |

### Post-processing chain order

```
Scene MRT pass
  → [High] SSGI composite: sceneColor * ao + diffuseColor * gi
  → [Medium] SSR (hashBlur + mix) → GTAO multiply
  → [Low] GTAO multiply
  → Bloom (additive, Medium/High only)
  → TRAA or FXAA
  → renderOutput() (tone mapping + sRGB conversion)
  → Vignette (radial darken)
  → LUT 3D color grading
```

`postProcessing.outputColorTransform` is set to `false` because `renderOutput()` is called manually in the chain. This prevents double tone mapping.

### SSGI details

SSGI outputs `vec4(gi_rgb, ao)`. The composite formula separates direct and indirect lighting:

```
finalColor = sceneColor * ao + diffuseColor * gi
```

SSGI runs at a low sample count for performance; TRAA accumulates frames to converge to a clean image. Disabling TRAA in High tier is not exposed because the result would be pure noise.

| Preset | Slices | Steps | Samples/pixel |
|--------|--------|-------|---------------|
| Low | 1 | 12 | 24 |
| Medium | 2 | 8 | 32 |
| High | 3 | 16 | 96 |

Radius and GI intensity are tunable in the debug panel.

### Environment maps

Seven environment presets are available, selectable at runtime via the debug panel:

| Preset | Source |
|--------|--------|
| Room Environment | Procedural (`RoomEnvironment`) |
| Sunrise | `blouberg_sunrise_2_1k.hdr` |
| Partly Cloudy | `kloofendal_48d_partly_cloudy_1k.hdr` |
| Venice Sunset | `venice_sunset_1k.hdr` |
| Royal Esplanade | `royal_esplanade_1k.hdr` |
| Studio | `studio_small_09_1k.hdr` |
| Night | `moonless_golf_1k.hdr` |

HDR files are loaded on-demand via `HDRLoader`, converted to PMREM cubemaps via `PMREMGenerator.fromEquirectangular()`, and cached for instant switching. Both `scene.environment` (lighting) and `scene.background` (skybox) are updated together. Background intensity and blurriness are adjustable.

HDR assets from [Poly Haven](https://polyhaven.com/) (CC0 license). Located in `src/assets/env/`.

### LUT color grading

Eleven LUT presets across three formats, all batch-loaded at startup:

| Preset | Format | Source |
|--------|--------|--------|
| Bourbon 64 | `.CUBE` | Three.js examples |
| Chemical 168 | `.CUBE` | Three.js examples |
| Clayton 33 | `.CUBE` | Three.js examples |
| Cubicle 99 | `.CUBE` | Three.js examples |
| Remy 24 | `.CUBE` | Three.js examples |
| Presetpro-Cinematic | `.3dl` | Three.js examples |
| NeutralLUT | `.png` | Three.js examples |
| B&WLUT | `.png` | Three.js examples |
| NightLUT | `.png` | Three.js examples |
| lut | `.3dl` | Custom |
| lut_v2 | `.3dl` | Custom |

Switching LUTs at runtime updates the `Lut3DNode` uniforms directly (`lutNode.value`, `size.value`) — no pipeline rebuild required. LUT intensity (blend strength) is also adjustable. Located in `src/assets/postfx/`.

### WebGL fallback

If WebGPU is not available, the app uses a standard `WebGLRenderer` with `ACESFilmicToneMapping`. The environment map (procedural `RoomEnvironment`) is still applied via `PMREMGenerator`, but no TSL post-processing is available.

---

## Tech stack

- **TypeScript** (strict mode)
- **Three.js r182** — `WebGPURenderer` + TSL node-based shading, `WebGLRenderer` fallback
- **Rapier** — `@dimforge/rapier3d-compat` (3D physics, WASM)
- **Vite** — Dev server, build, path aliases (`vite-plugin-wasm`, `vite-plugin-top-level-await`)
- **Vitest** — Unit tests

---

## Project structure and path aliases

Source lives under `src/`. Imports use **path aliases** so you don't rely on long relative paths:

| Alias | Directory |
|-------|-----------|
| `@core` | `src/core` |
| `@physics` | `src/physics` |
| `@character` | `src/character` |
| `@camera` | `src/camera` |
| `@level` | `src/level` |
| `@input` | `src/input` |
| `@interaction` | `src/interaction` |
| `@ui` | `src/ui` |
| `@renderer` | `src/renderer` |
| `@audio` | `src/audio` |
| `@vehicle` | `src/vehicle` |
| `@editor` | `src/editor` |

Example: `import { EventBus } from '@core/EventBus';` instead of `import { EventBus } from '../../core/EventBus';`.

### Directory layout

```text
src/
  main.ts                 Entry point: Rapier init, system wiring, Game + GameLoop start
  Game.ts                 Top-level orchestrator: wires all systems, delegates to game loop
  assets/
    env/                  HDR environment maps (.hdr)
    postfx/               LUT color grading files (.CUBE, .3dl, .png)
    audio/                Ambient music tracks (.ogg / .mp3)
    models/               Editor GLB assets
    sprites/              Editor sprite textures
  audio/                  Gameplay audio (AudioManager)
  camera/                 Orbit follow camera and collision (OrbitFollowCamera)
  character/              Player controller and FSM states
    PlayerController.ts   Kinematic character: gravity, grounding, slope, crouch, respawn
    CharacterFSM.ts       Finite state machine: state transitions, current state
    states/               Idle, Move, Jump, Air, Crouch, Interact (one file per state)
  core/
    GameLoop.ts           Fixed timestep accumulator (60 Hz physics, unlocked render)
    EventBus.ts           Typed publish/subscribe — all cross-system communication
    types.ts              InputState, EventMap, PlayerConfig, CameraConfig, interfaces
    constants.ts          Gameplay constants (speeds, timings, thresholds)
    UserSettings.ts       Persistent graphics/input preferences (localStorage)
    ObjectiveManager.ts   Objective tracking and completion
  input/                  Keyboard, mouse, gamepad polling (InputManager)
  interaction/            Proximity focus, interaction flow, interactables
    InteractionManager.ts Focus detection (distance + line-of-sight), trigger/hold logic
    interactables/        Door, ObjectiveBeacon, PhysicsRope (implement IInteractable)
  level/                  Level load/unload, procedural level, colliders, assets
    LevelManager.ts       Level lifecycle: load, unload, lighting, shadows
    CheckpointManager.ts  Checkpoint zones and respawn point updates
    ShowcaseLayout.ts     Shared showcase corridor layout (station Z positions)
  physics/
    PhysicsWorld.ts       Rapier world wrapper (zero gravity — custom gravity in player)
    ColliderFactory.ts    Collider creation helpers
    PhysicsDebugView.ts   Wireframe debug renderer for Rapier colliders
  editor/                 In-game level editor
  renderer/
    RendererManager.ts    WebGPU/WebGL renderer, TSL pipeline, MRT, all post-FX
  ui/
    UIManager.ts          UI container and system
    components/
      DebugPanel.ts       Runtime debug overlay with all tunable controls
      HUD.ts              Gameplay HUD (prompts, objectives, status)
      FadeScreen.ts       Screen fade transitions
    menus/                Main, pause, and settings menus
  vehicle/                Vehicle controllers and manager
```

### Bootstrap flow

`main.ts` initializes Rapier WASM, then constructs the renderer, physics world, input, level manager, player, camera, interaction, UI, audio, vehicles, and editor. The game loop starts after the main menu calls "Play" and the `procedural` level (centered showcase corridor) is loaded.

```
main.ts
  → RAPIER.init()
  → new RendererManager() → renderer.init() (WebGPU attempt, WebGL fallback)
  → new PhysicsWorld(), InputManager, LevelManager, PlayerController, OrbitFollowCamera
  → new InteractionManager, UIManager, AudioManager, VehicleManager
  → new Game(all systems) — wires EventBus listeners, spawns interactables/checkpoints
  → new GameLoop(game, physicsWorld, renderer)
  → new EditorManager, MenuManager → menu waits for "Play"
```

---

## Architecture

### Game loop

The `GameLoop` uses a fixed-timestep accumulator at 60 Hz for deterministic physics. Each frame:

1. **Accumulate** frame delta into the physics budget.
2. **Fixed tick** (may fire 0–N times per frame): `fixedUpdate(dt)` → `physicsWorld.step()` → `postPhysicsUpdate(dt)`.
3. **Render tick** (once per frame): `update(dt, alpha)` with interpolation alpha for smooth visuals between physics steps.

### Event bus

All cross-system communication goes through `EventBus<EventMap>`. The full event map lives in `src/core/types.ts`. Systems never import each other directly — they emit and listen to typed events.

Key event categories:
- `input:*` — Raw input state snapshots
- `player:*` — State changes, grounding, respawn
- `interaction:*` — Focus changes, triggers, blocks
- `checkpoint:*` — Checkpoint activation
- `objective:*` — Objective set/completed
- `level:*` — Level loaded/unloaded
- `debug:*` — All debug panel controls (graphics quality, post-FX toggles, environment, etc.)

### Player FSM

The player controller uses a finite state machine (`CharacterFSM`) with these states:

| State | File | Description |
|-------|------|-------------|
| `idle` | `IdleState.ts` | Standing still, waiting for input |
| `move` | `MoveState.ts` | Walking/sprinting on ground |
| `jump` | `JumpState.ts` | Jump initiation (applies upward velocity) |
| `air` | `AirState.ts` | Airborne (gravity, air control, double jump) |
| `crouch` | `CrouchState.ts` | Crouching (reduced speed, lower capsule) |
| `interact` | `InteractState.ts` | Interaction trigger (brief, returns to previous state) |

Adding a new state: create one file in `states/`, register it in `CharacterFSM`'s constructor, and add the state ID string.

### Physics

The project uses a **kinematic character controller** pattern:
- World gravity is **zero** — custom gravity is applied in `PlayerController`.
- Movement uses `computeColliderMovement(collider, desiredDelta)` for displacement-based motion with collision resolution.
- The player capsule floats above the ground using a spring-damper system (raycast grounding).
- Slopes, steps, and ladders are handled by raycasts and collision geometry tags.

---

## For contributors and extenders

- **Gameplay constants** (speeds, timings, thresholds): edit `src/core/constants.ts`.
- **New player states**: create a file in `src/character/states/`, implement the `State` interface, register in `CharacterFSM` constructor.
- **New interactables**: implement `IInteractable` and register with `InteractionManager` (see `Door`, `ObjectiveBeacon`, `PhysicsRope` in `src/interaction/interactables/`).
- **New environment maps**: add a `.hdr` file to `src/assets/env/`, add an entry to `ENV_PRESETS` in `RendererManager.ts`, and export via `ENV_NAMES`.
- **New LUT presets**: add the file (`.CUBE`, `.3dl`, or `.png`) to `src/assets/postfx/`, add an entry to `LUT_PRESETS` in `RendererManager.ts`.
- **New events**: add the event name and payload type to `EventMap` in `src/core/types.ts`.
- **Cross-system communication**: always use `EventBus` and the typed event map so systems stay decoupled.
- **Before committing**: run `npm run test` and `npm run build` to ensure tests pass and the project builds.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Controls don't respond | Click the canvas to focus it and enable pointer lock. |
np| No background music | Add `src/assets/audio/ambient-1.ogg` or update `main.ts`; a procedural fallback loop is used if the file is missing. |
| Rope climb doesn't work | Hold **Shift** and then press **W** or **S** (climb is Shift + W/S). |
| Very bright or "washed out" image | Lower **Exposure** and/or **SSGI GI intensity** in the debug panel. Try a different environment map. |
| Anti-aliasing looks different per tier | Each quality tier uses a fixed AA method: **High** = TRAA, **Medium** = TRAA (toggle), **Low** = FXAA. Switch tiers with **F6** or the debug panel. |
| Raw mouse not available | Some browsers/OS restrict pointer lock; the game falls back to normal pointer lock. |
| Black screen after toggling shadows | The WebGPU path keeps `shadowMap.enabled = true` and toggles light `castShadow`; if you see a black screen, try a page refresh. |
| WebGPU byte limit warnings | Expected on first compile; the renderer requests `maxColorAttachmentBytesPerSample: 64` to support the 5-target MRT. The adapter must support at least 64 bytes (most modern GPUs support 128). |
| Build or type errors | Run `npm run build` and fix any `tsc` or Vite errors; ensure Node 20+ and a clean `npm install`. |
| No post-processing (flat look) | WebGPU may not be available in your browser. Check the console for "WebGPU/TSL not available" — the app falls back to basic WebGL2 rendering. |

---

## License

See the repository license file.
