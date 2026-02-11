# Kinema

Kinema is a modular third-person controller playground built with Three.js and Rapier.
It is structured like a small engine so contributors can iterate on movement, camera, level logic, and interaction systems without tightly coupling everything.

## Prerequisites

- Node.js 20+ recommended
- npm 10+

## Quick Start

```bash
npm install
npm run dev
```

Open the local Vite URL, click the canvas to lock the pointer, and use controls:

| Input | Action |
| --- | --- |
| `W A S D` / Arrow keys | Move |
| `Mouse` | Look |
| `Space` | Jump |
| `Shift` | Sprint |
| `E` | Interact |
| `` ` `` | Toggle FPS stats panel |

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run test:watch
```

## Tech Stack

- TypeScript (strict)
- Three.js (`WebGLRenderer`) + postprocessing (`EffectComposer`, `SMAAPass`, `OutputPass`)
- Rapier (`@dimforge/rapier3d-compat`)
- Vite 6
- Vitest

## Project Structure

```text
src/
  main.ts                 Bootstrap and system wiring
  Game.ts                 Top-level orchestrator
  core/
    GameLoop.ts           Fixed timestep loop + interpolation
    EventBus.ts           Typed pub/sub event bus
    constants.ts          Gameplay/camera/physics tuning values
    types.ts              Shared interfaces and event map
  renderer/
    RendererManager.ts    Renderer, scene, camera, postprocessing chain
  physics/
    PhysicsWorld.ts       Rapier world wrapper + ray/shape casts
    ColliderFactory.ts    Rigid-body/collider construction helpers
  character/
    PlayerController.ts   Dynamic capsule movement, slopes, step assist, ladder support
    CharacterFSM.ts       Character state machine
    states/               Idle/Move/Jump/Air/Interact state classes
  camera/
    OrbitFollowCamera.ts  Orbit follow camera with collision handling
  level/
    LevelManager.ts       Procedural/GLTF level lifecycle, colliders, moving objects
    AssetLoader.ts        GLTF loader cache wrapper
    MeshParser.ts         Name-based mesh classification
    LevelValidator.ts     Level validation helpers
  interaction/
    InteractionManager.ts Focus detection + trigger flow
    interactables/Door.ts Door interactable
  input/
    InputManager.ts       Keyboard/mouse + pointer lock handling
  ui/
    UIManager.ts          Overlay orchestration
    components/           HUD, fade screen, stats panel
```

## Architecture Notes

- **Decoupled communication:** systems communicate through `EventBus` events.
- **Fixed physics update:** simulation runs at 60 Hz in `GameLoop`; render updates are interpolated.
- **Dynamic player body:** player movement uses impulses and custom support logic (grounding, slopes, step assist).
- **Camera collision:** follow camera uses shape casting to avoid clipping through world geometry.
- **Level lifecycle:** `LevelManager` owns loading, spawning colliders, and complete unload disposal.

## Development Workflow

1. Run `npm run dev`.
2. Make changes in `src/`.
3. Validate with:
   - `npm run build`
   - `npm run test`

## Common Contributor Tasks

- **Tune movement feel:** edit `src/core/constants.ts`.
- **Add new interactables:** implement `IInteractable` and register with `InteractionManager`.
- **Add new player states:** add a state class under `src/character/states` and register in `CharacterFSM`.
- **Change level layout:** edit `LevelManager.buildProceduralLevel()` or add GLTF assets.

## Troubleshooting

- If movement input does not work, ensure the canvas is clicked and pointer lock is active.
- If physics behaves incorrectly after big changes, restart the dev server to force a clean reload.
- If postprocessing/shadows look wrong after renderer edits, verify `RendererManager` pass order and light shadow settings.

# Kinema

A modular third-person controller framework built with **Three.js** (WebGPU) and **Rapier** physics. Kinema is not just a character script — it is a micro-engine architecture designed for extensibility, solving common web game problems like jittery physics, poor state management, and brittle level loading.

## Quick Start

```bash
npm install
npm run dev
```

Click the canvas to capture the mouse, then:

| Key | Action |
|---|---|
| `W A S D` / Arrow keys | Move |
| `Mouse` | Look around |
| `Space` | Jump |
| `Shift` | Sprint |
| `E` | Interact (when prompted) |
| `` ` `` (backtick) | Toggle debug panel |

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode, zero `any`) |
| Renderer | Three.js v172+ via `three/webgpu` (auto WebGL2 fallback) |
| Physics | Rapier (`@dimforge/rapier3d-compat` — WASM embedded, no separate hosting) |
| Build | Vite 6 with WASM + top-level-await plugins |
| State | Vanilla typed EventBus (no external state library) |

## Architecture

Kinema follows four strict principles:

1. **Decoupling** — Systems communicate through a typed `EventBus`. Input knows nothing about the Player. The Player knows nothing about the UI.
2. **Kinematic Authority** — The character is a kinematic body. No forces are applied; precise displacements are calculated via Rapier's `computeColliderMovement()`.
3. **Fixed Timestep** — Physics runs at exactly 60 Hz. Rendering runs at monitor refresh rate. The visual mesh is interpolated between physics states to eliminate jitter on any display.
4. **Data-Driven Levels** — Levels load from GLTF/GLB files. Mesh naming conventions (`_col`, `_sensor`, `_nav`, `SpawnPoint`) drive automatic physics body generation.

### System Dataflow

```
InputManager ──poll()──> EventBus ──input:state──> PlayerController
                                                        │
                                              CharacterFSM.handleInput()
                                              CharacterFSM.getDesiredMovement()
                                                        │
                                              computeColliderMovement()
                                                        │
                                              setNextKinematicTranslation()
                                                        │
                              EventBus <──player:stateChanged──┘
                                │
                    UIManager / DebugPanel
