# Kinema

**Kinema** is a modular third-person gameplay playground built with **Three.js** and **Rapier**. It is structured like a small game engine: movement, camera, rendering, levels, interaction, audio, and UI are separate systems that communicate through a typed event bus, so you can work on one area without touching the rest.

---

## What’s in the box

- **Player controller** — Rigid-body movement with slope handling, step assist, ladders, coyote time, jump buffer, double jump, and crouch.
- **Rope traversal** — Attach from ground or mid-air; swing with `W A S D`, climb with `Shift + W/S`, jump off or drop with `Space` / `C`.
- **Orbit follow camera** — Collision-aware, zoom, damping, sprint FOV, and rope-aware behavior.
- **Interaction system** — Proximity and line-of-sight filtering, hold-to-interact, lock conditions; framework for doors, beacons, ropes, etc.
- **Gameplay** — Checkpoints/respawn, objective tracking, HUD prompts and status messages.
- **Debug panel** — FPS, physics/render metrics, and grouped controls for quality, post-processing, and input tuning.
- **Rendering** — TSL post-processing when WebGPU is available: scene pass with MRT, **SSGI** (global illumination + AO), **TRAA** (temporal AA), plus controls for SSR, bloom, vignette, and LUT; falls back to WebGL2 otherwise.

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

- **Click the canvas** so the page can capture the pointer (required for mouse look and pointer lock).
- Move with **W A S D**, look with the **mouse**, jump with **Space**, interact with **E**.
- Press **`` ` ``** (backtick) to open or close the **debug panel** for graphics and tuning.

That’s enough to run the project and try the procedural test level (slopes, rope, steps, beacon, door).

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
| `C` or `Left Ctrl` | Crouch |
| `E` | Interact (e.g. door, beacon, rope) |
| `` ` `` | Toggle debug panel |

### On the rope (after attaching with `E`)

| Input | Action |
|-------|--------|
| `W A S D` | Build swing momentum |
| `Shift + W` | Climb up |
| `Shift + S` | Climb down |
| `Space` | Jump off rope |
| `C` or `Left Ctrl` | Drop from rope |

You can attach to the rope with `E` from the ground or in the air when in range.

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

- **Runtime views** — FPS graph, collider debug, light helpers, camera collision.
- **Quality** — Graphics preset, **anti-aliasing** (TAA, SMAA, FXAA, Off), post-processing master toggle, shadows, exposure.
- **Post FX** — **SSGI** (toggle, quality preset, radius, GI intensity), **TRAA** (toggle), SSR, bloom, vignette, LUT.

Changing anti-aliasing or turning post-processing off will visibly change the image (e.g. TAA vs no AA).

---

## Rendering overview

- **WebGPU path** (when available): Three.js `WebGPURenderer` + TSL `PostProcessing`. Scene is rendered with an MRT pass (color, depth, normals, velocity, metal/rough). That feeds **SSGI** (screen-space global illumination + AO) and **TRAA** (temporal reprojection anti-aliasing). Output then goes through post-FX (SSR, vignette, LUT). SSGI/TRAA and quality presets are exposed in the debug panel.
- **Fallback**: If WebGPU isn’t available, the app uses a standard **WebGL2** renderer without the TSL pipeline.
- **SSGI presets**: Low = 1 slice / 12 steps, Medium = 2 / 8, High = 3 / 16 (with temporal filtering). Default SSGI radius and GI intensity can be tuned in `RendererManager`.
- LUT assets live under `src/assets/postfx/`.

---

## Tech stack

- **TypeScript** (strict mode)
- **Three.js** — `WebGPURenderer` + TSL when available, `WebGLRenderer` fallback
- **Rapier** — `@dimforge/rapier3d-compat` (3D physics, WASM)
- **Vite** — Dev server, build, path aliases
- **Vitest** — Unit tests

---

## Project structure and path aliases

Source lives under `src/`. Imports use **path aliases** so you don’t rely on long relative paths:

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

Example: `import { EventBus } from '@core/EventBus';` instead of `import { EventBus } from '../../core/EventBus';`.

### Directory layout

```text
src/
  main.ts                 Entry point: Rapier init, system wiring, Game + GameLoop start
  Game.ts                 Top-level game logic and system orchestration
  audio/                  Gameplay audio (AudioManager)
  camera/                 Orbit follow camera and collision (OrbitFollowCamera)
  character/              Player controller and FSM states (PlayerController, CharacterFSM, states/)
  core/                   Game loop, EventBus, UserSettings, shared types, constants
  input/                  Keyboard, mouse, gamepad (InputManager)
  interaction/            Focus, interaction flow, interactables (InteractionManager, Door, ObjectiveBeacon, PhysicsRope)
  level/                  Level load/unload, procedural level, colliders, assets (LevelManager, CheckpointManager, etc.)
  physics/                Rapier world wrapper, collider factory, debug view (PhysicsWorld, ColliderFactory)
  renderer/               Renderer, TSL pipeline, post-FX (RendererManager)
  ui/                     HUD, debug panel, overlays (UIManager, DebugPanel, HUD)
```

`main.ts` initializes Rapier WASM, then constructs the renderer, physics world, input, level manager, player, camera, interaction, and UI, wires them via `EventBus`, and starts the game loop after loading the `procedural` level.

---

## Architecture in short

- **Fixed timestep game loop** — Physics at 60 Hz; render uses interpolation so motion stays smooth.
- **Post-physics sync** — Visual transforms (meshes, colliders) are updated after each physics step.
- **Typed event bus** — Systems talk through `EventBus` and `EventMap`; no direct renderer/camera/level coupling in gameplay code.
- **Level lifecycle** — Level load/unload creates and disposes meshes, colliders, and bodies; `LevelManager` owns level state.
- **Settings persistence** — Graphics and input preferences are loaded on startup and can be changed at runtime (and persisted where supported).

---

## For contributors and extenders

- **Gameplay constants** (speeds, timings, thresholds): edit `src/core/constants.ts`.
- **New interactables**: implement the `IInteractable` interface and register with `InteractionManager` (see `Door`, `ObjectiveBeacon`, `PhysicsRope` in `src/interaction/interactables/`).
- **Cross-system communication**: use `EventBus` and the typed event map in `src/core/types.ts` so systems stay decoupled.
- **Before committing**: run `npm run test` and `npm run build` to ensure tests pass and the project builds.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Controls don’t respond | Click the canvas to focus it and enable pointer lock. |
| Rope climb doesn’t work | Hold **Shift** and then press **W** or **S** (climb is Shift + W/S). |
| Very bright or “washed out” image | Lower **Exposure** and/or **SSGI GI intensity** in the debug panel; reduce **Environment intensity** in code if needed. |
| Anti-aliasing change has no effect | Ensure **Post processing** is on and choose **TAA**, **SMAA**, **FXAA**, or **Off** in the debug panel; the pipeline respects the selected mode. |
| Raw mouse not available | Some browsers/OS restrict pointer lock; the game falls back to normal pointer lock. |
| Black screen after toggling shadows | The WebGPU path keeps shadow map enabled and toggles light `castShadow`; if you see a black screen, try a refresh. |
| Build or type errors | Run `npm run build` and fix any `tsc` or Vite errors; ensure Node 20+ and a clean `npm install`. |

---

## License

See the repository license file.
