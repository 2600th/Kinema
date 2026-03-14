# Kinema

Kinema is a modular third-person gameplay framework built with **TypeScript**, **Three.js r183 (WebGPU)**, **Rapier physics**, **Tone.js**, and **Vite 8**. It ships a procedural showcase corridor, a built-in level editor with play-test mode, full mobile touch controls, and a post-processing stack aligned with Three.js r183's TSL pipeline.

## Feature Overview

### Gameplay
- **Character controller** — dynamic rigidbody with floating spring, modular locomotion modes (grounded, air, ladder, rope), coyote time, jump buffering, double jump, crouch, sprint, and moving-platform carry.
- **Interaction system** — distance + line-of-sight focus, prompt generation, hold-to-interact, grab/carry/throw with physics.
- **Vehicles** — arcade car (throttle, steer, handbrake) and hover drone (6DOF flight).
- **Checkpoint & objective system** — proximity-based checkpoints with fall respawn.
- **Procedural showcase** — 700-unit corridor with 14 stations: steps, slopes, movement (ladder/crouch/rope), double jump, grab, throw, door/beacon, vehicles, moving platforms, physics platforms, materials (10 PBR samples), GPU VFX (tornado, fire, lasers, lightning, scanner), and navigation (navmesh + patrol agents).

### Rendering
- **WebGPU-first** renderer with WebGL2 fallback (Three.js r183).
- **TSL post-processing pipeline**: GTAO, SSR, Bloom, SMAA/FXAA, CAS sharpening, Vignette, 3D LUT color grading (11 presets).
- **Three graphics profiles**: performance, balanced, cinematic — with per-effect runtime toggles.
- **Environment maps**: 7 HDR presets + procedural RoomEnvironment, with rotation and intensity controls.
- **PCF shadow mapping** with quality tiers (auto/performance/balanced/cinematic).

### Editor
- **Brush-based placement** — 8 preset types (block, floor, pillar, stairs, ramp, door frame, spawn, trigger).
- **GLB import** via file picker or drag-and-drop.
- **Transform gizmo** with translate/rotate/scale modes and grid snapping.
- **Hierarchy panel** — tree view with drag-drop reparenting, rename, visibility/lock toggles, grouping, search filter.
- **Inspector panel** — transform, material (color/roughness/metalness/emissive/opacity), physics type editing.
- **Play-test mode** — Start/Stop like Unity/Unreal with snapshot save/restore (Ctrl+P).
- **Undo/redo** — command-based history (50 items).
- **Save/load** — localStorage persistence + JSON download, V1→V2 migration.

### UI/UX
- **Menu system** — stack-based navigation with glassmorphic dark theme (Main, Pause, Settings, Level Select, Help).
- **Settings** — Controls (sensitivity, FOV, gamepad tuning), Graphics (profiles, AA, shadows, post-FX), Audio (master/music/SFX).
- **Help screen** — keybinding reference accessible from main and pause menus.
- **Debug panel** — real-time metrics, runtime view toggles, environment controls, quality settings, post-FX tweaks.
- **Responsive design** — scrollable settings, 44px touch targets on mobile, viewport-relative scaling.
- **HUD** — objectives, interaction prompts, crosshair, status notifications.

### Mobile Support
- **Full touch gameplay** — dual virtual joysticks (movement + camera look) with on-screen buttons for jump, interact, crouch, sprint.
- **Auto-detection** — touch controls appear on touch devices, hidden on desktop.
- **Responsive layout** — viewport-relative positioning for landscape and portrait modes.
- **Settings toggle** — manual enable/disable via Controls settings tab.

### Audio
- **Procedural music** — generative ambient soundtrack via Tone.js (no audio files).
- **Synth-based SFX** — footsteps, jump, land, interact, throw, vehicle engine sounds.
- **Spatial awareness** — volume scaling based on movement and interaction.

### Juice & Game Feel
- **Screen shake** — trauma-based with per-axis amplitudes and sin-product noise.
- **Hitstop** — freeze-frame system with accumulator discard (no catch-up replay).
- **FOV punch** — critically-damped spring for speed/impact feedback.
- **Camera landing dip** — spring-based compression + rebound.
- **Particles** — GPU-instanced pool with footstep dust, landing impacts, jump puffs, air jump spark bursts.
- **Variable jump height** — velocity cut ceiling for responsive short-hops.

## Getting Started

### Requirements

- Node.js 20+
- npm 10+
- A modern desktop browser (Chrome/Edge with WebGPU recommended)

### Install & Run

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. Click the canvas to engage pointer lock and audio.

### Quick Start

1. **Play** — loads the procedural showcase corridor.
2. **Level Select** — play the demo or any saved custom level.
3. **Create Level** — blank floor + editor. Use Ctrl+P to play-test.
4. **Settings** — configure controls, graphics, and audio.
5. **Help** — view all keybindings and controls.

