# KIN-026 VFX Density and Vehicle Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan test-first and request an independent review before landing.

**Goal:** Scale ambient VFX predictably by graphics profile, cull corridor sparkles by player distance, add pooled grounded vehicle dust/skid/boost motion effects on every renderer path, and close the cited VFX allocation/resource leaks.

**Architecture:** A new core `vfxProfile` module owns the exact performance `0.35`, balanced `0.65`, and cinematic `1.0` density multipliers plus deterministic count scaling. `LevelManager` snapshots the selected profile into each new `ProceduralBuilder`; existing live effects intentionally retain their build density until the next load. Ambient counts are recorded in a typed debug state. Corridor sparkles become four independently culled regions driven by the existing player-position update already sent to `LevelManager`. `CarController` exposes four allocation-stable optional wheel-contact positions through the existing handling state. `ParticleSystem` retains handling/boost state and advances dedicated vehicle pools by `dt`, keeping the seven gameplay-feedback pools full-density. Aborted VFX showcases self-dispose idempotently, while accepted roots remain solely owned by `LevelManager` to prevent double disposal.

**Tech Stack:** TypeScript 5.9, Three.js, Rapier, Vitest 4, Playwright, Biome, Vite 8.

## Behavior Contract

- `getVfxDensity()` returns exactly `0.35`, `0.65`, and `1.0`; cinematic authored counts remain byte-for-byte equivalent.
- Sparkles (400), motes (60), grass (400 per strip), rain (200), embers (40), and orbit points (100) scale at build time with deterministic rounding and a minimum of one for an enabled effect.
- The scaled sparkle total is distributed across exactly four Z regions without losing remainder. Distant regions are hidden and skip CPU updates; visible regions retain ordinary Three.js frustum culling.
- Grounded moving cars emit dust proportional to speed. Meaningful drift/handbrake emits skid smoke. Held boost emits a short additive trail. Airborne, stationary, exited, or reset vehicles stop sustained emission.
- Vehicle emissions use dedicated `MeshBasicMaterial` particle pools and current profile density, so sustained driving cannot starve jump, landing, coin, damage, or objective feedback.
- Existing entry/exit dust and all seven gameplay-feedback pools keep their current full-density counts.
- VFX abort/failure disposal releases owned geometries, materials, textures, instancing buffers, and roots exactly once; accepted level roots are disposed only by `LevelManager`.
- Profile changes affect ambient counts on the next level load; no in-place rebuild is introduced.

---

### Task 1: RED density and profile-plumbing contracts

**Files:**
- Create: `src/core/vfxProfile.test.ts`
- Modify: `src/level/LevelManager.test.ts`
- Create: `src/level/ProceduralBuilder.vfx.test.ts` or extend the nearest focused builder contract

- [ ] Assert exact density values and deterministic scaled counts.
- [ ] Assert cinematic preserves authored counts and all enabled effects retain at least one item.
- [ ] Assert `LevelManager` stores the selected profile before a procedural build and live switches do not mutate the current build state.
- [ ] Run the focused tests and preserve the expected RED result.

### Task 2: Implement ambient density and four-region sparkle culling

**Files:**
- Create: `src/core/vfxProfile.ts`
- Modify: `src/level/LevelManager.ts`
- Modify: `src/level/ProceduralBuilder.ts`
- Modify: `src/level/SparkleParticles.ts`
- Create: `src/level/SparkleParticles.test.ts`
- Modify: `src/level/VfxShowcase.ts`

- [ ] Thread the build profile from `LevelManager` to `ProceduralBuilder` and `VfxShowcase`.
- [ ] Scale only the six listed ambient count domains; leave gameplay burst pools unchanged.
- [ ] Split sparkles into four exact-total regions, enable frustum culling, and apply explicit player-Z visibility with hidden-region update suppression.
- [ ] Expose configured and visible ambient counts through a typed level debug state.
- [ ] Turn density/culling tests GREEN and prove cinematic counts remain unchanged.

### Task 3: RED vehicle-contact and sustained-particle contracts

