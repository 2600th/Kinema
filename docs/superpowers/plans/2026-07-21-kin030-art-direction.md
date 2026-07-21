# KIN-030 Art-Direction Pass 1 Implementation Plan

> **Selection rule:** build and capture all three sky/fog candidates, then automatically select the strongest evidence-backed option under the user's standing instruction to choose recommended actions without pausing.

**Goal:** Replace the HDR-as-background look with a designed lab sky, improve corridor depth and edge language, add an entrance-visible end landmark, ground all procedural spawns, and prevent high-energy launches from clearing the hall boundary without changing IBL or station identities.

**Architecture:** A small renderer-owned art-direction module defines three named sky/fog profiles, resolves the optional `?sky=` capture override, builds a disposable vertical-gradient `DataTexture`, and applies fog/background independently from the PMREM environment. `applyEnvironmentTarget` updates only `scene.environment`, so HDR/RoomEnvironment lighting remains intact during environment changes. `LightingSystem` stops overwriting renderer-owned fog. Showcase constants own the grounded spawn height and 1.25m boundary height; `ProceduralBuilder` adds a dark apron, emissive inner-edge trim, and a fog-independent pylon assembled from existing procedural primitives.

## Candidate Set

1. **Dawn Slate (recommended):** stops at V `0 #35414f`, `0.44 #71808e`, `0.50 #8e99a6`, `0.56 #c58f78`, `0.72 #40536a`, `1 #111827`; fog `#8e99a6`, near 95, far 360. Best match for the existing warm key light and saturated station colors.
2. **Aurora Lab:** stops at V `0 #314a52`, `0.44 #66888a`, `0.50 #8fa9aa`, `0.56 #b8dccb`, `0.72 #245665`, `1 #071a2c`; fog `#8fa9aa`, near 110, far 400. Strongest sci-fi identity, with some risk of competing with cyan/green stations.
3. **Violet Dusk:** stops at V `0 #3e4051`, `0.44 #706d80`, `0.50 #918b9c`, `0.56 #c9868b`, `0.72 #59405f`, `1 #181129`; fog `#918b9c`, near 90, far 330. Most dramatic, with the highest risk of tinting the corridor too heavily.

All candidates retain environment intensity 0.68, background intensity 1, and background blurriness 0. Their near planes exceed the entrance-to-third-station distance, leaving at least two station signs unfogged. Only the pylon core and crown opt out of fog so the landmark remains visible from the entrance without flattening the pylon's depth.

## Commit 1 - Record the contract and baseline

1. Persist this plan and the ignored active todo.
2. Match the KIN-001 harness exactly: capture current entrance p95 from three fresh headed hardware-WebGPU Chromium launches at 1920x1080/DPR1 with 600-frame windows, and retain a baseline entrance screenshot. Compare median p95 before/after and enforce no more than +5%.
3. Independently review the plan with GPT-5.6 SOL.
4. Commit only this tracked plan.

## Candidate Worktree - Implement test-first

### 1. RED/GREEN renderer background and fog ownership

**Files:** `src/renderer/showcaseArtDirection.ts` and tests, `src/renderer/rendererSceneState.ts` and tests, `src/renderer/rendererState.ts` and tests, `src/renderer/RendererManager.ts`, `src/level/LightingSystem.ts` and tests, `src/ui/components/DebugPanel.ts` and tests, `src/main.ts`.

1. Test the three exact profiles, default/override resolution, gradient interpolation, and independent environment/background ownership.
2. Apply a 512x256 sRGB `DataTexture` with `EquirectangularReflectionMapping`, linear filtering, no mipmaps, and zero background blur on all renderer paths. This produces a world-locked horizon while keeping PMREM exclusively in `scene.environment`.
3. Apply the selected fog values once from renderer-owned profile state; prove level lighting does not replace them.
4. Dispose replaced sky textures, add the stable profile identifier to `RendererDebugFlags`, stop environment rotation from mutating `backgroundRotation`, and correct the DebugPanel labels/descriptions so HDR controls describe lighting only.

### 2. RED/GREEN corridor safety, edge treatment, landmark, and spawn

**Files:** `src/level/ShowcaseLayout.ts` and tests, `src/level/ProceduralBuilder.ts` and tests, debug API only if deterministic launch proof needs a velocity hook.

1. Export the grounded procedural spawn height and use it for full and isolated station spawns.
2. Raise corridor boundaries to 1.25m, darken their apron material, and add thin emissive trim along the inner top edge. Reuse the perimeter treatment around the minimal station floor so isolated station captures also have no raw floor/void seam.
3. Add a tall named end pylon at `futureA`, reusing dark/emissive procedural materials and simple cylinder/ring/lamp geometry; keep station colors unchanged.
4. Add deterministic object-state assertions and write the launch test RED-first: pre-arm maximum movement toward the nearest hall edge, release the non-embedded capsule 1cm above `BoostPlatformStatic`, and hold movement through the real 6x auto-bounce arc. Capture motion at fixed-step rate to prove launch velocity exceeds 20m/s and the apex exceeds 2m, sample through stopped wall contact, assert the player center never crosses the wall's outer face, and finish grounded without fall damage. Adjust rail geometry only from observed failure evidence.

### 3. Browser capture and approval gate

1. Capture 1920x1080 entrance images for `dawn`, `aurora`, and `dusk` on installed Chrome/WebGPU, plus compatibility spot checks.
2. Verify two station signs and the end landmark are visible, the floor/void seam is treated in full and isolated station captures, and the initial player pose is grounded on the first interactive frame.
3. Compare the three captures, automatically select the strongest direction (initial recommendation: **Dawn Slate**), record the decision, and continue without a manual prompt.

## Final Verification And Commit

1. Lock the approved profile as default and remove or retain the capture override according to its test/debug value.
2. Regenerate KIN-004 visual anchors and the full entrance/overview/all-stations evidence gallery.
3. Run targeted units, TypeScript, build, scoped Biome, repository lint comparison, entrance p95 (must remain within +5%), the scripted launch, station screenshots, procedural review, all renderer paths, then the full required suite twice serially at final closure.
4. Request strict GPT-5.6 SOL review and commit only KIN-030 paths/evidence.

## Risks And Rollback

- World-locked equirectangular gradient support is verified on true WebGPU, WebGPU-on-WebGL2, and WebGLRenderer; a solid-color background remains the fail-safe.
- Environment switches must never replace the gradient or change PMREM lighting response.
- The higher wall may affect camera or vehicle exits near `x=+-29.5`; existing vehicle wall-exit coverage, the updated formerly-`<1m` review assertion, and the new launch test gate it.
- Existing `+1` station-spawn Y overrides for `platformsMoving` and `platformsPhysics` are normalized when the grounded base is adopted, then guarded with first-interactive-frame assertions rather than a post-settle-only check.
- The profile table, boundary height, trim geometry, and pylon group are isolated constants/constructions and can be reverted independently.

## Recorded Baseline And Review

- Matched KIN-001 entrance baseline, headed true WebGPU at 1920x1080/DPR1, balanced profile, fresh launch per 600-frame window: p95 `19.9ms`, `19.9ms`, `19.7ms`; median `19.9ms`. The post-change median gate is therefore `<=20.895ms` (+5%). All three runs reported `WebGPU` and zero console/page errors.
- The fixed before capture is retained as `docs/audits/evidence/kin030-before-entrance.png` for the final evidence commit, not the plan-only commit.
- Independent GPT-5.6 SOL plan verdict: **YES**; no P0-P2 planning blockers remain after the harness, renderer ownership, mapping, isolated-edge, spawn, debug, pylon-fog, and deterministic-launch contracts were corrected.
