# KIN-031 Bay Rollout And Final Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four remaining bay defects, input-honesty gaps, back-half recovery gap, and final validation/evidence requirements for all 14 Kinema showcase bays.

**Architecture:** Keep `ProceduralBuilder` as the owner of authored geometry and signs, add one focused `GrabGoalSystem` for the only new runtime state, reuse the existing objective/audio/VFX and checkpoint contracts, and expose only narrow debug truths needed by Playwright. A single rollout spec covers the 3×3×3 renderer/profile/input matrix with three world boots; existing domain specs remain the deep mechanic proof.

**Tech Stack:** TypeScript 5.9 strict, Three.js 0.183, Rapier 3D compat 0.19, Tone.js, Vitest 4, Playwright, Biome, Vite 8.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-21-kin031-bay-rollout-design.md` exactly.
- Preserve the validated entrance/steps/movement/door slice except the required steps contrast cue.
- Preserve the 70-collectible total by relocating, not deleting, the five `futureA` coins.
- Add no dependency, new mechanic, new bay, or binary asset.
- Keep station colors, existing collision, fixed-step semantics, input edge merging, and KIN-030 boundary geometry unchanged outside explicit additions.
- Every behavior change uses RED/GREEN TDD and receives a focused GPT-5.6 SOL review before the next task.
- Add a new Playwright file to the explicit `testMatch` allowlist; make no other Playwright configuration change.
- Keep transient Playwright output untracked; commit only durable evidence under `docs/audits/evidence/`.
- Do not claim true WebGPU from SwiftShader. Hardware proof must report `activeBackend === "WebGPU"` in installed headed Chrome.
- The full Playwright suite runs twice consecutively with `--workers=1` on an otherwise idle machine.

---

### Task 1: Bay Readability And Input-Honesty Contract

**Files:**
- Create: `src/ui/inputGuidance.ts`
- Create: `src/ui/inputGuidance.test.ts`
- Modify: `src/level/ProceduralBuilder.ts`
- Modify: `src/level/ProceduralBuilder.test.ts`
- Modify: `src/ui/UIManager.ts`
- Modify: `src/ui/UIManager.test.ts`
- Modify: `src/ui/menus/HelpMenu.ts`
- Modify: `src/ui/menus/HelpMenu.test.ts`

**Interfaces:**
- Produces: `getThrowGuidance(source: InputSource): string`
- Produces: `getDroneAltitudeGuidance(source: InputSource): string`
- Produces stable scene names `StationSign_steps`, `StationSign_slopes`, `StationSign_movement`, `StationSign_doubleJump`, `StationSign_grab`, `StationSign_throw`, `StationSign_door`, `StationSign_vehicles`, `StationSign_platformsMoving`, `StationSign_platformsPhysics`, `StationSign_materials`, `StationSign_vfx`, `StationSign_navigation`, `StationSign_futureA`, `StepsTooTallCue_col`, `StepsTooTallLabel`, `SlopesTooSteepMarker`, and `SlopesTooSteepLabel`.
- Consumes existing `input:sourceChanged`, `interaction:pickUp`, and `vehicle:enter` events.

- [ ] **Step 1: Write failing pure guidance tests**

Add `src/ui/inputGuidance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getDroneAltitudeGuidance, getThrowGuidance } from "./inputGuidance";

