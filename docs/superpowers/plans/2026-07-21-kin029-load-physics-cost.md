# KIN-029 Load-Time And Physics-Cost Implementation Plan

> **For agentic workers:** Execute test-first, keep the worker/deferred-load ownership rules explicit, and request independent GPT-5.6 SOL review before closing the card.

**Goal:** Reduce Play-to-interactive and runtime CPU cost while preserving loading feedback, navigation correctness, compatibility rendering, and authored collision behavior.

**Architecture:** `RendererManager` owns a single public shader-warmup operation: it drains queued renderer mutations, temporarily disables renderable-object frustum culling, and renders the exact active pipeline once while the loading overlay is present. This covers scene and post-processing shaders on every backend without using Three r183's unsafe `WebGPURenderer.compileAsync()` transition for this node-heavy scene. Bootstrap resolves the immutable `?warmup=0` flag and records warmup/interactive timing in `LevelManager` load stats while the loading UI reports the stage. `NavMeshManager.generateAsync` transfers extracted typed geometry to a Vite module Worker; `ProceduralBuilder` starts that work without awaiting it, gates agent construction with the existing load generation, and hands completed navigation resources to `LevelManager`, which emits `navigation:ready`. `DebugRuntimeSystem` refreshes its navigation references on that event. `ColliderFactory` becomes the single body-less owner of fixed primitive construction and shape accounting remains derived from the level-owned colliders.

## Stale-Card Corrections

- `NavMeshManager` lives in `src/navigation/`, not `src/level/`.
- navcat 0.2 exposes only synchronous `generateSoloNavMesh`; the repository's `generateAsync` is a pair of `setTimeout(0)` yields around that synchronous call, so it does not remove the 50+ ms main-thread stall.
- `ProceduralBuilder` already calls and awaits that wrapper, which gates both agents and the entire level load. True deferral needs a readiness handoff, not another `await`.
- Several static floor/boundary sites already use primitive colliders. The remaining cited high-value sites are rounded bay pedestals, rotated rough/angle boxes, step boxes, navigation boxes/cylinders, and material sample boxes/spheres.
- Existing renderer-path browser coverage is allowlisted through `visual-regression.ts`; new verification can extend already-allowlisted specs without editing `playwright.config.ts`.
- Real Chrome WebGPU A/B testing found that `WebGPURenderer.compileAsync(scene, camera)` leaves an ended Dawn render pass for the next frame with this scene under Three r183. `?warmup=0` and exact hidden-render-only runs are clean, so the warmup uses the latter on all paths and records the evidence rather than shipping a WebGPU validation error.

## Commit 1 - Record the implementation contract

**Files:** this plan and ignored `tasks/todo.md`.

1. Record architecture, ownership, rollback, test order, measurements, and scope exclusions.
2. Independently audit the plan with GPT-5.6 SOL before source completion.
3. Commit only the tracked plan.

## Commit 2 - Implement and prove the cost reductions

### 1. RED/GREEN shader warmup and loading stage

**Files:** `src/renderer/shaderWarmup.ts` and test, `src/renderer/RendererManager.ts` and test, `src/core/types.ts`, `src/ui/components/LoadingScreen.ts`, `src/ui/UIManager.ts` and test, `src/main.ts`.

1. Add a pure query resolver that defaults warmup on and disables only for `warmup=0|false`.
2. Add `LoadingScreen.setStatus`, expose a stable status selector, and extend `loading:progress` with optional status text.
3. Add `RendererManager.warmSceneForReveal`: await mutation idle, temporarily include all renderable objects regardless of current frustum, and call the exact normal `render()` path once while the loading overlay is present. Preserve fail-open behavior and restore culling in `finally`.
4. In every loading-screen run path, emit `Compiling shaders…`, await warmup unless disabled, then hide the screen. Record the warmup and Play-to-interactive durations.

### 2. RED/GREEN off-thread deferred navigation

