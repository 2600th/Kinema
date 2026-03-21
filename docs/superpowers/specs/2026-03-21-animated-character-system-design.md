# Animated Character System Design

**Date**: 2026-03-21
**Status**: Reviewed
**Scope**: Replace capsule characters with animated mannequin models using UAL animation libraries

---

## Problem

The player is a blue capsule and NPCs are orange capsules. The project has downloaded the Universal Animation Library (UAL) packs from Quaternius with 88+ professional animations and a mannequin model. The character system needs to:

1. Replace the capsule with an animated mannequin model
2. Play appropriate animations for each game state
3. Support speed-based locomotion blending (walk → jog → sprint)
4. Use the same model with color tinting for NPCs
5. Be modular enough to swap models and animations in the future

## Loading Strategy

The existing `CharacterVisual.ts` uses `import.meta.glob('../assets/models/*.glb')` for build-time model discovery from `src/assets/models/`. The UAL assets live in `public/assets/models/` (runtime-served). The new system loads models at **runtime** via `AssetLoader.load(url)` with explicit URLs from the profile. This is more reliable (exact paths, no glob guessing) and works with the `public/` directory where large assets belong.

## Architecture Overview

```
AnimationProfile (data)
    ↓
CharacterFactory (creation)
    ├── CharacterModel (mesh + skeleton + clips)
    └── AnimationController (mixer + blending + state transitions)
```

**CharacterFactory** is a stateless factory function that creates a `CharacterModel` + `AnimationController` pair from an `AnimationProfile`. Used by both `PlayerController` (player) and `NavAgent` (NPCs).

---

## Data Layer: AnimationProfile

### Type definitions

```typescript
// src/character/animation/AnimationProfile.ts

interface ClipDef {
  clip: string;           // Exact clip name in the GLB (e.g. "Jog_Fwd_Loop")
  loop: boolean;          // LoopRepeat vs LoopOnce+clamp
  timeScale?: number;     // Playback speed multiplier. Default 1.0
}

interface LocomotionBlend {
  walk: string;           // Clip name (speed < thresholds[0])
  jog: string;            // Clip name (thresholds[0] < speed < thresholds[1])
  sprint: string;         // Clip name (speed > thresholds[1])
  thresholds: [number, number]; // [walkToJog, jogToSprint] in m/s
}

interface SpeedSwitch {
  idle: string;    // Clip when speed ≈ 0
  moving: string;  // Clip when speed > 0.1 m/s
}

interface AnimationProfile {
  id: string;
  modelUrl: string;                              // GLB with the character mesh
  animationUrls: string[];                       // GLBs to pull animation clips from
  stateMap: Partial<Record<StateId, ClipDef>>;   // FSM state → clip mapping
  locomotion?: LocomotionBlend;                  // Speed-based blend for 'move' state
  crouchLocomotion?: SpeedSwitch;                // Speed-switch for 'crouch' state
  carryLocomotion?: SpeedSwitch;                 // Speed-switch for 'carry' state
  fallbacks?: Partial<Record<StateId, StateId>>; // Fallback chain for missing clips
}
```

### Player profile

```typescript
const PLAYER_PROFILE: AnimationProfile = {
  id: 'ual-mannequin-player',
  modelUrl: './assets/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
  animationUrls: [
    './assets/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
    './assets/models/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb',
  ],
  stateMap: {
    idle:     { clip: 'Idle_Loop',        loop: true },
    jump:     { clip: 'Jump_Start',       loop: false },
    air:      { clip: 'Jump_Loop',        loop: true },
    land:     { clip: 'Jump_Land',        loop: false },
    crouch:   { clip: 'Crouch_Idle_Loop', loop: true },
    interact: { clip: 'Interact',         loop: false },
    grab:     { clip: 'Push_Loop',        loop: true },
    carry:    { clip: 'Idle_Loop',        loop: true },  // Carry uses idle; see crouchLocomotion note
  },
  locomotion: {
    walk: 'Walk_Loop',
    jog: 'Jog_Fwd_Loop',
    sprint: 'Sprint_Loop',
    thresholds: [2.5, 5.5],
  },
  crouchLocomotion: {
    idle: 'Crouch_Idle_Loop',
    moving: 'Crouch_Fwd_Loop',
  },
  carryLocomotion: {
    idle: 'Idle_Loop',
    moving: 'Walk_Carry_Loop',
  },
  fallbacks: {
    airJump: 'jump',
    land: 'idle',
  },
};
```

### NPC profile

