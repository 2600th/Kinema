# Kinema

Kinema is a third-person gameplay sandbox built with TypeScript, Three.js, Rapier, Tone.js, and Vite. The current repo combines a procedural showcase corridor, a local level editor, a car and drone, navigation demos, and a rendering/debug stack that is meant to be poked at while you build gameplay systems.

## Current feature set

- Procedural showcase corridor with stations for steps, slopes, movement, double jump, grabbing, throwing, doors, vehicles, moving/physics platforms, materials, VFX, and navigation.
- Rigid-body player controller with coyote time, jump buffering, one air jump, crouch, ladders, rope traversal, moving-platform carry, checkpoint respawn, and fall respawn.
- Orbit follow camera with zoom, damping, collision spherecasts, landing dip, speed/FOV response, vehicle handoff, and screen shake hooks.
- Interaction system with distance + line-of-sight focus, prompt generation, shared highlighting, and optional hold-to-interact behavior.
- Runtime interactables including doors, an objective beacon, rope, grabbable physics bodies, throwable objects, and vehicle seats.
- Two vehicles: an arcade-style car and a hover drone.
- In-game editor with brushes, hierarchy, inspector, transform gizmo, snapping, undo/redo, save/load, and GLB import.
- Navigation showcase using `navcat` for navmesh generation, pathfinding, and patrol agents.
- DOM HUD and menus, persistent settings, procedural music, synth-based SFX, particles, hitstop, FOV punch, and debug tooling.
- WebGPU-first renderer with WebGL fallback, graphics profiles, runtime post-processing toggles, and a large debug panel.

## Getting started

### Requirements

- Node.js 20+ recommended
- npm 10+ recommended
- A modern desktop browser

The repo does not enforce Node/npm versions in metadata, but the current Vite + TypeScript setup is happiest on recent Node.

### Install

```bash
npm ci
```

### Run locally

```bash
npm run dev
```

Open the local Vite URL, usually `http://localhost:5173`.

### First-time play flow

1. Use `Play` to load the procedural showcase level.
2. Use `Level Select` to play the procedural demo or a saved custom level.
3. Use `Create Level` to open a blank floor-only level and jump straight into the editor.
4. Click the canvas once after starting or resuming play so pointer lock and audio can fully engage.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check app source with `tsc` and build with Vite. |
| `npm run preview` | Preview the production build locally. |
| `npm run test` | Run Vitest once. |
| `npm run test:watch` | Run Vitest in watch mode. |

## Testing

Vitest coverage currently lives in `src/**/*.test.ts`:

```bash
npm run test
```

There are also Playwright browser smoke tests for visuals and vehicle flows, but they are manual today: Playwright does not auto-start the dev server and there is no npm wrapper script yet.

```bash
# terminal 1
npm run dev

# terminal 2
npx playwright install chromium
npx playwright test
```

The Playwright specs expect the app to be available at `http://localhost:5173`.

## Controls

### On foot

| Input | Action |
|---|---|
| `W A S D` or arrow keys | Move |
| Mouse | Look |
| Mouse wheel | Zoom |
| `Space` | Jump / air jump |
| `Shift` | Sprint |
| `C` or `Left Ctrl` | Crouch |
| `F` | Interact, attach to rope, enter/exit vehicles, release grabbed object |
| Left mouse or `F` while carrying | Throw carried object |
| `C` while carrying | Drop carried object |
| `Escape` | Pause menu |
| `` ` `` | Toggle debug panel |
| `F1` | Toggle editor |

### Rope

| Input | Action |
|---|---|
| `F` | Attach when in range |
| `W A S D` | Build swing momentum |
| `Shift + W` | Climb up |
| `Shift + S` | Climb down |
| `Space` | Jump off |
| `C` | Drop from rope |

### Car

| Input | Action |
|---|---|
| `F` | Enter / exit |
| `W` / `S` | Throttle / brake-reverse |
| `A` / `D` | Steer |
| `Shift` | Faster top speed |
| `Space` | Handbrake |

### Drone

| Input | Action |
|---|---|
| `F` | Enter / exit |
| `W A S D` | Horizontal movement |
| Mouse | Yaw/look steering |
| `E` / `Q` | Primary vertical movement |
| `Shift` | Speed boost |

The drone also accepts jump/crouch-derived vertical input, but `E` and `Q` are the cleanest keyboard bindings to remember.

### Editor

Editor mode keeps the cursor free and does not use pointer lock.

| Input | Action |
|---|---|
| Left mouse | Select / place |
| Right mouse drag | Look |
| Middle mouse drag | Pan |
| Mouse wheel | Dolly |
| `W A S D` | Move editor camera |
| `Q` / `E` | Up / down |
| `Shift` / `Left Ctrl` | Fast / slow camera |
| `W` / `E` / `R` | Translate / rotate / scale gizmo |
| `G` | Toggle grid |
| `1`-`8` | Select brush |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Delete` / `Backspace` | Delete selected object |