```

### The Game Loop

```
┌─────────────────── requestAnimationFrame ───────────────────┐
│                                                             │
│   accumulator += frameDelta                                 │
│                                                             │
│   while (accumulator >= 1/60):          ← Fixed 60 Hz      │
│       physics.step()                                        │
│       game.fixedUpdate(dt)                                  │
│       accumulator -= 1/60                                   │
│                                                             │
│   alpha = accumulator / (1/60)          ← Interpolation     │
│   game.update(dt, alpha)                                    │
│   renderer.render()                     ← Unlocked FPS      │
└─────────────────────────────────────────────────────────────┘
```

A spiral-of-death clamp (250 ms max frame) prevents runaway accumulation if the tab loses focus.

## Project Structure

```
src/
├── main.ts                          # Async bootstrap (RAPIER.init, renderer.init)
├── Game.ts                          # Top-level orchestrator, wires all systems
│
├── core/
│   ├── GameLoop.ts                  # Accumulator loop (60 Hz physics, unlocked render)
│   ├── EventBus.ts                  # Typed pub/sub — on() returns unsubscribe function
│   ├── types.ts                     # InputState, StateId, EventMap, configs
│   └── constants.ts                 # Physics & gameplay tuning values
│
├── input/
│   └── InputManager.ts              # Keyboard + pointer lock → frozen InputState
│
├── physics/
│   ├── PhysicsWorld.ts              # Rapier world wrapper, sync factory, castShape/castRay
│   ├── ColliderFactory.ts           # Mesh → trimesh/capsule/sensor/cylinder colliders
│   └── PhysicsHelpers.ts            # THREE ↔ Rapier vector/quaternion conversion
│
├── character/
│   ├── PlayerController.ts          # Capsule body, custom gravity, interpolation
│   ├── CharacterFSM.ts             # State machine runner, emits stateChanged events
│   └── states/
│       ├── State.ts                 # Abstract base (enter/exit/handleInput/update/getDesiredMovement)
│       ├── IdleState.ts             # Zero movement, transitions on any input
│       ├── MoveState.ts             # Camera-relative WASD, smooth rotation
│       ├── JumpState.ts             # Vertical impulse → immediate transition to air
│       ├── AirState.ts              # Reduced control (0.3x), lands into idle/move
│       └── InteractState.ts         # Locks movement for duration, fires interaction
│
├── camera/
│   └── OrbitFollowCamera.ts         # Spring arm + sphere shapecast collision avoidance
│
├── level/
│   ├── LevelManager.ts              # GLTF loading, scene traversal, full cleanup on unload
│   ├── AssetLoader.ts               # GLTFLoader wrapper with cache
│   └── MeshParser.ts                # Name convention parsing (_col, _sensor, _nav, SpawnPoint)
│
├── interaction/
│   ├── InteractionManager.ts        # Cylinder sensor proximity detection, focus tracking
│   ├── Interactable.ts              # IInteractable interface
│   └── interactables/
│       └── Door.ts                  # Sample: toggles open/closed, highlights on focus
│
├── ui/
│   ├── UIManager.ts                 # DOM overlay controller, event-driven
│   └── components/
│       ├── HUD.ts                   # "Press E to Interact" prompt
│       ├── FadeScreen.ts            # CSS opacity transition overlay (returns Promise)
│       └── DebugPanel.ts            # FPS, speed, state, grounded — throttled updates
│
└── renderer/
    └── RendererManager.ts           # WebGPURenderer setup, resize handling, scene/camera
```

## Core Systems

### Player Controller

The player is a kinematic capsule rigid body. Movement is never applied through forces — instead, each fixed tick:

1. Ground is detected via downward raycast
2. The FSM computes a desired displacement from the current state
3. Custom gravity is accumulated (`verticalVelocity -= 9.81 * dt`) with terminal velocity clamping
4. `computeColliderMovement()` resolves the displacement against world geometry
5. `setNextKinematicTranslation()` applies the corrected position

Visual interpolation (`lerpVectors` with alpha) runs every render frame for smooth display on high-refresh monitors.

**Configuration** (`src/core/constants.ts`):

| Parameter | Value |
|---|---|
| Capsule radius | 0.3 m |
| Capsule half-height | 0.5 m |
| Move speed | 5 m/s |
| Sprint multiplier | 1.6x |
| Jump force | 6 m/s |
| Air control | 0.3x |
| Skin width (offset) | 0.01 |
| Max slope climb | 45 deg |
| Min slope slide | 50 deg |
| Autostep max height | 0.3 m |

### Character FSM

A strict finite state machine governs all player behavior. Each state is a self-contained class:

```
              ┌──────────┐
         ┌───>│   Idle   │<───┐
         │    └────┬─────┘    │
    no input       │ WASD     │ landed + no input
         │    ┌────▼─────┐    │
         └────│   Move   │────┘
              └────┬─────┘
                   │ Space
              ┌────▼─────┐
              │   Jump   │ (one frame — applies impulse)
              └────┬─────┘
                   │ immediate
              ┌────▼─────┐
              │   Air    │───── landed ────> Idle / Move
              └──────────┘