```typescript
const NPC_PROFILE: AnimationProfile = {
  id: 'ual-mannequin-npc',
  modelUrl: './assets/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
  animationUrls: [
    './assets/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
  ],
  stateMap: {
    idle: { clip: 'Idle_Loop',         loop: true },
    move: { clip: 'Walk_Loop',         loop: true },
  },
  // No locomotion blend — NPCs walk at fixed speed
};
```

---

## Runtime Layer: CharacterModel

**File**: `src/character/animation/CharacterModel.ts`

### Responsibilities

1. Load model GLB via `AssetLoader`, clone skeleton with `SkeletonUtils`
2. Load additional animation GLBs, collect all clips into a `Map<string, THREE.AnimationClip>`
3. Strip root motion (X/Z translation) from all clips to prevent mesh drift from physics capsule
4. Attach model under the parent `THREE.Object3D`, hide the capsule mesh
5. Enable shadow casting/receiving on all meshes
6. Provide `tint(color: THREE.Color)` for NPC color differentiation — uses `material.color.lerp(tintColor, 0.6)` to blend toward the tint rather than multiply. This avoids the darkening problem of pure multiplication while still giving a clear color identity. Complement with a subtle `material.emissive` set to the tint at 0.08 intensity for visibility in dark areas.
7. Provide `dispose()` for GPU resource cleanup

### API

```typescript
class CharacterModel implements Disposable {
  readonly root: THREE.Object3D;
  readonly clips: Map<string, THREE.AnimationClip>;

  static async load(
    profile: AnimationProfile,
    parent: THREE.Object3D,
    loader: AssetLoader,
  ): Promise<CharacterModel>;

  tint(color: THREE.Color): void;
  dispose(): void;
}
```

### Root motion stripping

Preserved from existing `CharacterVisual.ts` — zero X/Z translation on the root bone's position tracks, keep Y for crouches/jumps. Applied to all clips from all loaded GLBs.

**Important**: Root motion stripping mutates `track.values` in-place. Since `AssetLoader` caches GLTFs and shares the `animations` array reference across clones, we must **clone clips before stripping** to avoid corrupting the cache. Use `clip.clone()` before zeroing values.

### Multi-GLB clip merging

When `animationUrls` contains multiple entries:
1. Load each GLB
2. Extract `gltf.animations` from each, **cloning each clip** to avoid cache mutation
3. If clip names collide, first-loaded wins (UAL1 takes priority over UAL2)
4. All clips stored in the shared `clips` map

### AssetLoader usage

`CharacterModel.load()` accepts an `AssetLoader` instance as a parameter (not creating its own). The caller provides it — `PlayerController` passes the game's shared `AssetLoader`, and `NavAgent` does the same. This ensures the GLB cache is shared across all character instances, preventing duplicate 7.8MB loads.

---

## Runtime Layer: AnimationController

**File**: `src/character/animation/AnimationController.ts`

### Responsibilities

1. Create `THREE.AnimationMixer` on the model root
2. Build action map from profile's `stateMap` (exact clip name lookup from `CharacterModel.clips`)
3. Manage locomotion blend system for the `move` state
4. Handle state transitions with smooth crossfades
5. Sync animation speed with character velocity

### Locomotion blend system

When the FSM state is `move` and the profile has a `locomotion` config, three actions are active simultaneously with weight-based blending:

```
speed < thresholds[0]:  walk=1, jog=0, sprint=0
speed = thresholds[0]:  walk=0.5, jog=0.5, sprint=0
speed between:          interpolate jog weight
speed = thresholds[1]:  walk=0, jog=0.5, sprint=0.5
speed > thresholds[1]:  walk=0, jog=0, sprint=1
```

Weight transitions use exponential decay (~0.15s response time) for smooth blending. Each locomotion clip's `timeScale` is also adjusted to match foot speed to actual velocity.

### Crossfade timing

- Locomotion transitions (idle↔move, walk↔jog↔sprint): **0.15s** fade for natural gait transitions
- Action states (jump, interact, grab): **0.1s** fade for snappy responsiveness
- Landing: **0.08s** fade-in for immediate ground contact feel

### Crossfade implementation note

**Locomotion blending must NOT use Three.js's built-in `crossFadeTo()`/`crossFadeFrom()` API.** Those APIs manage weights internally and will conflict with our manual weight control. Instead:
- For locomotion (walk/jog/sprint): use `action.setEffectiveWeight()` directly each frame
- For state transitions (idle→move, move→jump, etc.): use manual `fadeOut()`/`fadeIn()` on individual actions

### Idempotency