### Deep-link to a Station

```
http://localhost:5173?station=vehicles
http://localhost:5173?station=movement
http://localhost:5173?station=materials
```

All 14 stations: `steps`, `slopes`, `movement`, `doubleJump`, `grab`, `throw`, `door`, `vehicles`, `platformsMoving`, `platformsPhysics`, `materials`, `vfx`, `navigation`, `futureA`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm run test` | Run Vitest unit tests |
| `npm run test:watch` | Run Vitest in watch mode |

## Testing

### Unit Tests (Vitest)

```bash
npm run test
```

Tests live in `src/**/*.test.ts` covering physics, level loading, checkpoints, input, and UI.

### Browser Tests (Playwright)

```bash
npx playwright install chromium
npx playwright test
```

Playwright tests (`tests/`) cover:
- **visual-check.ts** — main menu rendering, no bootstrap errors.
- **jump-mechanics.ts** — ground jump, double jump, air jump preservation, FSM transitions.
- **station-screenshots.ts** — loads all 14 stations, verifies player spawns grounded, captures screenshots.
- **vehicle-controllers.ts** — car and drone vehicle flows.
- **vfx-particles.ts** — VFX bay rendering.

The Playwright config auto-starts the dev server. Tests use SwiftShader for headless GPU rendering.

### Debug API

When running via `?station=`, a `window.__KINEMA__` debug API is available:
- `__KINEMA__.player` — position, velocity, isGrounded, state
- `__KINEMA__.simulateJump()` — inject jump input (bypasses pointer lock)
- `__KINEMA__.waitFor(predicate, timeout)` — poll physics state

## Controls

### On Foot

| Input | Action |
|---|---|
| `W A S D` / arrows | Move |
| Mouse | Look |
| Scroll | Zoom |
| `Space` | Jump / double jump |
| `Shift` | Sprint |
| `C` / `Left Ctrl` | Crouch |
| `F` | Interact / grab / release |
| LMB while carrying | Throw |
| `C` while carrying | Drop |
| `Escape` | Pause menu |
| `` ` `` | Debug panel |
| `F1` | Toggle editor |

### Rope

| Input | Action |
|---|---|
| `F` | Attach (in range) |
| `W A S D` | Swing momentum |
| `Shift + W/S` | Climb up/down |
| `Space` | Jump off |
| `C` | Drop |

### Car

| Input | Action |
|---|---|
| `F` | Enter/exit |
| `W/S` | Throttle / brake-reverse |
| `A/D` | Steer |
| `Shift` | Speed boost |
| `Space` | Handbrake |

### Drone

| Input | Action |
|---|---|
| `F` | Enter/exit |
| `W A S D` | Horizontal movement |
| Mouse | Yaw/look |
| `E/Q` | Ascend/descend |
| `Shift` | Speed boost |

### Editor

