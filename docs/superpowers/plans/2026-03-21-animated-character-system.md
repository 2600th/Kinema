# Animated Character System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace capsule characters with animated UAL mannequin models using data-driven animation profiles, speed-based locomotion blending, and NPC color tinting.

**Architecture:** Data-driven `AnimationProfile` defines model URL + clip mappings. `CharacterModel` handles loading/skeleton/tinting. `AnimationController` manages mixer/blending/state transitions. `CharacterFactory` wires them together for both player and NPCs.

**Tech Stack:** Three.js (WebGPU), Rapier physics, TypeScript strict, Vite, GLB/GLTF

**Spec:** `docs/superpowers/specs/2026-03-21-animated-character-system-design.md`

---

## Verified Data

**UAL1 clip names** (45 clips, `public/assets/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb`):
`A_TPose`, `Crouch_Fwd_Loop`, `Crouch_Idle_Loop`, `Dance_Loop`, `Death01`, `Driving_Loop`, `Fixing_Kneeling`, `Hit_Chest`, `Hit_Head`, `Idle_Loop`, `Idle_Talking_Loop`, `Idle_Torch_Loop`, `Interact`, `Jog_Fwd_Loop`, `Jump_Land`, `Jump_Loop`, `Jump_Start`, `PickUp_Table`, `Pistol_Aim_Down`, `Pistol_Aim_Neutral`, `Pistol_Aim_Up`, `Pistol_Idle_Loop`, `Pistol_Reload`, `Pistol_Shoot`, `Punch_Cross`, `Punch_Jab`, `Push_Loop`, `Roll`, `Roll_RM`, `Sitting_Enter`, `Sitting_Exit`, `Sitting_Idle_Loop`, `Sitting_Talking_Loop`, `Spell_Simple_Enter`, `Spell_Simple_Exit`, `Spell_Simple_Idle_Loop`, `Spell_Simple_Shoot`, `Sprint_Loop`, `Swim_Fwd_Loop`, `Swim_Idle_Loop`, `Sword_Attack`, `Sword_Attack_RM`, `Sword_Idle`, `Walk_Formal_Loop`, `Walk_Loop`

**UAL2 clip names** (43 clips, `public/assets/models/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb`):
`A_TPose`, `Chest_Open`, `ClimbUp_1m_RM`, `Consume`, `Farm_Harvest`, `Farm_PlantSeed`, `Farm_Watering`, `Hit_Knockback`, `Hit_Knockback_RM`, `Idle_FoldArms_Loop`, `Idle_Lantern_Loop`, `Idle_No_Loop`, `Idle_Rail_Call`, `Idle_Rail_Loop`, `Idle_Shield_Break`, `Idle_Shield_Loop`, `Idle_TalkingPhone_Loop`, `LayToIdle`, `Melee_Hook`, `Melee_Hook_Rec`, `NinjaJump_Idle_Loop`, `NinjaJump_Land`, `NinjaJump_Start`, `OverhandThrow`, `Shield_Dash_RM`, `Shield_OneShot`, `Slide_Exit`, `Slide_Loop`, `Slide_Start`, `Sword_Block`, `Sword_Dash_RM`, `Sword_Regular_A`, `Sword_Regular_A_Rec`, `Sword_Regular_B`, `Sword_Regular_B_Rec`, `Sword_Regular_C`, `Sword_Regular_Combo`, `TreeChopping_Loop`, `Walk_Carry_Loop`, `Yes`, `Zombie_Idle_Loop`, `Zombie_Scratch`, `Zombie_Walk_Fwd_Loop`

**Model dimensions** (UAL1 mannequin bounding box):
- Y: 0.0 → 1.83m (height ≈ 1.83m)
- Capsule total height: 2×(0.35+0.3) = 1.3m → **scale factor ≈ 0.71**
- Root bone (`root`) has -90° X rotation (Unreal Y-up → Three.js Y-up)
- Scene root: `Armature` node, child `root` bone, child `Mannequin` mesh

**Key project patterns:**
- `LevelManager.getAssetLoader()` returns the shared `AssetLoader` instance
- Path alias: `@character/*` → `src/character/*`, `@core/*` → `src/core/*`, `@level/*` → `src/level/*`
- States extend `State` base class, have `id`, `enter()`, `exit()`, `handleInput()`, `update()`, `getDesiredMovement()`
- `PlayerController` is constructed in `main.ts`, receives `PhysicsWorld`, `Scene`, `EventBus`
- `CharacterVisual` creates its own `new AssetLoader()` (to be removed)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/character/animation/AnimationProfile.ts` | Type definitions: `ClipDef`, `LocomotionBlend`, `SpeedSwitch`, `AnimationProfile` |
| `src/character/animation/profiles.ts` | `PLAYER_PROFILE` and `NPC_PROFILE` constants |
| `src/character/animation/CharacterModel.ts` | Model loading, clip merging, root motion stripping, tinting, disposal |
| `src/character/animation/AnimationController.ts` | AnimationMixer management, locomotion blending, state transitions, speed sync |
| `src/character/animation/CharacterFactory.ts` | `createAnimatedCharacter()` factory function |
| `src/character/states/LandState.ts` | Landing FSM state with timer-based exit |

### Modified files
| File | Change |
|------|--------|
| `src/core/types.ts` | Add `land: 'land'` to `STATE` const |
| `src/character/CharacterFSM.ts` | Import + register `LandState` |
| `src/character/states/AirState.ts` | Route to `STATE.land` on high-impact landings |
| `src/character/PlayerController.ts` | Replace `CharacterVisual` with `CharacterModel` + `AnimationController` via factory |
| `src/navigation/NavAgent.ts` | Upgrade from capsule to animated model with `init()` |

### Deleted files
| File | Reason |
|------|--------|
| `src/character/CharacterVisual.ts` | Fully replaced by new animation system |

---

## Chunk 1: Data Layer + CharacterModel

### Task 1: AnimationProfile types

**Files:**
- Create: `src/character/animation/AnimationProfile.ts`

- [ ] **Step 1: Create AnimationProfile.ts with all type definitions**

```typescript
// src/character/animation/AnimationProfile.ts
import type { StateId } from '@core/types';