`setState()` is called every render frame. If the requested state has not changed since the last call, it is a **no-op** — no crossfade restart, no weight reset. The controller tracks the current state internally and early-returns on duplicate calls.

### Move state without locomotion config

When `setState('move')` is called and the profile has **no `locomotion` config**, the controller falls back to `stateMap.move` and plays that single clip directly. This is the NPC path — simple walk animation without blending.

### Crouch and carry speed-switching

For `crouch` and `carry` states, if the profile provides `crouchLocomotion` or `carryLocomotion` (a `SpeedSwitch`), the controller checks `setSpeed()` value:
- Speed ≤ 0.1 m/s → play the `idle` clip
- Speed > 0.1 m/s → play the `moving` clip

This prevents crouch-sliding (idle animation while moving) and carry-walking-in-place (walk animation while standing still). Transitions use the same 0.15s crossfade as locomotion.

### Fallback chain

When `setState(stateId)` is called and no clip exists for that state:
1. Check `profile.fallbacks[stateId]` → try that state's clip
2. If still missing → fall back to `idle`
3. If idle is missing → do nothing (no-op)

### Disposal

`dispose()` calls `mixer.stopAllAction()` and `mixer.uncacheRoot(root)` before nulling references. This prevents Three.js from holding internal references to disposed objects.

### API

```typescript
class AnimationController implements Disposable {
  constructor(
    model: CharacterModel,
    profile: AnimationProfile,
  );

  setState(state: StateId): void;
  setSpeed(horizontalSpeed: number): void;
  isClipFinished(): boolean;  // True if current one-shot clip has completed
  update(dt: number): void;
  dispose(): void;
}
```

---

## Factory: CharacterFactory

**File**: `src/character/animation/CharacterFactory.ts`

Stateless factory function:

```typescript
interface CharacterCreateOptions {
  tint?: THREE.Color;
}

async function createAnimatedCharacter(
  profile: AnimationProfile,
  parent: THREE.Object3D,
  loader: AssetLoader,
  options?: CharacterCreateOptions,
): Promise<{ model: CharacterModel; animator: AnimationController }> {
  const model = await CharacterModel.load(profile, parent, loader);
  if (options?.tint) model.tint(options.tint);
  const animator = new AnimationController(model, profile);
  return { model, animator };
}
```

---

## New FSM State: LandState

**File**: `src/character/states/LandState.ts`

### Behavior

- **Enter**: Triggered when landing with impact speed > 2 m/s. Starts a fixed timer (0.4s).
- **During**: Plays `Jump_Land` animation (one-shot). Timer counts down each `update(dt)`.
- **Exit**: Auto-transitions when **either** the timer expires **or** `AnimationController.isClipFinished()` returns true. The timer is a safety net — if the clip is missing or fallback fires, the state still exits after 0.4s. Jump input can interrupt at any time for responsive feel.

### Clip completion detection

`AnimationController` exposes `isClipFinished(): boolean` which checks if the current action's `time >= clip.duration` for `LoopOnce` clips. `LandState` reads this via the player controller reference. The 0.4s timer is a hard ceiling that prevents getting stuck if the animation system fails.

### Transition rules

```
AirState + isGrounded + impactSpeed > 2.0 → LandState
AirState + isGrounded + impactSpeed ≤ 2.0 → IdleState/MoveState (skip land)
LandState + jumpPressed → JumpState (interrupt land)
LandState + (timer expired OR clipFinished) + hasMovementInput → MoveState
LandState + (timer expired OR clipFinished) + noInput → IdleState
```

### Registration

- Add `land: 'land'` to `STATE` const in `types.ts`
- Register `new LandState(player)` in `CharacterFSM` constructor
- Modify `AirState.handleInput()` to check impact speed and return `STATE.land` when appropriate

### Impact speed access

`AirState` needs the landing impact speed. This is already available as `prevVerticalVelocity` on the `PlayerController` when transitioning from air to grounded. The `AirState` has a reference to the player controller and can read it directly.

---

## NPC Integration: NavAgent Upgrade

**File**: `src/navigation/NavAgent.ts` (modified)

### Changes

1. Replace capsule geometry with `CharacterModel` loaded via `createAnimatedCharacter(NPC_PROFILE, ...)`
2. Constructor remains synchronous — creates a capsule placeholder mesh immediately
3. New `async init(loader: AssetLoader)` method loads the animated model and hides the capsule once ready. Callers must `await agent.init(loader)` after construction. The agent works (moves, patrols) even before init completes — it just shows a capsule.
4. Accept a `tint` color parameter in constructor
5. Add `AnimationController` that drives idle/walk:
   - Agent velocity > 0.1 m/s → `setState('move')`
   - Agent velocity ≤ 0.1 m/s → `setState('idle')`