**Files:**
- Modify: `src/vehicle/CarController.test.ts`
- Modify: `src/systems/ParticleSystem.test.ts`
- Create: `src/juice/GameParticles.test.ts`
- Modify: `src/juice/ParticlePool.test.ts` or add a focused getter contract beside it

- [ ] Assert four persistent wheel-contact slots report world positions without per-call vector/array allocation.
- [ ] Assert stationary and airborne states emit no motion particles.
- [ ] Assert grounded speed scales dust, drift/handbrake scales skid smoke, held boost emits additive trail, and release/exit clears sustained state.
- [ ] Assert performance emits materially fewer vehicle particles than cinematic while existing gameplay burst counts are unchanged.
- [ ] Preserve the expected RED result before implementation.

### Task 4: Implement vehicle VFX, debug state, and resource hygiene

**Files:**
- Modify: `src/vehicle/VehicleController.ts`
- Modify: `src/vehicle/CarController.ts`
- Modify: `src/vehicle/VehicleManager.ts`
- Modify: `src/core/types.ts`
- Modify: `src/juice/ParticlePool.ts`
- Modify: `src/juice/GameParticles.ts`
- Modify: `src/systems/ParticleSystem.ts`
- Modify: `src/Game.ts`
- Modify: `src/core/KinemaDebugApi.ts`
- Modify: `src/main.ts`
- Modify: `src/level/VfxShowcase.ts`
- Modify: `src/level/ProceduralBuilder.ts`
- Add/modify focused resource-lifetime tests

- [ ] Update persistent wheel-contact vectors from the chassis pose, suspension length, and wheel radius.
- [ ] Advance dedicated vehicle dust/skid/boost pools from retained handling state using render `dt` and current profile density.
- [ ] Add deterministic configured/visible/emitted particle debug counters without exposing mutable Three.js objects.
- [ ] Remove the unused rain-geometry clone and hoist the billboard world-position scratch vector.
- [ ] Make VFX abort/failure disposal idempotent and self-sufficient; keep accepted-root disposal under `LevelManager` alone.
- [ ] Turn all focused contracts GREEN.

### Task 5: Browser proof, performance evidence, review, and landing

**Files:**
- Modify: `tests/vfx-particles.ts`
- Modify: `tests/vehicle-controllers.ts`
- Modify: `docs/audits/evidence/frame-baseline.md`
- Update ignored state/evidence: `tasks/todo.md`, `.superpowers/sdd/progress.md`, `output/kin026/`

- [ ] Compare fresh performance/cinematic VFX-station contexts: assert deterministic count reduction, record frame stats without a flaky strict p95 delta, and capture both profiles.
- [ ] Drive the car until motion particles are active on default, WebGPURenderer-WebGL, and compat WebGL paths; capture default and compat dust/boost evidence.
- [ ] Exercise drift and boost with keyboard input; assert particles cease after exit and gameplay-feedback pools remain available.
- [ ] Run three VFX station load/dispose cycles and record renderer-memory/heap observations with the environment and limitations.
- [ ] Run focused/full units, TypeScript, touched-file Biome error diagnostics, build, visual anchors, and serial Playwright checks.
- [ ] Inspect all required screenshots, update the KIN-001 baseline addendum, request independent GPT-5.6 SOL review, address findings test-first, and create detailed commits.

## Verification Notes

- The committed RTX 5090 KIN-001 direct-station baseline is cadence-limited near 8.4 ms p95 for every profile. Automated acceptance therefore gates exact active-count reduction and p95 non-regression; a strict relative p95 improvement would be statistically dishonest and flaky.
- SwiftShader verifies WebGPURenderer-on-WebGL2 and compat behavior, not hardware WebGPU. Use the existing headed hardware-Chromium recipe for the true-WebGPU capture and label any unavailable hardware check explicitly.
- Official Three.js guidance requires explicit disposal of geometries, materials, and textures; removing an object from the scene is insufficient. `frustumCulled` only opts an object into view-frustum culling, so explicit corridor-distance visibility remains necessary.