/** Single animation clip binding. */
export interface ClipDef {
  /** Exact clip name in the GLB (e.g. "Jog_Fwd_Loop"). */
  clip: string;
  /** true = LoopRepeat, false = LoopOnce + clampWhenFinished. */
  loop: boolean;
  /** Playback speed multiplier. Default 1.0. */
  timeScale?: number;
}

/** Three-tier speed-based locomotion blend for the 'move' state. */
export interface LocomotionBlend {
  walk: string;
  jog: string;
  sprint: string;
  /** [walkToJog, jogToSprint] transition thresholds in m/s. */
  thresholds: [number, number];
}

/** Binary speed switch: idle clip when stationary, moving clip when speed > 0.1 m/s. */
export interface SpeedSwitch {
  idle: string;
  moving: string;
}

/** Data-driven animation configuration for a character. */
export interface AnimationProfile {
  id: string;
  /** URL to the GLB containing the character mesh. */
  modelUrl: string;
  /** URLs to GLBs to extract animation clips from (can include modelUrl). */
  animationUrls: string[];
  /** FSM state → clip definition. */
  stateMap: Partial<Record<StateId, ClipDef>>;
  /** Speed-based walk/jog/sprint blend for the 'move' state. */
  locomotion?: LocomotionBlend;
  /** Speed-switch for crouch state (idle vs forward). */
  crouchLocomotion?: SpeedSwitch;
  /** Speed-switch for carry state (idle vs walk-carry). */
  carryLocomotion?: SpeedSwitch;
  /** Fallback chain: if state clip missing, try fallback state's clip. */
  fallbacks?: Partial<Record<StateId, StateId>>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/character/animation/AnimationProfile.ts
git commit -m "feat(animation): add AnimationProfile type definitions"
```

---

### Task 2: Profile constants

**Files:**
- Create: `src/character/animation/profiles.ts`

- [ ] **Step 1: Create profiles.ts with PLAYER_PROFILE and NPC_PROFILE**

```typescript
// src/character/animation/profiles.ts
import type { AnimationProfile } from './AnimationProfile';

const UAL1_URL = './assets/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const UAL2_URL = './assets/models/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';

export const PLAYER_PROFILE: AnimationProfile = {
  id: 'ual-mannequin-player',
  modelUrl: UAL1_URL,
  animationUrls: [UAL1_URL, UAL2_URL],
  stateMap: {
    idle:     { clip: 'Idle_Loop',        loop: true },
    jump:     { clip: 'Jump_Start',       loop: false },
    air:      { clip: 'Jump_Loop',        loop: true },
    land:     { clip: 'Jump_Land',        loop: false },
    crouch:   { clip: 'Crouch_Idle_Loop', loop: true },
    interact: { clip: 'Interact',         loop: false },
    grab:     { clip: 'Push_Loop',        loop: true },
    carry:    { clip: 'Idle_Loop',        loop: true },
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
    airJump: 'jump' as any,
    land: 'idle' as any,
  },
};

export const NPC_PROFILE: AnimationProfile = {
  id: 'ual-mannequin-npc',
  modelUrl: UAL1_URL,
  animationUrls: [UAL1_URL],
  stateMap: {
    idle: { clip: 'Idle_Loop',  loop: true },
    move: { clip: 'Walk_Loop',  loop: true },
  },
};
```

Note: The `fallbacks` values are `StateId` strings cast via `as any` because the profile type expects `StateId` but the literal strings satisfy the constraint at runtime. If the types module uses `as const`, these will type-check directly.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/character/animation/profiles.ts
git commit -m "feat(animation): add player and NPC animation profiles"
```

---

### Task 3: CharacterModel

**Files:**
- Create: `src/character/animation/CharacterModel.ts`

**Key implementation details:**
- Uses shared `AssetLoader` (passed as parameter)
- Clones clips before root motion stripping to avoid cache corruption
- Strips root-motion X/Z from root bone position tracks (keep Y)
- Auto-scales model to match capsule height
- Hides capsule mesh when model loads
- `tint()` uses `color.lerp(tint, 0.6)` + subtle emissive

- [ ] **Step 1: Create CharacterModel.ts**

```typescript
// src/character/animation/CharacterModel.ts
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import type { AssetLoader } from '@level/AssetLoader';
import type { Disposable } from '@core/types';
import type { AnimationProfile } from './AnimationProfile';

export class CharacterModel implements Disposable {
  readonly root: THREE.Object3D;
  readonly clips: Map<string, THREE.AnimationClip>;

  private constructor(root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.root = root;
    this.clips = clips;
  }

  static async load(
    profile: AnimationProfile,
    parent: THREE.Object3D,
    loader: AssetLoader,
  ): Promise<CharacterModel> {
    // 1. Load model GLB
    const modelGltf = await loader.load(profile.modelUrl);
    const root = skeletonClone(modelGltf.scene) as THREE.Group;
    root.name = 'CharacterModel';

    // 2. Enable shadows
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    // 3. Scale model to match capsule height
    // Capsule total height = 2*(halfHeight + radius) = 1.3m
    // Model height from bounding box
    const box = new THREE.Box3().setFromObject(root);
    const modelHeight = box.max.y - box.min.y;
    if (modelHeight > 0) {
      const capsuleHeight = 1.3; // 2 * (0.35 + 0.3)
      const scale = capsuleHeight / modelHeight;
      root.scale.setScalar(scale);
    }

    // 4. Offset model so feet align with capsule bottom
    // After scaling, recompute bounding box
    const scaledBox = new THREE.Box3().setFromObject(root);
    // Capsule mesh is centered at (0,0,0) in parent group
    // Capsule bottom is at -halfHeight - radius = -0.65
    const capsuleBottom = -0.65;
    root.position.y = capsuleBottom - scaledBox.min.y;

    // 5. Attach to parent, hide capsule
    parent.add(root);
    const capsule = parent.getObjectByName('PlayerCapsule');
    if (capsule) capsule.visible = false;

    // 6. Collect clips from all animation URLs (clone to avoid cache mutation)
    const clips = new Map<string, THREE.AnimationClip>();

    // First, add clips from the model GLTF itself
    for (const clip of modelGltf.animations ?? []) {
      if (!clips.has(clip.name)) {
        clips.set(clip.name, clip.clone());
      }
    }

    // Then load additional animation GLBs
    for (const url of profile.animationUrls) {
      if (url === profile.modelUrl) continue; // Already processed
      try {
        const animGltf = await loader.load(url);
        for (const clip of animGltf.animations ?? []) {
          if (!clips.has(clip.name)) {
            clips.set(clip.name, clip.clone());
          }
        }
      } catch (err) {
        console.warn(`[CharacterModel] Failed to load animation GLB: ${url}`, err);
      }
    }

    // 7. Strip root motion (X/Z) from all clips
    const rootBoneName = CharacterModel.findRootBoneName(root);
    for (const clip of clips.values()) {
      CharacterModel.stripRootMotion(clip, rootBoneName);
    }

    return new CharacterModel(root, clips);
  }

  /** Tint all materials by blending toward the given color. */
  tint(color: THREE.Color): void {
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.color.lerp(color, 0.6);
            mat.emissive.copy(color);
            mat.emissiveIntensity = 0.08;
          }
        }
      }
    });
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.map?.dispose();
            mat.normalMap?.dispose();
            mat.roughnessMap?.dispose();
            mat.metalnessMap?.dispose();
            mat.aoMap?.dispose();
            mat.emissiveMap?.dispose();
            mat.alphaMap?.dispose();
            mat.envMap?.dispose();
          }
          mat.dispose();
        }
      }
    });
    // Re-show capsule if parent still exists
    const parent = this.root.parent;
    if (parent) {
      const capsule = parent.getObjectByName('PlayerCapsule');
      if (capsule) capsule.visible = true;
    }
  }

  private static findRootBoneName(root: THREE.Object3D): string {
    let boneName = '';
    root.traverse((node) => {
      if (!boneName && (node as THREE.Bone).isBone) {
        boneName = node.name;
      }
    });
    return boneName || 'root';
  }

  private static stripRootMotion(clip: THREE.AnimationClip, rootBoneName: string): void {
    for (const track of clip.tracks) {
      if (track.name.endsWith('.position') && track.name.includes(rootBoneName)) {
        const values = track.values;
        for (let i = 0; i < values.length; i += 3) {
          values[i] = 0;     // X
          values[i + 2] = 0; // Z
        }
      }
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/character/animation/CharacterModel.ts
git commit -m "feat(animation): add CharacterModel — loading, clip merging, tinting"
```

---

## Chunk 2: AnimationController + Factory

### Task 4: AnimationController

**Files:**
- Create: `src/character/animation/AnimationController.ts`

**Key implementation details:**
- Locomotion blend: 3 simultaneous actions with manual `setEffectiveWeight()` — do NOT use Three.js `crossFadeTo()`
- State transitions: manual `fadeOut()`/`fadeIn()` for non-locomotion states
- `setState()` is idempotent (no-op on duplicate calls)
- `setSpeed()` updates locomotion weights + timeScale
- `isClipFinished()` for LandState timer cooperation
- `dispose()` calls `mixer.stopAllAction()` and `mixer.uncacheRoot()`

- [ ] **Step 1: Create AnimationController.ts**

```typescript
// src/character/animation/AnimationController.ts
import * as THREE from 'three';
import type { Disposable, StateId } from '@core/types';
import { STATE } from '@core/types';
import type { AnimationProfile } from './AnimationProfile';
import type { CharacterModel } from './CharacterModel';

/** Crossfade durations in seconds. */
const FADE_LOCOMOTION = 0.15;
const FADE_ACTION = 0.1;
const FADE_LAND = 0.08;

/** Speed at which walk animation was authored (m/s). */
const WALK_AUTHORED_SPEED = 1.5;
const JOG_AUTHORED_SPEED = 3.5;
const SPRINT_AUTHORED_SPEED = 6.5;

/** Weight interpolation rate (exponential decay lambda). */
const WEIGHT_LAMBDA = 8;

/** Threshold below which speed is considered "stationary" for speed-switch. */
const SPEED_SWITCH_THRESHOLD = 0.1;

export class AnimationController implements Disposable {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentState: StateId | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private speed = 0;

  // Locomotion blend state
  private locoWalk: THREE.AnimationAction | null = null;
  private locoJog: THREE.AnimationAction | null = null;
  private locoSprint: THREE.AnimationAction | null = null;
  private locoWeights = { walk: 0, jog: 0, sprint: 0 };
  private locoTargetWeights = { walk: 0, jog: 0, sprint: 0 };
  private locoActive = false;

  // Speed-switch state for crouch/carry
  private crouchIdleAction: THREE.AnimationAction | null = null;
  private crouchMoveAction: THREE.AnimationAction | null = null;
  private carryIdleAction: THREE.AnimationAction | null = null;
  private carryMoveAction: THREE.AnimationAction | null = null;

  constructor(
    private model: CharacterModel,
    private profile: AnimationProfile,
  ) {
    this.mixer = new THREE.AnimationMixer(model.root);
    this.buildActions();
    // Start idle
    this.setState(STATE.idle);
  }

  private buildActions(): void {
    const { stateMap, locomotion, crouchLocomotion, carryLocomotion } = this.profile;
    const clips = this.model.clips;

    // Build state actions
    for (const [stateId, clipDef] of Object.entries(stateMap)) {
      const clip = clips.get(clipDef!.clip);
      if (!clip) {
        console.warn(`[AnimationController] Clip "${clipDef!.clip}" not found for state "${stateId}"`);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.loop = clipDef!.loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.clampWhenFinished = !clipDef!.loop;
      if (clipDef!.timeScale != null) action.timeScale = clipDef!.timeScale;
      // Pre-play at weight 0
      action.weight = 0;
      action.play();
      this.actions.set(stateId, action);
    }

    // Build locomotion blend actions
    if (locomotion) {
      this.locoWalk = this.createLocoAction(locomotion.walk);
      this.locoJog = this.createLocoAction(locomotion.jog);
      this.locoSprint = this.createLocoAction(locomotion.sprint);
    }

    // Build speed-switch actions for crouch
    if (crouchLocomotion) {
      this.crouchIdleAction = this.createLocoAction(crouchLocomotion.idle);
      this.crouchMoveAction = this.createLocoAction(crouchLocomotion.moving);
    }

    // Build speed-switch actions for carry
    if (carryLocomotion) {
      this.carryIdleAction = this.createLocoAction(carryLocomotion.idle);
      this.carryMoveAction = this.createLocoAction(carryLocomotion.moving);
    }
  }

  private createLocoAction(clipName: string): THREE.AnimationAction | null {
    const clip = this.model.clips.get(clipName);
    if (!clip) {
      console.warn(`[AnimationController] Locomotion clip "${clipName}" not found`);
      return null;
    }
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.loop = THREE.LoopRepeat;
    action.weight = 0;
    action.play();
    return action;
  }

  setState(state: StateId): void {
    if (state === this.currentState) return;

    const prevState = this.currentState;
    this.currentState = state;

    // Determine fade duration
    const fadeDuration = state === STATE.land ? FADE_LAND
      : (state === STATE.move || state === STATE.idle) ? FADE_LOCOMOTION
      : FADE_ACTION;

    // Deactivate locomotion blend if leaving move state
    if (prevState === STATE.move && state !== STATE.move) {
      this.deactivateLocomotion(fadeDuration);
    }

    // Deactivate speed-switch if leaving crouch/carry
    if (prevState === STATE.crouch && state !== STATE.crouch) {
      this.deactivateSpeedSwitch(this.crouchIdleAction, this.crouchMoveAction, fadeDuration);
    }
    if (prevState === STATE.carry && state !== STATE.carry) {
      this.deactivateSpeedSwitch(this.carryIdleAction, this.carryMoveAction, fadeDuration);
    }

    // Activate locomotion blend if entering move state
    if (state === STATE.move && this.profile.locomotion) {
      this.activateLocomotion(fadeDuration);
      // Fade out previous non-locomotion action
      if (this.currentAction) {
        this.currentAction.fadeOut(fadeDuration);
        this.currentAction = null;
      }
      return;
    }

    // Activate speed-switch for crouch
    if (state === STATE.crouch && this.profile.crouchLocomotion) {
      this.activateSpeedSwitch(this.crouchIdleAction, this.crouchMoveAction, fadeDuration);
      if (this.currentAction) {
        this.currentAction.fadeOut(fadeDuration);
        this.currentAction = null;
      }
      return;
    }

    // Activate speed-switch for carry
    if (state === STATE.carry && this.profile.carryLocomotion) {
      this.activateSpeedSwitch(this.carryIdleAction, this.carryMoveAction, fadeDuration);
      if (this.currentAction) {
        this.currentAction.fadeOut(fadeDuration);
        this.currentAction = null;
      }
      return;
    }

    // Standard state transition
    const nextAction = this.resolveAction(state);
    if (!nextAction) return;

    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.fadeOut(fadeDuration);
    }
    nextAction.reset().fadeIn(fadeDuration).play();
    this.currentAction = nextAction;
  }

  setSpeed(horizontalSpeed: number): void {
    this.speed = horizontalSpeed;

    // Update locomotion blend weights
    if (this.locoActive && this.profile.locomotion) {
      const [t0, t1] = this.profile.locomotion.thresholds;
      if (horizontalSpeed <= t0) {
        this.locoTargetWeights.walk = 1;
        this.locoTargetWeights.jog = 0;
        this.locoTargetWeights.sprint = 0;
      } else if (horizontalSpeed <= t1) {
        const t = (horizontalSpeed - t0) / (t1 - t0);
        this.locoTargetWeights.walk = 1 - t;
        this.locoTargetWeights.jog = t;
        this.locoTargetWeights.sprint = 0;
      } else {
        this.locoTargetWeights.walk = 0;
        this.locoTargetWeights.jog = 0;
        this.locoTargetWeights.sprint = 1;
      }

      // Adjust timeScales to sync foot speed
      if (this.locoWalk) this.locoWalk.timeScale = Math.max(0.1, horizontalSpeed / WALK_AUTHORED_SPEED);
      if (this.locoJog) this.locoJog.timeScale = Math.max(0.1, horizontalSpeed / JOG_AUTHORED_SPEED);
      if (this.locoSprint) this.locoSprint.timeScale = Math.max(0.1, horizontalSpeed / SPRINT_AUTHORED_SPEED);
    }

    // Update speed-switch for crouch
    if (this.currentState === STATE.crouch && this.crouchIdleAction && this.crouchMoveAction) {
      this.updateSpeedSwitch(this.crouchIdleAction, this.crouchMoveAction, horizontalSpeed);
    }

    // Update speed-switch for carry
    if (this.currentState === STATE.carry && this.carryIdleAction && this.carryMoveAction) {
      this.updateSpeedSwitch(this.carryIdleAction, this.carryMoveAction, horizontalSpeed);
    }
  }

  /** Returns true if current action is a one-shot clip that has finished playing. */
  isClipFinished(): boolean {
    if (!this.currentAction) return false;
    if (this.currentAction.loop !== THREE.LoopOnce) return false;
    const clip = this.currentAction.getClip();
    return this.currentAction.time >= clip.duration;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    // Smoothly interpolate locomotion weights
    if (this.locoActive) {
      const factor = 1 - Math.exp(-WEIGHT_LAMBDA * dt);
      this.locoWeights.walk += (this.locoTargetWeights.walk - this.locoWeights.walk) * factor;
      this.locoWeights.jog += (this.locoTargetWeights.jog - this.locoWeights.jog) * factor;
      this.locoWeights.sprint += (this.locoTargetWeights.sprint - this.locoWeights.sprint) * factor;

      if (this.locoWalk) this.locoWalk.setEffectiveWeight(this.locoWeights.walk);
      if (this.locoJog) this.locoJog.setEffectiveWeight(this.locoWeights.jog);
      if (this.locoSprint) this.locoSprint.setEffectiveWeight(this.locoWeights.sprint);
    }

    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model.root);
    this.actions.clear();
    this.currentAction = null;
    this.locoWalk = null;
    this.locoJog = null;
    this.locoSprint = null;
  }

  // --- Private helpers ---

  private resolveAction(state: StateId): THREE.AnimationAction | null {
    // Direct lookup
    const direct = this.actions.get(state);
    if (direct) return direct;

    // Fallback chain
    const fallback = this.profile.fallbacks?.[state];
    if (fallback) {
      const fallbackAction = this.actions.get(fallback);
      if (fallbackAction) return fallbackAction;
    }

    // Ultimate fallback: idle
    return this.actions.get(STATE.idle) ?? null;
  }

  private activateLocomotion(fadeDuration: number): void {
    this.locoActive = true;
    // Set initial weights based on current speed
    this.setSpeed(this.speed);
    // Immediately apply weights (skip interpolation for entry)
    this.locoWeights.walk = this.locoTargetWeights.walk;
    this.locoWeights.jog = this.locoTargetWeights.jog;
    this.locoWeights.sprint = this.locoTargetWeights.sprint;

    if (this.locoWalk) { this.locoWalk.reset().play(); this.locoWalk.setEffectiveWeight(this.locoWeights.walk); }
    if (this.locoJog) { this.locoJog.reset().play(); this.locoJog.setEffectiveWeight(this.locoWeights.jog); }
    if (this.locoSprint) { this.locoSprint.reset().play(); this.locoSprint.setEffectiveWeight(this.locoWeights.sprint); }
  }

  private deactivateLocomotion(fadeDuration: number): void {
    this.locoActive = false;
    if (this.locoWalk) this.locoWalk.fadeOut(fadeDuration);
    if (this.locoJog) this.locoJog.fadeOut(fadeDuration);
    if (this.locoSprint) this.locoSprint.fadeOut(fadeDuration);
  }

  private activateSpeedSwitch(
    idleAction: THREE.AnimationAction | null,
    moveAction: THREE.AnimationAction | null,
    fadeDuration: number,
  ): void {
    const moving = this.speed > SPEED_SWITCH_THRESHOLD;
    if (idleAction) { idleAction.reset().play(); idleAction.setEffectiveWeight(moving ? 0 : 1); }
    if (moveAction) { moveAction.reset().play(); moveAction.setEffectiveWeight(moving ? 1 : 0); }
  }

  private deactivateSpeedSwitch(
    idleAction: THREE.AnimationAction | null,
    moveAction: THREE.AnimationAction | null,
    fadeDuration: number,
  ): void {
    if (idleAction) idleAction.fadeOut(fadeDuration);
    if (moveAction) moveAction.fadeOut(fadeDuration);
  }

  private updateSpeedSwitch(
    idleAction: THREE.AnimationAction,
    moveAction: THREE.AnimationAction,
    speed: number,
  ): void {
    const moving = speed > SPEED_SWITCH_THRESHOLD;
    idleAction.setEffectiveWeight(moving ? 0 : 1);
    moveAction.setEffectiveWeight(moving ? 1 : 0);
    if (moving) {
      moveAction.timeScale = Math.max(0.1, speed / WALK_AUTHORED_SPEED);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/character/animation/AnimationController.ts
git commit -m "feat(animation): add AnimationController — locomotion blending, state transitions"
```

---

### Task 5: CharacterFactory

**Files:**
- Create: `src/character/animation/CharacterFactory.ts`

- [ ] **Step 1: Create CharacterFactory.ts**

```typescript
// src/character/animation/CharacterFactory.ts
import * as THREE from 'three';
import type { AssetLoader } from '@level/AssetLoader';
import type { AnimationProfile } from './AnimationProfile';
import { CharacterModel } from './CharacterModel';
import { AnimationController } from './AnimationController';

export interface CharacterCreateOptions {
  tint?: THREE.Color;
}

export async function createAnimatedCharacter(
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

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/character/animation/CharacterFactory.ts
git commit -m "feat(animation): add CharacterFactory function"
```

---

## Chunk 3: LandState + FSM Integration

### Task 6: Add `land` state to types

**Files:**
- Modify: `src/core/types.ts:59-69`

- [ ] **Step 1: Add `land` to STATE const**

In `src/core/types.ts`, add `land: 'land'` to the `STATE` object (line ~69, before the closing `} as const`):

```typescript
// Add after grab: 'grab',
land: 'land',
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): add land state identifier"
```

---

### Task 7: LandState

**Files:**
- Create: `src/character/states/LandState.ts`

- [ ] **Step 1: Create LandState.ts**

```typescript
// src/character/states/LandState.ts
import * as THREE from 'three';
import { STATE, type InputState, type StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

/** Maximum time in the land state before auto-exiting (safety net). */
const LAND_DURATION = 0.4;

export class LandState extends State {
  readonly id: StateId = STATE.land;
  private timer = 0;

  enter(): void {
    this.timer = LAND_DURATION;
  }

  exit(): void {
    this.timer = 0;
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return STATE.air;

    // Allow jump to interrupt landing for responsive feel
    if (input.jumpPressed) return STATE.jump;

    // Auto-exit after timer expires
    // (AnimationController.isClipFinished() is checked via PlayerController,
    //  but the timer is the hard ceiling)
    if (this.timer <= 0) {
      const hasMovement = input.forward || input.backward || input.left || input.right;
      return hasMovement ? STATE.move : STATE.idle;
    }

    return null;
  }

  update(dt: number): void {
    this.timer = Math.max(0, this.timer - dt);
  }

  getDesiredMovement(_dt: number, _input: InputState): THREE.Vector3 {
    // Minimal movement during landing — player can still steer slightly
    return _movement.set(0, 0, 0);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/character/states/LandState.ts
git commit -m "feat(states): add LandState with timer-based exit"
```

---

### Task 8: Register LandState in FSM + AirState routing

**Files:**
- Modify: `src/character/CharacterFSM.ts:14,37`
- Modify: `src/character/states/AirState.ts:18-27`

- [ ] **Step 1: Register LandState in CharacterFSM.ts**

Add import at top:
```typescript
import { LandState } from './states/LandState';
```

Add registration in constructor after `CarryState`:
```typescript
this.registerState(new LandState(player));
```

- [ ] **Step 2: Modify AirState to route to land on high-impact landing**

Replace `AirState.handleInput()` with:

```typescript
handleInput(input: InputState, isGrounded: boolean): StateId | null {
  if (!isGrounded) {
    return null;
  }

  // Route to land state on high-impact landings
  const impactSpeed = Math.abs(this.player.verticalVelocity);
  if (impactSpeed > 2.0) return STATE.land;

  // Low-impact: skip land animation for snappy feel
  if (input.crouch) return STATE.crouch;
  const hasMovement = input.forward || input.backward || input.left || input.right;
  if (hasMovement) return STATE.move;
  return STATE.idle;
}
```

Note: `this.player.verticalVelocity` is accessible via the `player: PlayerController` reference from the `State` base class. At the time `handleInput` runs in `fixedUpdate`, the velocity has been synced from the physics body. We use the current vertical velocity (which is the velocity at the moment of landing detection). For high falls, this will be a large negative value; `Math.abs()` gives us the impact speed.

**Important caveat**: The `isGrounded` flag is set during the *previous* frame's mode fixedUpdate. When `AirState.handleInput()` runs, `isGrounded` just flipped to true, and `verticalVelocity` still holds the pre-landing downward velocity from the physics sync at the top of `fixedUpdate()`. This is the correct value to use — it represents the velocity at moment of ground contact. After the mode runs its floating spring + gravity this frame, the velocity will be damped to near-zero, but we read it before that happens.

- [ ] **Step 3: Expose `verticalVelocity` as public on PlayerController**

Check `src/character/PlayerController.ts` — `verticalVelocity` is already `public` (line 64). No change needed.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/character/CharacterFSM.ts src/character/states/AirState.ts
git commit -m "feat(fsm): register LandState, route high-impact landings from AirState"
```

---

## Chunk 4: PlayerController Integration

### Task 9: Replace CharacterVisual with new animation system

**Files:**
- Modify: `src/character/PlayerController.ts`

This is the main integration task. Replace `CharacterVisual` usage with `CharacterModel` + `AnimationController` via factory.

- [ ] **Step 1: Update imports**

Replace the CharacterVisual import:
```typescript
// Remove:
import { CharacterVisual } from './CharacterVisual';

// Add:
import type { CharacterModel } from './animation/CharacterModel';
import type { AnimationController } from './animation/AnimationController';
import { createAnimatedCharacter } from './animation/CharacterFactory';
import { PLAYER_PROFILE } from './animation/profiles';
import type { AssetLoader } from '@level/AssetLoader';
```

- [ ] **Step 2: Update class fields**

Replace:
```typescript
private characterVisual: CharacterVisual | null = null;
```
With:
```typescript
private characterModel: CharacterModel | null = null;
private animator: AnimationController | null = null;
```

- [ ] **Step 3: Update constructor — accept AssetLoader, init character**

Add `assetLoader: AssetLoader` as the 4th constructor parameter:

```typescript
constructor(
  private physicsWorld: PhysicsWorld,
  private scene: THREE.Scene,
  private eventBus: EventBus,
  private assetLoader: AssetLoader,
) {
```

Replace the CharacterVisual creation lines:
```typescript
// Remove:
this.characterVisual = new CharacterVisual(this.mesh);
void this.characterVisual.init();

// Add:
void this.initCharacter();
```

Add new method:
```typescript
private async initCharacter(): Promise<void> {
  try {
    const { model, animator } = await createAnimatedCharacter(
      PLAYER_PROFILE, this.mesh, this.assetLoader,
    );
    this.characterModel = model;
    this.animator = animator;
  } catch (err) {
    console.warn('[PlayerController] Character load failed, using capsule fallback:', err);
  }
}
```

- [ ] **Step 4: Update update() method**

Replace (around line 475-477):
```typescript
// Remove:
this.characterVisual?.setMovementSpeed(this.cachedHorizontalSpeed);
this.characterVisual?.setState(this.fsm.current);
this.characterVisual?.update(_dt);

// Add:
this.animator?.setSpeed(this.cachedHorizontalSpeed);
this.animator?.setState(this.fsm.current);
this.animator?.update(_dt);
```

- [ ] **Step 5: Update dispose() method**

Replace (around line 588):
```typescript
// Remove:
this.characterVisual?.dispose();

// Add:
this.animator?.dispose();
this.characterModel?.dispose();
```

- [ ] **Step 6: Update callers — pass AssetLoader to PlayerController**

Find where `PlayerController` is constructed. It should be in `main.ts` or a bootstrap file. Add the `assetLoader` argument from `LevelManager.getAssetLoader()`.

Search for `new PlayerController(` in the codebase and update the call to pass the asset loader.

Likely pattern:
```typescript
// Before:
const player = new PlayerController(physicsWorld, scene, eventBus);
// After:
const player = new PlayerController(physicsWorld, scene, eventBus, levelManager.getAssetLoader());
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add src/character/PlayerController.ts src/main.ts
git commit -m "feat(player): integrate animated character model via factory"
```

---

### Task 10: Delete CharacterVisual.ts

**Files:**
- Delete: `src/character/CharacterVisual.ts`

- [ ] **Step 1: Delete the file**

```bash
rm src/character/CharacterVisual.ts
```

- [ ] **Step 2: Verify no remaining imports**

Search for any remaining references to `CharacterVisual` in the codebase:
```bash
grep -r "CharacterVisual" src/
```
Expected: No results.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor: remove CharacterVisual (replaced by animation system)"
```

---

## Chunk 5: NavAgent Upgrade

### Task 11: Upgrade NavAgent with animated model

**Files:**
- Modify: `src/navigation/NavAgent.ts`

- [ ] **Step 1: Rewrite NavAgent with async init pattern**

The constructor keeps creating a capsule placeholder. A new `init()` method loads the animated model.

```typescript
// src/navigation/NavAgent.ts
import * as THREE from 'three';
import type { AssetLoader } from '@level/AssetLoader';
import type { AnimationController } from '@character/animation/AnimationController';
import type { CharacterModel } from '@character/animation/CharacterModel';
import { createAnimatedCharacter } from '@character/animation/CharacterFactory';
import { NPC_PROFILE } from '@character/animation/profiles';
import { STATE } from '@core/types';

export class NavAgent {
  readonly mesh: THREE.Group;
  readonly id: string;
  private pathLine: THREE.Line | null = null;
  private pathLineMaterial: THREE.LineBasicMaterial | null = null;
  private pathPositions: Float32Array | null = null;
  private pathAttribute: THREE.BufferAttribute | null = null;
  private pathCapacity = 0;

  private capsuleMesh: THREE.Mesh;
  private characterModel: CharacterModel | null = null;
  private animator: AnimationController | null = null;
  private prevPosition = new THREE.Vector3();
  private velocity = 0;

  constructor(scene: THREE.Scene, position: THREE.Vector3, private tintColor?: THREE.Color) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);

    // Capsule placeholder (visible until model loads)
    const geometry = new THREE.CapsuleGeometry(0.25, 0.5, 4, 8);
    const material = new THREE.MeshStandardMaterial({
      color: tintColor ?? 0xff6600,
      roughness: 0.5,
    });
    this.capsuleMesh = new THREE.Mesh(geometry, material);
    this.capsuleMesh.castShadow = true;
    this.mesh.add(this.capsuleMesh);

    this.id = THREE.MathUtils.generateUUID();
    scene.add(this.mesh);
    this.prevPosition.copy(position);
  }

  /** Load animated model. Call after construction; agent works with capsule until complete. */
  async init(loader: AssetLoader): Promise<void> {
    try {
      const { model, animator } = await createAnimatedCharacter(
        NPC_PROFILE, this.mesh, loader,
        { tint: this.tintColor },
      );
      this.characterModel = model;
      this.animator = animator;
      this.capsuleMesh.visible = false;
    } catch (err) {
      console.warn('[NavAgent] Model load failed, keeping capsule:', err);
    }
  }

  updatePosition(position: { x: number; y: number; z: number }, dt?: number): void {
    const newPos = new THREE.Vector3(position.x, position.y + 0.5, position.z);

    // Compute velocity for animation
    if (dt && dt > 0) {
      this.velocity = newPos.distanceTo(this.prevPosition) / dt;
    }
    this.prevPosition.copy(this.mesh.position);
    this.mesh.position.copy(newPos);

    // Rotate toward movement direction
    const dx = newPos.x - this.prevPosition.x;
    const dz = newPos.z - this.prevPosition.z;
    if (dx * dx + dz * dz > 0.0001) {
      const targetAngle = Math.atan2(dx, dz);
      this.mesh.rotation.y = targetAngle;
    }

    // Update animation state
    if (this.animator) {
      this.animator.setState(this.velocity > 0.1 ? STATE.move : STATE.idle);
      this.animator.setSpeed(this.velocity);
    }
  }

  /** Call each frame to advance animations. */
  update(dt: number): void {
    this.animator?.update(dt);
  }

  updatePathVisualization(
    scene: THREE.Scene,
    points: Array<{ x: number; y: number; z: number }>,
  ): void {
    if (points.length < 2) {
      if (this.pathLine) this.pathLine.visible = false;
      return;
    }

    if (!this.pathLine) {
      this.pathLineMaterial = new THREE.LineBasicMaterial({
        color: 0x00bcd4,
        transparent: true,
        opacity: 0.6,
      });
      const geometry = new THREE.BufferGeometry();
      this.pathLine = new THREE.Line(geometry, this.pathLineMaterial);
      scene.add(this.pathLine);
    }

    const neededFloats = points.length * 3;
    if (!this.pathPositions || this.pathCapacity < points.length) {
      this.pathCapacity = points.length;
      this.pathPositions = new Float32Array(neededFloats);
      this.pathAttribute = new THREE.BufferAttribute(this.pathPositions, 3);
      this.pathLine.geometry.setAttribute('position', this.pathAttribute);
    }
    const positions = this.pathPositions;
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].x;
      positions[i * 3 + 1] = points[i].y + 0.1;
      positions[i * 3 + 2] = points[i].z;
    }
    this.pathAttribute!.needsUpdate = true;
    this.pathLine.geometry.setDrawRange(0, points.length);
    this.pathLine.visible = true;
  }

  highlight(durationMs = 2000): void {
    // Highlight effect on the capsule (fallback) or model materials
    if (this.characterModel) {
      // Temporarily boost emissive
      this.characterModel.root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const mat = node.material as THREE.MeshStandardMaterial;
          if (mat.isMeshStandardMaterial) {
            const origEmissive = mat.emissiveIntensity;
            mat.emissiveIntensity = 0.6;
            mat.emissive.setHex(0x00ff88);
            setTimeout(() => {
              mat.emissiveIntensity = origEmissive;
              mat.emissive.setHex(0x000000);
            }, durationMs);
          }
        }
      });
    } else {
      const mat = this.capsuleMesh.material as THREE.MeshStandardMaterial;
      const originalColor = mat.color.getHex();
      mat.color.setHex(0x00ff88);
      mat.emissive.setHex(0x00ff88);
      mat.emissiveIntensity = 0.6;
      setTimeout(() => {
        mat.color.setHex(originalColor);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }, durationMs);
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.capsuleMesh.geometry.dispose();
    (this.capsuleMesh.material as THREE.Material).dispose();
    this.animator?.dispose();
    this.characterModel?.dispose();

    if (this.pathLine) {
      scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
    }
    if (this.pathLineMaterial) {
      this.pathLineMaterial.dispose();
    }
  }
}
```

- [ ] **Step 2: Update NavAgent callers to call `init()` and `update()`**

Search for `new NavAgent(` in the codebase and ensure callers:
1. Pass tint color if desired
2. Call `await agent.init(assetLoader)` after construction
3. Call `agent.update(dt)` each frame

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/navigation/NavAgent.ts
git commit -m "feat(npc): upgrade NavAgent with animated character model"
```

---

## Chunk 6: Manual Verification

### Task 12: Visual verification

- [ ] **Step 1: Run dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify player character**

Open browser, check:
- [ ] Mannequin model visible (not blue capsule)
- [ ] Model is correctly scaled and positioned (feet on ground, not floating/sinking)
- [ ] Idle animation plays when standing still
- [ ] Walk animation when moving slowly
- [ ] Jog animation at medium speed
- [ ] Sprint animation when sprinting
- [ ] Smooth blending between walk/jog/sprint
- [ ] Jump animation on jump press
- [ ] Air/falling loop while airborne
- [ ] Landing animation on high-impact landing (fall from height)
- [ ] Crouch idle when crouching still
- [ ] Crouch forward when crouch-walking
- [ ] Interact animation on interact
- [ ] Carry idle when carrying and still
- [ ] Carry walk when carrying and moving

- [ ] **Step 3: Fix any model alignment issues**

If the model floats above ground or sinks below:
- Adjust `capsuleBottom` offset in `CharacterModel.ts`
- If the root bone rotation causes the model to face wrong direction, apply a Y rotation correction

If the model is too big or small:
- Adjust the scale calculation in `CharacterModel.ts`

- [ ] **Step 4: Verify NPC**

If NPCs exist in the current level:
- [ ] NPC has tinted mannequin model (not orange capsule)
- [ ] NPC idle animation when stationary
- [ ] NPC walk animation when patrolling
- [ ] NPC faces movement direction

- [ ] **Step 5: Final commit after any fixes**

```bash
git add -A
git commit -m "fix(animation): adjust model alignment and animation tuning"
```