4. Add `rotateToward()` for facing movement direction
5. Call `animator.update(dt)` each frame
6. The `updatePosition()` method also computes velocity from position delta for animation state decisions

### Color palette

```typescript
const NPC_COLORS = {
  friendly: new THREE.Color(0x4488cc),  // Cool blue
  neutral:  new THREE.Color(0x88cc44),  // Green
  hostile:  new THREE.Color(0xcc4444),  // Warm red
} as const;
```

Colors multiply the mannequin's base albedo for a natural tinted look.

---

## Integration: PlayerController Changes

### Constructor

```diff
- this.characterVisual = new CharacterVisual(this.mesh);
- void this.characterVisual.init();
+ void this.initCharacter();
```

New async method:
```typescript
private async initCharacter(): Promise<void> {
  try {
    const { model, animator } = await createAnimatedCharacter(PLAYER_PROFILE, this.mesh);
    this.characterModel = model;
    this.animator = animator;
  } catch (err) {
    console.warn('[PlayerController] Character load failed, using capsule fallback:', err);
  }
}
```

### update()

```diff
- this.characterVisual?.setMovementSpeed(this.cachedHorizontalSpeed);
- this.characterVisual?.setState(this.fsm.current);
- this.characterVisual?.update(_dt);
+ this.animator?.setSpeed(this.cachedHorizontalSpeed);
+ this.animator?.setState(this.fsm.current);
+ this.animator?.update(_dt);
```

### dispose()

```diff
- this.characterVisual?.dispose();
+ this.animator?.dispose();
+ this.characterModel?.dispose();
```

---

## File Summary

### New files
| File | Purpose |
|------|---------|
| `src/character/animation/AnimationProfile.ts` | Type definitions for animation profiles |
| `src/character/animation/CharacterModel.ts` | Model loading, skeleton cloning, tinting |
| `src/character/animation/AnimationController.ts` | Mixer, locomotion blending, state transitions |
| `src/character/animation/CharacterFactory.ts` | Factory function for creating animated characters |
| `src/character/animation/profiles.ts` | PLAYER_PROFILE and NPC_PROFILE constants |
| `src/character/states/LandState.ts` | Landing state for FSM |

### Modified files
| File | Change |
|------|--------|
| `src/core/types.ts` | Add `land: 'land'` to STATE |
| `src/character/PlayerController.ts` | Replace CharacterVisual with CharacterModel + AnimationController |
| `src/character/CharacterFSM.ts` | Register LandState |
| `src/character/states/AirState.ts` | Route to LandState on high-impact landings |
| `src/navigation/NavAgent.ts` | Upgrade from capsule to animated model |

### Deleted files
| File | Reason |
|------|--------|
| `src/character/CharacterVisual.ts` | Fully replaced by new animation system |

---

## Pre-Implementation: Clip Name Verification (Task 0)

Before any code is written, load both UAL GLBs and log all animation clip names. This is critical because the entire profile system depends on exact string matches. Run a quick script or add a temporary log in the existing loader to print `gltf.animations.map(c => c.name)` for both files. Update `profiles.ts` with verified names.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| UAL clip names don't match expected strings | Task 0: verify exact clip names before hardcoding profiles |
| Multi-GLB loading increases initial load time | Both GLBs cached by shared AssetLoader; NPC profile only loads UAL1 |
| Mannequin model scale/offset doesn't match capsule | CharacterModel.load() measures model bounding box, auto-scales so height matches capsule total height (2 × halfHeight + 2 × radius), and offsets Y so feet align with capsule bottom |
| Root motion stripping removes needed Y motion | Only strip X/Z, preserve Y (existing proven approach) |
| Root motion stripping corrupts AssetLoader cache | Clone clips before stripping (see CharacterModel section) |
| Locomotion blend weights cause foot sliding | TimeScale per-clip adjusted to match authored walk speed to actual velocity |
| NavAgent loads async but constructor is sync | Capsule placeholder shown until init() completes; agent functional either way |

---

## Out of Scope

- Combat animations (sword, pistol, spells) — available in UAL but no combat system yet
- Facial animation / blend shapes
- IK (inverse kinematics) for foot placement or hand targeting
- Ragdoll on death
- Animation events / notifies (footstep sounds, VFX triggers)
- Female mannequin variant (same rig, can be added as alternate profile later)