**Files:** `src/navigation/navMesh.worker.ts`, a worker transport/helper and tests, `src/navigation/NavMeshManager.ts` and tests, `src/level/ProceduralBuilder.ts`, `src/level/LevelManager.ts` and tests, `src/core/types.ts`, `src/systems/DebugRuntimeSystem.ts` and tests.

1. Extract transformed nav geometry on the main thread, convert it once to transferable typed arrays, and send it to a module Worker.
2. Generate with navcat in the worker, return the structured-cloneable `NavMesh` plus measured worker generation time, terminate on success/error, and retain the synchronous `generate` API for non-browser/tests.
3. Build navigation meshes/obstacle colliders synchronously, then start async generation without awaiting it. Dispose the temporary geometry immediately after extraction.
4. On completion, apply the existing load-generation guard before creating agents/overlay. Hand resources to `LevelManager`; emit `navigation:ready` only after ownership is installed.
5. Refresh `DebugRuntimeSystem` references on readiness so deferred agents update and debug controls become available; unsubscribe on disposal.

### 3. RED/GREEN primitive collider and index-copy conversion

**Files:** `src/physics/ColliderFactory.ts` and test, `src/level/ProceduralBuilder.ts` and focused tests, `src/level/LevelManager.ts`, `src/core/KinemaDebugApi.ts`, `src/main.ts`, `tests/physics-verification.ts`.

1. Extend body-less fixed cuboids with optional rotation and add body-less fixed ball/cylinder helpers using world collision groups.
2. Convert rounded pedestal collision to its box envelope; rotated rough/slope boxes to rotated cuboids; step/stair/static-course boxes to cuboids; nav wall boxes/columns to cuboids/cylinders; and material sample boxes/spheres to cuboids/balls.
3. Preserve genuinely irregular/cut ramps and arbitrary imported geometry as trimeshes.
4. Replace boxed `Array.from(...).map(Number)` index handling with a typed `Uint32Array` copy/subarray while preserving incomplete-triangle warnings/truncation.
5. Expose deterministic collider totals grouped by Rapier shape name through the development debug API and assert the station-specific primitive floor in Playwright.

### 4. RED/GREEN dirty-only compatibility sanitization

**Files:** `src/renderer/RendererManager.ts` and test.

1. Remove the compatibility frame counter and modulo sweep.
2. Retain top-level child-count and explicit request triggers; preserve the existing `level:loaded` request for deep/late additions.
3. Prove 121 unchanged compatibility frames do not retraverse and an explicit request still does.

### 5. Timing evidence and verification

**Files:** `src/level/LevelManager.ts`, `src/core/KinemaDebugApi.ts`, browser specs, `docs/audits/evidence/kin029-load-physics-cost.md`, required screenshot.

1. Extend load stats with optional procedural build, worker nav generation, warmup, and Play-to-interactive fields without changing non-procedural callers.
2. Capture before/after three-run dev and production cold-load distributions on the same Chromium/SwiftShader host; report medians and individual values.
3. Capture steps/materials p95, VFX first-reveal maximum frame, collider shape counts, nav readiness time, and the loading-stage screenshot.
4. Verify default WebGPU renderer, forced WebGPU-on-WebGL2, compatibility, and `?warmup=0`; run physics, all-station screenshots, procedural suites serially, full units, TypeScript, build, scoped Biome, and repository lint comparison.
5. Request independent GPT-5.6 SOL review, fix any P0-P2 issue test-first, then commit the exact KIN-029 paths.

## Rollback And Risk Controls

- `?warmup=0` bypasses all explicit warmup and restores current reveal behavior.
- Each collider site can revert independently; browser slope/step contacts and shape counts gate the batch.
- Worker failures log once and leave navigation agents unavailable without failing level load; current-load generation prevents ghost resources.
- Deferred navigation is non-critical showcase behavior. No gameplay or player collision waits on it.
- No dependency, asset, test-config, bundle-size, or binary deletion changes belong to this task.