describe("input guidance", () => {
  it.each([
    ["keyboard", "LMB to throw"],
    ["gamepad", "RT to throw"],
    ["touch", "Interact to throw"],
  ] as const)("describes throwing for %s", (source, expected) => {
    expect(getThrowGuidance(source)).toBe(expected);
  });

  it.each([
    ["keyboard", "E / Q to change drone altitude"],
    ["gamepad", "Right Stick ↑ / ↓ to change drone altitude"],
    ["touch", "Right Look Zone ↑ / ↓ to change drone altitude"],
  ] as const)("describes drone altitude for %s", (source, expected) => {
    expect(getDroneAltitudeGuidance(source)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the tests and observe the missing-module RED**

Run: `npx vitest run src/ui/inputGuidance.test.ts`

Expected: FAIL because `src/ui/inputGuidance.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure guidance helpers**

Create `src/ui/inputGuidance.ts`:

```ts
import type { InputSource } from "@core/types";

export function getThrowGuidance(source: InputSource): string {
  if (source === "gamepad") return "RT to throw";
  if (source === "touch") return "Interact to throw";
  return "LMB to throw";
}

export function getDroneAltitudeGuidance(source: InputSource): string {
  if (source === "gamepad") return "Right Stick ↑ / ↓ to change drone altitude";
  if (source === "touch") return "Right Look Zone ↑ / ↓ to change drone altitude";
  return "E / Q to change drone altitude";
}
```

- [ ] **Step 4: Run the helper tests GREEN**

Run: `npx vitest run src/ui/inputGuidance.test.ts`

Expected: all cases pass.

- [ ] **Step 5: Write failing builder and UI routing assertions**

Extend `ProceduralBuilder.test.ts` to require the exact 14 `StationSign_*` names listed in the Interfaces block, the two steps cue names, the two slopes cue names, binding-neutral vehicle copy, and navigation copy without `N=debug` or `T=target`.

Extend `UIManager.test.ts`:

```ts
listeners.get("input:sourceChanged")?.({ source: "touch" });
listeners.get("interaction:pickUp")?.({ object: {} });
expect(hud.showStatus).toHaveBeenCalledWith("Interact to throw", 2200);

listeners.get("input:sourceChanged")?.({ source: "gamepad" });
listeners.get("vehicle:enter")?.({ vehicle: { type: "drone" } });
expect(hud.showStatus).toHaveBeenCalledWith("Right Stick ↑ / ↓ to change drone altitude", 2800);
```

Extend `HelpMenu.test.ts` so keyboard, gamepad, and touch each contain their throw and drone-altitude guidance rows.

- [ ] **Step 6: Run focused tests and observe the behavior RED**

Run: `npx vitest run src/level/ProceduralBuilder.test.ts src/ui/UIManager.test.ts src/ui/menus/HelpMenu.test.ts src/ui/inputGuidance.test.ts`

Expected: new geometry/copy/routing assertions fail while helper tests remain green.

- [ ] **Step 7: Add the minimal authored cues and stable sign names**

In `ProceduralBuilder.ts`:

- pass the matching exact `StationSign_*` name from the Interfaces block as the final argument to every primary station `createSectionLabel` call;
- add a warning-material static cuboid named `StepsTooTallCue_col`, with height greater than `0.30`, beside the traversable steps lane;
- add a `StepsTooTallLabel` sprite with `Too tall — jump`;
- add a non-colliding floor marker named `SlopesTooSteepMarker` at the 62.7-degree lane entrance and a `SlopesTooSteepLabel` sprite;
- change vehicle sign copy to `Vehicles\nInteract to enter / exit • Controls adapt to input`;
- change navigation sign copy to `Navigation\nNavMesh • Crowd Patrol • Dynamic Targets`.

Use existing `MeshStandardMaterial`, `createFixedStaticBox`, and `createSectionLabel` patterns. Do not change the step or slope colliders.

The cue construction is:

```ts
const warningMat = new THREE.MeshStandardMaterial({
  color: 0xff6b45,
  emissive: 0x7a1608,
  emissiveIntensity: 0.55,
  roughness: 0.42,
});
this.createFixedStaticBox(
  "StepsTooTallCue",
  new THREE.Vector3(4, 0.45, 2.4),
  new THREE.Vector3(0, bayTopY + 0.225, zSteps - 1.2),
  new THREE.Euler(),
  warningMat,
  "showcase-step-limit",
);
this.createSectionLabel(
  "Too tall — jump",
  new THREE.Vector3(0, bayTopY + 1.5, zSteps - 1.2),
  4.8,
  1.0,
  "StepsTooTallLabel",
);

const steepMarker = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.04, 1.1), warningMat);
steepMarker.position.set(10, bayTopY + 0.03, zSlopes + 6.1);
steepMarker.name = "SlopesTooSteepMarker";
this.scene.add(steepMarker);
this.meshes.push(steepMarker);
this.createSectionLabel(
  "Too steep — slide",
  new THREE.Vector3(10, bayTopY + 1.45, zSlopes + 6.4),
  5.2,
  1.0,
  "SlopesTooSteepLabel",
);
```

`createFixedStaticBox` appends `_col`, producing the required `StepsTooTallCue_col` name.

- [ ] **Step 8: Route source-aware runtime guidance**

In `UIManager.ts`, show `getThrowGuidance(this.inputSource)` on `interaction:pickUp` for 2200ms. On `vehicle:enter`, show `getDroneAltitudeGuidance(this.inputSource)` for 2800ms only when `vehicle.type === "drone"`.

```ts
this.eventBus.on("interaction:pickUp", () => {
  this.hud.showStatus(getThrowGuidance(this.inputSource), 2200);
});
this.eventBus.on("vehicle:enter", ({ vehicle }) => {
  if (vehicle.type === "drone") {
    this.hud.showStatus(getDroneAltitudeGuidance(this.inputSource), 2800);
  }
});
```

In `HelpMenu.ts`, add the same source-appropriate throw and drone-altitude rows. Do not show keyboard keys in gamepad/touch sections.

- [ ] **Step 9: Run focused tests GREEN and verify types/lint**

Run:

```powershell
npx vitest run src/level/ProceduralBuilder.test.ts src/ui/UIManager.test.ts src/ui/menus/HelpMenu.test.ts src/ui/inputGuidance.test.ts
npx tsc
npx biome check --formatter-enabled=false src/level/ProceduralBuilder.ts src/level/ProceduralBuilder.test.ts src/ui/inputGuidance.ts src/ui/inputGuidance.test.ts src/ui/UIManager.ts src/ui/UIManager.test.ts src/ui/menus/HelpMenu.ts src/ui/menus/HelpMenu.test.ts
```

Expected: focused tests and typecheck pass; scoped Biome reports zero errors.

- [ ] **Step 10: Commit**

```powershell
git add src/level/ProceduralBuilder.ts src/level/ProceduralBuilder.test.ts src/ui/inputGuidance.ts src/ui/inputGuidance.test.ts src/ui/UIManager.ts src/ui/UIManager.test.ts src/ui/menus/HelpMenu.ts src/ui/menus/HelpMenu.test.ts
git commit -m "Clarify showcase bay guidance"
```

---

### Task 2: Replayable Grab Pressure Goal

**Files:**
- Create: `src/systems/GrabGoalSystem.ts`
- Create: `src/systems/GrabGoalSystem.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/KinemaDebugApi.ts`
- Modify: `src/level/ProceduralBuilder.ts`
- Modify: `src/level/ProceduralBuilder.test.ts`
- Modify: `src/systems/ParticleSystem.ts`
- Modify: `src/systems/ParticleSystem.test.ts`
- Modify: `src/Game.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `GrabGoalDebugState = { phase: "inactive" | "ready" | "settling" | "completed" | "resetting"; activeCube: string | null; completions: number }`.
- Produces: `GrabGoalSystem.getDebugState(): GrabGoalDebugState`.
- Produces: `GrabGoalSystem.placeCubeOnGoal(name?: string): boolean`.
- Extends `objective:completed` payload with optional `position?: THREE.Vector3`.
- Extends `KinemaInteractionEvent` with the observable `objective:completed` payload used by browser proof.
- Extends `KinemaDebugApi` with `getGrabGoalState()` and `placeGrabCubeOnGoal(name?)`.

- [ ] **Step 1: Write RED state-machine tests**

Create `GrabGoalSystem.test.ts` with body/scene doubles that prove:

```ts
expect(system.getDebugState().phase).toBe("inactive");
system.setupStation("grab");
expect(system.getDebugState().phase).toBe("ready");

expect(system.placeCubeOnGoal("PushCubeS")).toBe(true);
system.fixedUpdate(0.1);
expect(system.getDebugState().phase).toBe("settling");
system.fixedUpdate(0.2);
expect(completed).toContainEqual(expect.objectContaining({ id: "grab-delivery", text: "Cube delivered" }));

system.fixedUpdate(2.6);
expect(system.getDebugState()).toMatchObject({ phase: "ready", activeCube: null, completions: 1 });
expect(cube.setTranslation).toHaveBeenLastCalledWith(authoredPose, true);
```

Also prove non-grab stations stay inactive, kinematic/carried cubes do not complete, and teardown clears references.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/systems/GrabGoalSystem.test.ts`

Expected: FAIL because `GrabGoalSystem` does not exist.

- [ ] **Step 3: Add the grab target geometry**

In the `grab` block of `ProceduralBuilder.ts`, create:

- a shallow outlined pad centered at local `(-12, bayTopY + 0.04, -2)`, named `GrabGoalOutline`;
- a non-colliding inset named `GrabGoalCore`;
- a label named `GrabGoalLabel` with `Deliver a cube\nTarget resets automatically`.

Use existing cyan station materials; store authored-ready and completion colors in mesh `userData` only if needed by the system. Add source-contract assertions to `ProceduralBuilder.test.ts` before implementation and observe their RED first.

```ts
const goalCenter = new THREE.Vector3(-12, bayTopY + 0.04, zGrab - 2);
const goalMat = new THREE.MeshStandardMaterial({
  color: 0x0a2730,
  emissive: 0x00d8ff,
  emissiveIntensity: 1.4,
  roughness: 0.3,
});
const goal = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.75, 32), goalMat);
goal.rotation.x = -Math.PI / 2;
goal.position.copy(goalCenter);
goal.name = "GrabGoalOutline";
this.scene.add(goal);
this.meshes.push(goal);
const goalCore = new THREE.Mesh(
  new THREE.CircleGeometry(1.42, 32),
  new THREE.MeshStandardMaterial({
    color: 0x06212a,
    emissive: 0x00758a,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.7,
  }),
);
goalCore.rotation.x = -Math.PI / 2;
goalCore.position.copy(goalCenter).add(new THREE.Vector3(0, 0.005, 0));
goalCore.name = "GrabGoalCore";
this.scene.add(goalCore);
this.meshes.push(goalCore);
this.createSectionLabel(
  "Deliver a cube\nTarget resets automatically",
  new THREE.Vector3(-12, bayTopY + 2.0, zGrab - 2),
  6.2,
  1.35,
  "GrabGoalLabel",
);
```

- [ ] **Step 4: Implement the focused runtime system**

Implement `GrabGoalSystem` as a registered fixed-update system:

```ts
export class GrabGoalSystem implements RuntimeSystem {
  readonly id = "grab-goal";
  setupLevel(): void;
  setupStation(key: ShowcaseStationKey): void;
  setupCustomLevel(): void;
  fixedUpdate(dt: number): void;
  teardownLevel(): void;
  getDebugState(): GrabGoalDebugState;
  placeCubeOnGoal(name = "PushCubeS"): boolean;
  dispose(): void;
}
```

Find only `PushCubeS`, `PushCubeM`, and `PushCubeL` bodies. Accept only `RigidBodyType.Dynamic`; require bounds and settled velocity for a `0.2s` dwell. On completion, emit:

```ts
eventBus.emit("objective:completed", {
  id: "grab-delivery",
  text: "Cube delivered",
  position: completionPosition.clone(),
});
```

After `2.5s`, restore the delivered cube’s authored translation/rotation, zero linear/angular velocity, wake it, and return the goal material to ready.

- [ ] **Step 5: Wire all setup paths and debug API**

Register `GrabGoalSystem` in `Game`; call it from `setupLevel`, `setupStation`, `setupCustomLevel`, and teardown through the normal runtime-system lifecycle. Add Game forwarding methods and the two narrow `KinemaDebugApi` members in `main.ts`.

Add `getInputSource(): InputSource` to `KinemaDebugApi` and return `inputManager.lastInputSource`; Task 4 consumes it.

- [ ] **Step 6: Add completion-position particles RED/GREEN**

First extend `ParticleSystem.test.ts` to emit `objective:completed` with `position` and expect one completion burst. Then subscribe in `ParticleSystem.ts`; ignore objective events without a position so existing objective flows do not duplicate beacon/coin effects.

- [ ] **Step 7: Run the focused GREEN gate**

Run:

```powershell
npx vitest run src/systems/GrabGoalSystem.test.ts src/systems/ParticleSystem.test.ts src/level/ProceduralBuilder.test.ts src/core/EventBus.test.ts
npx tsc
npx biome check --formatter-enabled=false src/systems/GrabGoalSystem.ts src/systems/GrabGoalSystem.test.ts src/systems/ParticleSystem.ts src/systems/ParticleSystem.test.ts src/core/types.ts src/core/KinemaDebugApi.ts src/Game.ts src/main.ts src/level/ProceduralBuilder.ts src/level/ProceduralBuilder.test.ts
```

Expected: tests/typecheck pass and no scoped Biome errors.

- [ ] **Step 8: Add and run a real browser goal journey**

Extend the later rollout spec or add a temporary targeted test that loads `/?station=grab`, asserts the stable goal objects, calls `placeGrabCubeOnGoal`, waits for real `objective:completed`, observes `completed`, and waits for `ready` with the cube restored. Run serially and preserve the test in `rollout-validation.ts` when Task 4 lands.

- [ ] **Step 9: Commit**

```powershell
git add src/systems/GrabGoalSystem.ts src/systems/GrabGoalSystem.test.ts src/systems/ParticleSystem.ts src/systems/ParticleSystem.test.ts src/core/types.ts src/core/KinemaDebugApi.ts src/Game.ts src/main.ts src/level/ProceduralBuilder.ts src/level/ProceduralBuilder.test.ts
git commit -m "Add replayable grab delivery goal"
```

---

### Task 3: Back-Half Checkpoint And Reserved-Bay Honesty

**Files:**
- Modify: `src/level/CoinLayout.ts`
- Modify: `src/level/PickupLayout.test.ts`
- Modify: `src/systems/CheckpointObjectiveSystem.ts`
- Modify: `src/systems/CheckpointObjectiveSystem.test.ts`
- Modify: `tests/procedural-coins.ts`
- Modify: `tests/procedural-hazards.ts`

**Interfaces:**
- Preserves: `getProceduralCoinPlacements()` returns 70 total.
- Produces: `getProceduralCoinPlacements("futureA")` returns `[]`.
- Produces: second checkpoint id `showcase-checkpoint-back` between VFX and navigation.

- [ ] **Step 1: Write RED coin-policy tests**

Extend `PickupLayout.test.ts`:

```ts
expect(getProceduralCoinPlacements()).toHaveLength(70);
expect(getProceduralCoinPlacements("futureA")).toEqual([]);
const backTrail = getProceduralCoinPlacements("vfx").filter((entry) => entry.position.z < getShowcaseStationZ("vfx") - 5);
expect(backTrail).toHaveLength(5);
expect(backTrail.at(-1)?.position.x).toBeCloseTo(18);
```

Run: `npx vitest run src/level/PickupLayout.test.ts`

Expected: futureA still has five coins and VFX has no back trail.

- [ ] **Step 2: Relocate the five coins without changing the total**

Set `futureA: []`. Append five VFX-owned offsets forming a supported route from the rear of the VFX bay toward local `(18, *, -15)`. Keep all positions within the isolated floor and full corridor perimeter.

- [ ] **Step 3: Write RED checkpoint tests**

Extend `CheckpointObjectiveSystem.test.ts` to assert the scene contains both `Checkpoint_showcase-checkpoint` and `Checkpoint_showcase-checkpoint-back` after `setupLevel`, and that activating the back checkpoint updates the player respawn point without emitting a second `reach-checkpoint` completion.

Run: `npx vitest run src/systems/CheckpointObjectiveSystem.test.ts`

Expected: only the door checkpoint exists.

- [ ] **Step 4: Add the back-half checkpoint**

Keep the existing checkpoint unchanged and add:

```ts
this.checkpointManager.addCheckpoint(
  "showcase-checkpoint-back",
  new THREE.Vector3(18, getShowcaseBayTopY() + 0.12, getShowcaseStationZ("vfx") - 15),
  2.2,
);
```

- [ ] **Step 5: Extend browser proof RED/GREEN**

In `procedural-coins.ts`, assert the full total remains `70` and isolated `futureA` shows `0/0` with no debug collectibles. In `procedural-hazards.ts`, teleport to the back checkpoint, assert its id, trigger a lethal hit, and prove respawn occurs there without losing collected coins.

Run:

```powershell
npx vitest run src/level/PickupLayout.test.ts src/systems/CheckpointObjectiveSystem.test.ts src/systems/CoinCollectibleSystem.test.ts
npx playwright test tests/procedural-coins.ts tests/procedural-hazards.ts --workers=1
npx tsc
```

Expected: all focused unit and browser tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/level/CoinLayout.ts src/level/PickupLayout.test.ts src/systems/CheckpointObjectiveSystem.ts src/systems/CheckpointObjectiveSystem.test.ts tests/procedural-coins.ts tests/procedural-hazards.ts
git commit -m "Add back-half checkpoint trail"
```

---

### Task 4: Literal 3×3×3 Rollout Matrix And 14-Bay Proof

**Files:**
- Create: `tests/rollout-validation.ts`
- Modify: `tests/helpers/kinema.ts`
- Modify: `tests/procedural-review-screenshots.ts`
- Modify: `playwright.config.ts` (`testMatch` addition only)
- Modify only if a missing narrow truth is proven: `src/core/KinemaDebugApi.ts`, `src/main.ts`, `src/systems/DebugRuntimeSystem.ts`, `src/Game.ts`

**Interfaces:**
- Consumes: `getInputSource`, `getGrabGoalState`, `placeGrabCubeOnGoal`, review spawns, object state, renderer/profile flags, interaction events, collectibles, ray casts, VFX, vehicles, navigation, frame stats.
- Produces: three renderer boots × three profiles × three input-source observations.

- [ ] **Step 1: Add the allowlisted spec shell and observe RED**

Add `rollout-validation.ts` to `testMatch`. Create three route cases:

```ts
const RENDERERS = [
  { name: "default", query: "" },
  { name: "webgpu-webgl2", query: "&forceWebGPUWebGL=1" },
  { name: "compat", query: "&forceWebGL=1" },
] as const;
const PROFILES = ["performance", "balanced", "cinematic"] as const;
const INPUTS = ["keyboard", "gamepad", "touch"] as const;
```

Write one failing structural assertion for each new cue/sign/goal/checkpoint and one failing matrix assertion if any source/profile/backend observation is missing.

Run: `npx playwright test tests/rollout-validation.ts --workers=1`

Expected: RED until the production hooks and full assertions are present.

- [ ] **Step 2: Implement shared input activators**

Reuse—not fork—the established patterns:

- real `page.keyboard` with pointer-lock render-frame synchronization;
- standard `navigator.getGamepads` mock with an observed release poll before re-press;
- standards-shaped, composed `TouchEvent` with stable identifier, target, coordinates, and touch lists.

Put only generic wait/release helpers in `tests/helpers/kinema.ts`.

- [ ] **Step 3: Implement the 27 observations with three boots**

For each renderer route, boot `/?spawn=entrance` once in a touch-capable context. For each profile, set and await the applied profile. For each input source, activate the production source, assert `getInputSource()`, teleport through steps/movement/door, verify source-specific prompt/action/reset, and record backend/profile/badge/error state.

The matrix loop has one assertion record per cell:

```ts
const observations: Array<{ renderer: string; profile: string; input: string }> = [];
for (const profile of PROFILES) {
  expect(await page.evaluate((value) => window.__KINEMA__.setGraphicsProfile(value), profile)).toBe(profile);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getRendererFlags().graphicsProfile)).toBe(profile);
  for (const input of INPUTS) {
    await activateInputSource(page, input);
    await expect.poll(() => page.evaluate(() => window.__KINEMA__.getInputSource())).toBe(input);
    await proveDoorActionAndReset(page, input);
    observations.push({ renderer: rendererCase.name, profile, input });
    await releaseInputSource(page, input);
  }
}
expect(observations).toHaveLength(9);
```

Clear every source before the next observation. Do not navigate/reload the same page between matrix cells.

- [ ] **Step 4: Add 14-bay and high-risk spot assertions**

Assert one primary stable sign for all 14 bays. Add explicit proofs for:

- steps too-tall cue and slopes too-steep marker;
- grab goal completion and automatic reset;
- real throw recycle;
- vehicle entry/reset/guidance;
- moving-platform displacement and repeatability;
- physics-platform launch safety;
- materials passive `N/A` classification and zero primitive-shaped trimeshes;
- VFX renderer-honest copy and profile counts;
- navigation patrol displacement;
- `futureA` reserved copy and zero collectibles;
- back-half checkpoint activation.

For every coin, combine debug placement with downward floor-support/clearance ray queries. Add one real collection sample per active bay; do not call teleport-only proof “reachability.”

- [ ] **Step 5: Make gallery capture deterministic**

Extend `procedural-review-screenshots.ts` only as needed to capture the same 17 named review points after applying the requested profile and waiting for GPU resource mutation. Avoid `freezeForCapture()` silently leaving the profile at performance.

- [ ] **Step 6: Run focused matrix twice**

Run:

```powershell
npx playwright test tests/rollout-validation.ts --workers=1
npx playwright test tests/rollout-validation.ts --workers=1
npx tsc -p tests/tsconfig.json
npx tsc
```

Expected: both serial matrix runs pass with zero unexpected console/page errors.

- [ ] **Step 7: Commit**

```powershell
git add tests/rollout-validation.ts tests/helpers/kinema.ts tests/procedural-review-screenshots.ts playwright.config.ts src/core/KinemaDebugApi.ts src/main.ts src/systems/DebugRuntimeSystem.ts src/Game.ts
git commit -m "Validate the 14-bay rollout matrix"
```

Stage only files actually changed.

---

### Task 5: Hardware Evidence, Final Audit, And Repository Closeout

**Files:**
- Create: `docs/audits/evidence/kin031-review/01-entrance.png`
- Create: `docs/audits/evidence/kin031-review/02-overviewMid.png`
- Create: `docs/audits/evidence/kin031-review/03-steps.png`
- Create: `docs/audits/evidence/kin031-review/04-slopes.png`
- Create: `docs/audits/evidence/kin031-review/05-movement.png`
- Create: `docs/audits/evidence/kin031-review/06-doubleJump.png`
- Create: `docs/audits/evidence/kin031-review/07-grab.png`
- Create: `docs/audits/evidence/kin031-review/08-throw.png`
- Create: `docs/audits/evidence/kin031-review/09-door.png`
- Create: `docs/audits/evidence/kin031-review/10-vehicles.png`
- Create: `docs/audits/evidence/kin031-review/11-platformsMoving.png`
- Create: `docs/audits/evidence/kin031-review/12-platformsPhysics.png`
- Create: `docs/audits/evidence/kin031-review/13-materials.png`
- Create: `docs/audits/evidence/kin031-review/14-vfx.png`
- Create: `docs/audits/evidence/kin031-review/15-navigation.png`
- Create: `docs/audits/evidence/kin031-review/16-futureA.png`
- Create: `docs/audits/evidence/kin031-review/17-overviewEnd.png`
- Create: `docs/audits/evidence/kin031-rollout.md`
- Create: `docs/audits/kinema-implementation-closeout.md`
- Modify: `docs/audits/kinema-experience-audit.md`
- Modify: `docs/audits/evidence/frame-baseline.md`
- Modify: `AGENTS.md`
- Update ignored: `tasks/todo.md`, `tasks/lessons.md`, `.superpowers/sdd/progress.md`

**Interfaces:**
- Produces: durable 14/14 checklist, paired 17-view gallery, 27-cell matrix, performance tables, task-by-task closeout, and optional-tail disposition.

- [ ] **Step 1: Capture the final gallery**

Use fresh contexts and the same 17 poses/names as `kin030-review`. Capture installed-Chrome true WebGPU at 1920×1080/DPR1 plus renderer-path spot evidence. Inspect every image for signs, markers, goal state, reserved-bay honesty, clipping, and HUD overlap before committing.

- [ ] **Step 2: Run matched performance windows**

Record 600-frame windows for all 14 balanced true-WebGPU bays and entrance/vehicles/VFX/navigation across three renderer paths and three profiles. Verify:

- zero rendering diagnostics;
- post p95 `<= before × 1.10 + 2ms`;
- balanced hardware-WebGPU entrance `<= 20.895ms`;
- compatibility-post VFX ratio `<= 1.10`.

Evaluate balanced GTAO denoise visually and by p95; do not enable it unless a separate evidence-backed RED/GREEN change is justified.

- [ ] **Step 3: Write the rollout evidence and audit addendum**

`kin031-rollout.md` must include:

- paired links for all 17 views;
- one `PASS`/`N/A` row for every bay and every checklist field;
- all 27 renderer/profile/input observations;
- exact hardware, browser, backend, commands, timings, p95, and error counts;
- limitations without implied certification.

Append a dated section 24 addendum that preserves historical findings and explicitly marks resolved/stale items. Record KIN-T17/LVL-F14 as stale, A12/R10 as superseded unless reproduced, and real Safari/iOS, physical gamepad, and perceptual audio as unverified.

- [ ] **Step 4: Write the task-by-task final report**

`kinema-implementation-closeout.md` lists KIN-001 through KIN-031 with commit(s), verification, evidence, deviations, and design approvals. Classify KIN-T01 through T22 as completed, superseded/stale, included, or deferred with reasons. Record KIN-T18 as deferred pending binary-asset deletion approval and KIN-T22 as deferred pending Playwright/WebKit configuration and runtime approval.

- [ ] **Step 5: Correct the stale todo instruction**

In `AGENTS.md`, replace the nonexistent `tasks/TEMPLATE.md` instruction with the established `Goal / Constraints / Execution Plan / Review` structure. Add a durable lesson only if final verification reveals a new repository fact.

- [ ] **Step 6: Run the complete non-browser gate**

Run:

```powershell
npm run test
npx tsc
npx tsc -p tests/tsconfig.json
npm run build
npx biome check --formatter-enabled=false src/level/ProceduralBuilder.ts src/level/ProceduralBuilder.test.ts src/level/CoinLayout.ts src/level/PickupLayout.test.ts src/systems/GrabGoalSystem.ts src/systems/GrabGoalSystem.test.ts src/systems/ParticleSystem.ts src/systems/ParticleSystem.test.ts src/systems/CheckpointObjectiveSystem.ts src/systems/CheckpointObjectiveSystem.test.ts src/core/types.ts src/core/KinemaDebugApi.ts src/Game.ts src/main.ts src/ui/inputGuidance.ts src/ui/inputGuidance.test.ts src/ui/UIManager.ts src/ui/UIManager.test.ts src/ui/menus/HelpMenu.ts src/ui/menus/HelpMenu.test.ts tests/helpers/kinema.ts tests/rollout-validation.ts tests/procedural-review-screenshots.ts tests/procedural-coins.ts tests/procedural-hazards.ts
git diff --check
```

Expected: units, both typechecks, build, and scoped Biome pass with no new errors. Record the known full-lint baseline separately; do not run repo-wide `lint:fix`.

- [ ] **Step 7: Run the full browser suite twice consecutively**

On an idle machine:

```powershell
npx playwright test --workers=1
npx playwright test --workers=1
```

Expected: all configured tests pass twice. Preserve exact counts and elapsed times.

- [ ] **Step 8: Obtain final independent review**

Generate a review package from the KIN-031 base through HEAD. Dispatch GPT-5.6 SOL for whole-branch spec compliance and code quality. Resolve every Critical/Important finding test-first and repeat review until approved.

- [ ] **Step 9: Mark durable progress and commit closeout**

Set `tasks/todo.md` to DONE and append the final KIN-031 ledger line. Delete transient browser output after durable evidence is copied.

```powershell
git add AGENTS.md docs/audits docs/audits/evidence
git commit -m "Complete KIN-031 rollout validation"
```

Confirm `git status --short` contains no unintended or staged residue.