The current brush set is: block, floor, pillar, stairs, ramp, door frame, spawn, and trigger.

### Gamepad

| Input | Action |
|---|---|
| Left stick | Move |
| Right stick | Look |
| `A` / Cross | Jump |
| `B` / Circle | Crouch |
| `X` / Square | Interact |
| `RT` / `R2` | Primary action |
| `LB` or left-stick press | Sprint / boost |

### Useful debug shortcuts

| Input | Action |
|---|---|
| `F6` | Cycle graphics profile |
| `F7` | Toggle invert Y |
| `F8` / `F9` | Adjust mouse sensitivity |
| `F10` | Toggle raw mouse input |
| `F11` / `F12` | Adjust gamepad deadzone |
| `[` / `]` | Adjust gamepad curve |

## Menus and flow

- `Play` loads the full procedural showcase corridor.
- `Level Select` always includes `Procedural Demo` and lists saved custom levels from local storage.
- `Create Level` loads a blank level, spawns the player, and opens the editor immediately.
- `Settings` exposes `Controls`, `Graphics`, and `Audio` tabs with persistent values.
- `Escape` opens the pause menu during play.

Settings and saved levels are persisted in `localStorage`.

## Showcase stations

The procedural corridor currently includes these stations:

- `steps`
- `slopes`
- `movement`
- `doubleJump`
- `grab`
- `throw`
- `door`
- `vehicles`
- `platformsMoving`
- `platformsPhysics`
- `materials`
- `vfx`
- `navigation`

For focused debugging, you can deep-link straight into a station:

```text
http://localhost:5173?station=vehicles
http://localhost:5173?station=movement
http://localhost:5173?station=navigation
```

## Architecture snapshot

### Bootstrap

`src/main.ts` initializes Rapier, loads persisted settings, creates the renderer/physics/input/game systems, then starts either:

- the normal menu flow,
- a saved custom level,
- a blank editor level, or
- a direct `?station=` boot path.

### Main runtime pieces

- `src/Game.ts`: top-level orchestration, showcase setup, objectives, checkpoints, debug hotkeys, runtime interactables, navigation hooks, juice.
- `src/core/GameLoop.ts`: fixed 60 Hz simulation plus per-frame render/update.
- `src/character/PlayerController.ts`: locomotion, rope/ladder handling, carrying/grabbing, respawn.
- `src/character/CharacterFSM.ts`: currently registers `idle`, `move`, `jump`, `air`, `interact`, `crouch`, `grab`, and `carry`.
- `src/level/LevelManager.ts`: procedural showcase building, JSON level loading, GLTF level loading, and nav showcase setup.
- `src/editor/EditorManager.ts`: editor lifecycle, save/load/import, panels, selection, grouping, gizmos.
- `src/renderer/RendererManager.ts`: renderer init, graphics profiles, post FX, WebGPU/WebGL fallback.

### Source layout

```text
src/
  audio/       camera/      character/   core/
  editor/      input/       interaction/ juice/
  level/       navigation/  physics/     renderer/
  ui/          vehicle/
```

Path aliases are configured for the main feature areas, including `@core`, `@physics`, `@character`, `@camera`, `@level`, `@input`, `@interaction`, `@ui`, `@renderer`, `@audio`, `@vehicle`, `@editor`, `@navigation`, and `@juice`.

### Communication model

There is a typed `EventBus` used widely across UI, audio, debug, and gameplay systems, but the app is not purely event-driven. Core orchestrators and managers also hold direct references to each other where that keeps runtime flow simpler.

## Rendering and audio notes

- Kinema attempts to initialize a WebGPU-based Three.js renderer first and falls back to `WebGLRenderer` when needed.
- Graphics profiles are `performance`, `balanced`, and `cinematic`.
- Runtime graphics controls cover anti-aliasing, resolution scale, shadows, environment rotation, ambient occlusion, SSR, bloom, CAS sharpening, vignette, and LUT toggles.
- Music is procedural Tone.js audio, not a playlist of checked-in music files.
- Audio starts after a user gesture; if the game is silent, click the canvas again.

## Current limitations and caveats

- Custom/editor levels are currently sandbox-oriented. They do not automatically recreate the showcase's runtime objectives, rope, doors, throwable setup, vehicles, or navigation agents.
- Imported GLB files added through the editor are session-local unless you also place the asset in `public/assets/models/` and reference it from there.
- If a character GLB exists in `src/assets/models/`, the player visual will try to auto-load it. If not, the fallback capsule stays visible.
- Some interaction types support hold-to-interact, but the showcase mostly uses press interactions today.
- WebGPU improves visuals, but the project is meant to remain playable on the fallback renderer too.

## Contributing pointers

- Gameplay constants live in `src/core/constants.ts`.
- New player states are registered in `src/character/CharacterFSM.ts`.
- New interactables implement the shared interface in `src/interaction/`.
- Editor serialization lives in `src/editor/LevelSerializer.ts`.
- Before landing gameplay changes, run `npm run test` and `npm run build`.