Any grounded state + E ──> Interact ──(0.3s)──> Idle
```

**Adding a new state** (e.g., Crouch) requires:
1. Create `src/character/states/CrouchState.ts` extending `State`
2. Add `'crouch'` to the `StateId` union in `src/core/types.ts`
3. Register it in `CharacterFSM` constructor: `this.registerState(new CrouchState(player))`

No changes to `PlayerController.ts` needed.

### Camera System

The `OrbitFollowCamera` uses a spring-arm approach:

- **Pivot** at player head height (configurable offset)
- **Spherical coordinates** driven by mouse yaw/pitch (pitch clamped to +/- 60 deg)
- **Shapecast collision**: a sphere (r=0.2) is cast from pivot toward the ideal camera position. If geometry is hit, the camera distance shortens to avoid clipping
- **Damped distance** smoothly transitions between obstructed and unobstructed positions
- The player's capsule collider is excluded from the shapecast

The camera update runs every render frame (not at the fixed rate) for maximum responsiveness.

### Level System

Levels can be loaded from GLTF/GLB files or generated procedurally. The `LevelManager` handles the full lifecycle:

**Loading:** Scene graph traversal classifies meshes by name:

| Name contains | Result |
|---|---|
| `_col` | Static trimesh collider (world transform baked into vertices) |
| `_sensor` | Sensor/trigger cuboid collider |
| `_nav` | Navmesh (reserved for future use) |
| `SpawnPoint` | Player spawn position |
| (none) | Visual-only mesh |

**Unloading:** `LevelManager.unload()` removes all colliders, rigid bodies, scene objects, and disposes geometries/materials. Calling `load()` on a new level automatically unloads the current one first.

The included **procedural test level** contains a floor, two ramps (20 deg and 40 deg), stepped platforms, boundary walls, an elevated platform, and a door interactable.

### Interaction System

- A cylinder sensor collider is attached to the player body
- Each fixed tick, `InteractionManager` checks distances to all registered `IInteractable` objects
- The closest one within range gets focus (`onFocus()` / `onBlur()` for visual feedback)
- When the FSM enters `InteractState`, the focused interactable's `interact()` method fires
- The `HUD` component shows/hides a context prompt via the `interaction:focusChanged` event

### EventBus

All inter-system communication flows through a typed `EventBus`:

| Event | Payload | Description |
|---|---|---|
| `input:state` | `InputState` | Frozen input snapshot each fixed tick |
| `player:stateChanged` | `{ previous, current }` | FSM transition |
| `player:grounded` | `boolean` | Grounded status changed |
| `interaction:focusChanged` | `{ id, label }` | Nearest interactable changed |
| `interaction:triggered` | `{ id }` | Interaction executed |
| `level:loaded` | `{ name }` | Level finished loading |
| `level:unloaded` | `{ name }` | Level cleaned up |
| `debug:toggle` | `undefined` | Debug panel toggled |

`on()` returns an unsubscribe function for clean teardown.

## Scripts

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # Type-check + production build
npm run preview   # Preview production build locally
```

## Path Aliases

TypeScript and Vite are configured with path aliases for clean imports:

```typescript
import { EventBus } from '@core/EventBus';
import { PhysicsWorld } from '@physics/PhysicsWorld';
import { PlayerController } from '@character/PlayerController';
// @core, @physics, @character, @camera, @level, @input, @interaction, @ui, @renderer
```

## Design Decisions

| Decision | Rationale |
|---|---|
| `three/webgpu` import | WebGPURenderer with automatic WebGL2 fallback; `await renderer.init()` is mandatory |
| `rapier3d-compat` | WASM embedded as base64 — no separate `.wasm` file hosting needed |
| Synchronous `PhysicsWorld.create()` | `RAPIER.init()` handles async in `main.ts`; all downstream constructors are synchronous |
| Kinematic body (no forces) | Precise displacement control via `computeColliderMovement()` eliminates floaty/unpredictable movement |
| Custom gravity accumulator | Kinematic bodies ignore engine gravity; manual `verticalVelocity -= g * dt` with terminal velocity clamping |
| DOM-based UI | Simpler than WebGL text rendering, native CSS transitions, `pointer-events: none` passthrough |
| Pre-allocated temp vectors | `_moveVec`, `_forward`, `_right` etc. are module-level to avoid GC pressure in 60 Hz hot paths |

## License

See project license file.
