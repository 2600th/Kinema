# KIN-030 Art-Direction Evidence

Date: 2026-07-21

## Decision

**Dawn Slate** is the default showcase direction. The user authorized automatic selection of the strongest recommended option, so the three candidates were compared without a manual approval pause.

| Candidate | Evidence | Decision |
|---|---|---|
| Dawn Slate | [1920x1080 true-WebGPU capture](./kin030-candidate-dawn.png) | Selected: its warm horizon supports the existing key light, keeps the station palette distinct, and gives the slate perimeter and end beacon the clearest hierarchy. |
| Aurora Lab | [1920x1080 true-WebGPU capture](./kin030-candidate-aurora.png) | Rejected: the cyan-green wash reduces separation from the floor and several station colors. |
| Violet Dusk | [1920x1080 true-WebGPU capture](./kin030-candidate-dusk.png) | Rejected: the magenta bias competes with the station accents and makes the corridor less neutral. |

The [pre-change entrance](./kin030-before-entrance.png) is retained for comparison. Dawn keeps PMREM IBL in `scene.environment`; the renderer-owned gradient is `scene.background` only.

## Entrance And Renderer Paths

- Hardware WebGPU full showcase: [selected Dawn entrance](./kin030-candidate-dawn.png) — `activeBackend: WebGPU`, profile `performance`, art direction `dawn`, zero captured console/page errors.
- WebGPURenderer on WebGL2 isolated Steps bay: [path capture](./kin030-dawn-webgpu-webgl2.png) — `activeBackend: WebGPU (WebGL2 backend)`, art direction `dawn`, zero captured errors.
- Compatibility WebGLRenderer isolated Steps bay: [path capture](./kin030-dawn-compat-webgl.png) — `activeBackend: WebGLRenderer`, art direction `dawn`, zero captured errors.

The forced WebGPU-on-WebGL2 full showcase was also diagnosed: the backend and Dawn profile initialized correctly and the procedural builder reported `67,369.5ms`, but the complete world startup exceeded the 120-second capture budget without a page error. The renderer-path visual spot check therefore uses the established isolated-station parity pattern; the full showcase evidence uses hardware WebGPU.

The entrance capture shows the primary Steps sign, the alternating Slopes wayfinding sign, the slate perimeter with emissive inner trim, and the fog-independent crown of `ShowcaseEndLandmark` above the main sightline.

## Full Showcase Review Set

The 17-view hardware-WebGPU gallery was captured at 1920x1080/DPR1 with Dawn active and zero console/page errors:

1. [Entrance](./kin030-review/01-entrance.png)
2. [Mid-corridor overview](./kin030-review/02-overviewMid.png)
3. [Steps](./kin030-review/03-steps.png)
4. [Slopes](./kin030-review/04-slopes.png)
5. [Movement](./kin030-review/05-movement.png)
6. [Double jump](./kin030-review/06-doubleJump.png)
7. [Grab](./kin030-review/07-grab.png)
8. [Throw](./kin030-review/08-throw.png)
9. [Door](./kin030-review/09-door.png)
10. [Vehicles](./kin030-review/10-vehicles.png)
11. [Moving platforms](./kin030-review/11-platformsMoving.png)
12. [Physics platforms](./kin030-review/12-platformsPhysics.png)
13. [Materials](./kin030-review/13-materials.png)
14. [VFX](./kin030-review/14-vfx.png)
15. [Navigation](./kin030-review/15-navigation.png)
16. [Future lab and end landmark](./kin030-review/16-futureA.png)
17. [End overview](./kin030-review/17-overviewEnd.png)

## Performance

Matched KIN-001 harness: three fresh headed Chrome launches, hardware WebGPU, 1920x1080/DPR1, balanced profile, entrance spawn, and a reset 600-frame measurement window.

| Measure | Before | After |
|---|---:|---:|
| Run p95 values | 19.9, 19.9, 19.7ms | 19.4, 19.1, 19.0ms |
| Median p95 | 19.9ms | 19.1ms |
| Allowed ceiling | — | 20.895ms |
| Browser errors | 0 | 0 |

The post-change median is 4.0% below the baseline and 8.6% below the fixed +5% ceiling.

## Spawn, Perimeter, Landmark, And Launch Proof

- Full and isolated station spawns share `SHOWCASE_GROUNDED_SPAWN_Y = -0.35`; the procedural browser review checks every reusable spawn after grounded readiness.
- Full-showcase and isolated-station floors share the named 1.25m perimeter treatment and emissive inner trim. The isolated floor is 50m deep, leaving 10.5m between the furthest spawn and entrance rail versus the 7.7m maximum camera-boom requirement; all 14 station checks assert both player and camera begin inside that rail.
- `ShowcaseEndLandmark` is placed in the Future Lab bay. Its full object bounds exceed 20m width and 65m height; only its core and crown opt out of fog.
- The real six-times boost launch pre-arms maximum lateral movement before teleport, then releases the capsule 1cm above its non-embedded standing extent (`0.66m` above the pad top) so gravity establishes the pad contact. Fixed-step telemetry observed approximately `34.17m/s` upward velocity and a `2.35m` apex. The player stopped grounded against the left boundary at approximately `x=-29.23`, never moved its center beyond the wall's outer face, and retained all three health points. The final telemetry-backed setup passed four consecutive serial executions (a three-run repetition plus one fresh final run).

## Verification Record

- Unit suite: 95 files, 770 tests passed.
- TypeScript: `npx tsc` passed.
- Production build: `npm run build` passed.
- Scoped Biome: 29 changed TypeScript files checked with zero errors; baseline warnings remain.
- Repository lint comparison: baseline remains non-clean; current run reports 118 errors, 275 warnings, and 11 infos across 293 files.
- Procedural review: 1/1 passed after the landmark-width RED/GREEN assertion.
- Station and camera-clearance matrix: 16/16 passed across all isolated stations, compatibility navigation, and the full showcase.
- Visual baseline regeneration: 9/9 passed while updating the intentional KIN-004 anchors after final isolated-floor sizing.
- Targeted browser stabilization: the complete beacon input/lifecycle file passed 6/6; the real throw and horizontal-drone-motion cases passed 3/3 each in repeated fresh contexts.
- Final serial browser suites: 118/118 passed twice with one worker (`3,989.3s` and `4,080.2s`).
- Independent GPT-5.6 SOL review: **Ready YES** after the final keyboard, touch-event, horizontal-drone, and physics-throw stabilization changes; no remaining actionable findings.