| Input | Action |
|---|---|
| LMB | Select / place |
| RMB drag | Look |
| MMB drag | Pan |
| Scroll | Dolly |
| `W A S D` | Move camera |
| `Q/E` | Up/down |
| `Shift` / `Ctrl` | Fast/slow camera |
| `W/E/R` | Translate/rotate/scale gizmo |
| `G` | Toggle grid |
| `1`-`8` | Select brush |
| `Ctrl+Z` / `Ctrl+Y` / `Cmd+Shift+Z` | Undo/redo |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl+P` / `Cmd+P` | Play-test toggle |

### Gamepad

| Input | Action |
|---|---|
| Left stick | Move |
| Right stick | Look |
| A / Cross | Jump |
| B / Circle | Crouch |
| X / Square | Interact |
| RT / R2 | Primary |
| LB or L3 | Sprint |

### Mobile Touch

| Control | Action |
|---|---|
| Left joystick | Movement |
| Right joystick | Camera look |
| Jump button (blue) | Jump / double jump |
| Interact button | Interact / grab |
| Crouch button | Crouch toggle |
| Sprint button | Sprint hold |

### Debug Shortcuts

| Input | Action |
|---|---|
| `F6` | Cycle graphics profile |
| `F7` | Toggle invert Y |
| `F8/F9` | Mouse sensitivity -/+ |
| `F10` | Toggle raw mouse input |
| `F11/F12` | Gamepad deadzone -/+ |
| `[` / `]` | Gamepad curve -/+ |
| `N` | Toggle nav debug overlay |
| `T` | Nav target click mode |

## Architecture

### Design Principles

- **Modular locomotion** — new movement types (swim, wall-run, dash) are added by creating a `CharacterMode` and registering it.
- **Pluggable game systems** — new runtime features implement `RuntimeSystem` and register with Game.
- **Tool-based editor** — new editor tools implement `EditorTool` (selection, brush, GLB placement already extracted).
- **EventBus decoupling** — typed pub/sub for UI, audio, debug, and gameplay cross-cutting concerns.
- **Fixed timestep** — 60Hz physics with unlocked render and interpolation alpha.

### Source Layout

```
src/
  audio/           — Tone.js procedural music + synth SFX
  camera/          — OrbitFollowCamera with spring arm collision
  character/       — PlayerController (orchestrator)
    modes/         — GroundedMode, AirMode, LadderMode, RopeMode
    states/        — FSM states (Idle, Move, Jump, AirJump, Air, Crouch, Grab, Carry, Interact)
  core/            — GameLoop, EventBus, types, constants, RuntimeSystem, UserSettings
  editor/          — EditorManager, EditorDocument, LevelSerializer
    brushes/       — Block, Floor, Pillar, Stairs, Ramp, DoorFrame, Spawn, Trigger
    panels/        — Toolbar, Hierarchy, Inspector, Brush
    tools/         — EditorTool interface, SelectionTool, BrushPlacementTool, GLBPlacementTool
  input/           — InputManager, VirtualJoystick, TouchButton, TouchControlsManager
  interaction/     — InteractionManager + interactables (Door, Beacon, Rope, Grabbable, Throwable, VehicleSeat)
  juice/           — ScreenShake, Hitstop, FOVPunch, FeedbackPlayer, GameParticles, ParticlePool
  level/           — LevelManager, ProceduralBuilder, LightingSystem, AssetLoader, MeshParser, ShowcaseLayout
  navigation/      — NavMeshManager, NavPatrolSystem, NavAgent, NavDebugOverlay
  physics/         — PhysicsWorld, ColliderFactory, PhysicsHelpers, PhysicsDebugView
  renderer/        — RendererManager (WebGPU/WebGL, TSL post-processing, graphics profiles)
  systems/         — InteractableSystem, ParticleSystem, DebugRuntimeSystem, CheckpointObjectiveSystem
  ui/
    components/    — HUD, FadeScreen, DebugPanel
    menus/         — MenuManager, MainMenu, PauseMenu, SettingsMenu, LevelSelectMenu, HelpMenu
  vehicle/         — VehicleManager, CarController, DroneController
tests/             — Playwright GPU tests (visual, jump mechanics, station screenshots, vehicles, VFX)
```

Path aliases: `@core`, `@physics`, `@character`, `@camera`, `@level`, `@input`, `@interaction`, `@ui`, `@renderer`, `@audio`, `@vehicle`, `@editor`, `@navigation`, `@juice`, `@systems`.

### Key Modules

| Module | Lines | Responsibility |
|--------|-------|---------------|
| PlayerController | ~580 | Thin orchestrator — input routing, mode switching, visual sync |
| CharacterMotor | ~300 | Ground detection, floating spring, gravity scaling |
| GroundedMode | ~550 | Walk, sprint, crouch, step assist, ground jump, platforms |
| Game.ts | ~600 | Composition root — registers and ticks RuntimeSystems |
| LevelManager | ~800 | Level loading/unloading orchestrator |
| ProceduralBuilder | ~2700 | Showcase corridor geometry generation |
| RendererManager | ~1400 | WebGPU renderer, TSL post-FX, graphics profiles |
| EditorManager | ~1160 | Editor shell — routes input to EditorTools |

### Rendering Pipeline (r183-aligned)

```
Scene Pass (opaque depth + normal MRT)
  → GTAO (ground-truth ambient occlusion) + Denoise
  → Scene Pass (full scene with metalness/roughness MRT)
  → SSR (screen-space reflections, additive blend)
  → Bloom (threshold + soft knee)
  → SMAA (morphological AA — in linear space, before sRGB)
  → renderOutput() (sRGB conversion)
  → FXAA (fast AA — in sRGB space, after conversion)
  → CAS sharpening (conditional — only when enabled)
  → Vignette
  → LUT 3D color grading
```

## Current Limitations

- Custom/editor levels don't recreate showcase runtime objects (rope, vehicles, etc.).
- Imported GLBs are session-local unless placed in `public/assets/models/`.
- WebGPU improves visuals but the project remains playable on WebGL2 fallback.
- Mobile editor support is limited to gameplay; brush placement requires desktop.
- The player visual is a capsule placeholder (rigged character model is a planned upgrade).

## Contributing

- Gameplay constants: `src/core/constants.ts`
- New movement type: create a `CharacterMode` in `src/character/modes/`, register in PlayerController
- New game system: implement `RuntimeSystem` in `src/systems/`, register in Game constructor
- New editor tool: implement `EditorTool` in `src/editor/tools/`, register in EditorManager
- New interactable: implement the interface in `src/interaction/interactables/`
- Before landing changes: `npm run test && npm run build`
