# KIN-001 frame and station-load baseline

Captured 2026-07-17 on the Vite development server. This is a single-machine,
true-WebGPU baseline for comparing later Kinema changes; it is not a production
hardware target.

## Environment

| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26200 (build 26200) |
| CPU | AMD Ryzen 7 9800X3D, 8 cores / 16 logical processors |
| GPU | NVIDIA GeForce RTX 5090, driver 32.0.16.1062 |
| Memory | 31.0 GiB |
| Browser | Playwright Chromium 147.0.7727.15, headed |
| Viewport | 1920 x 1080 at device scale factor 1 |
| Renderer | Default path, `WebGPU`; no compatibility override |
| Server | Vite development server at `127.0.0.1:5173` |
| Display cadence observed | 120 Hz (steady-state p50 about 8.3 ms) |

Chromium was launched with hardware WebGPU enabled, GPU rasterization enabled,
and the GPU blocklist ignored. The runtime debug flags reported `WebGPU`, and the
captured panel shows the same backend.

## Method

Each cell is `load / p50 / p95 / max / long`, in milliseconds except `long`,
which is the number of samples above 33.4 ms. Every route was opened in a fresh
browser context, waited for `getLastLoadStats()` to name the expected station,
then sampled only after `getFrameStats().samples === 600`. Load time is measured
inside `LevelManager`; frame values are the rolling 600-render-frame window.

The maximum and long-frame count include station startup/reveal work immediately
after the level-load reset. They are therefore useful hitch signals, while p50 and
p95 describe the steady cadence.

## Station matrix

| Station | Performance | Balanced | Cinematic |
|---|---:|---:|---:|
| steps | 245.4 / 8.3 / 8.4 / 591.7 / 3 | 317.8 / 8.3 / 8.4 / 1,233.8 / 3 | 615.3 / 8.3 / 8.4 / 1,267.0 / 4 |
| slopes | 268.9 / 8.3 / 8.4 / 333.4 / 4 | 288.4 / 8.3 / 8.4 / 399.9 / 3 | 489.9 / 8.3 / 8.4 / 516.7 / 4 |
| movement | 243.6 / 8.3 / 8.4 / 491.7 / 3 | 292.6 / 8.3 / 8.4 / 466.6 / 3 | 568.5 / 8.3 / 8.4 / 500.0 / 6 |
| doubleJump | 251.7 / 8.3 / 8.4 / 399.9 / 3 | 299.1 / 8.3 / 8.4 / 283.4 / 4 | 111.0 / 8.3 / 8.4 / 541.7 / 4 |
| grab | 240.8 / 8.3 / 8.4 / 408.4 / 3 | 358.2 / 8.3 / 8.4 / 408.3 / 3 | 221.0 / 8.3 / 8.4 / 558.6 / 4 |
| throw | 342.3 / 8.3 / 8.5 / 549.9 / 4 | 387.0 / 8.3 / 8.5 / 850.0 / 4 | 497.5 / 8.3 / 8.4 / 1,267.0 / 3 |
| door | 270.4 / 8.3 / 8.4 / 400.0 / 4 | 470.1 / 8.3 / 8.4 / 424.9 / 5 | 737.3 / 8.3 / 8.4 / 900.3 / 3 |
| vehicles | 835.8 / 8.3 / 8.4 / 883.8 / 4 | 688.9 / 8.3 / 8.4 / 683.5 / 3 | 574.4 / 8.3 / 8.4 / 1,375.3 / 4 |
| platformsMoving | 438.2 / 8.3 / 8.4 / 633.4 / 3 | 585.0 / 8.3 / 8.4 / 691.6 / 3 | 648.3 / 8.3 / 8.5 / 1,050.4 / 3 |
| platformsPhysics | 430.9 / 8.3 / 8.4 / 583.3 / 3 | 503.1 / 8.3 / 8.4 / 666.6 / 3 | 720.1 / 8.3 / 8.4 / 883.7 / 3 |
| materials | 420.3 / 8.3 / 8.4 / 1,308.7 / 3 | 562.4 / 8.3 / 8.4 / 1,533.6 / 3 | 683.4 / 8.3 / 8.4 / 1,383.6 / 4 |
| vfx | 582.8 / 8.3 / 8.4 / 5,651.1 / 4 | 892.3 / 8.3 / 8.4 / 3,517.1 / 5 | 681.9 / 8.3 / 8.4 / 4,317.8 / 5 |
| navigation | 916.0 / 8.3 / 8.4 / 775.0 / 3 | 633.5 / 8.3 / 8.4 / 766.7 / 4 | 839.4 / 8.3 / 8.4 / 716.7 / 3 |
| futureA | 420.3 / 8.3 / 8.4 / 583.3 / 3 | 491.7 / 8.3 / 8.4 / 666.6 / 3 | 649.7 / 8.3 / 8.4 / 908.6 / 3 |

Three points initially timed out while the long-lived harness had accumulated
browser/GPU process state: balanced `movement`, balanced `platformsPhysics`, and
cinematic `futureA`. Each passed without console or page errors when remeasured in
its own fresh Chromium launch; the successful retries are the values above.

## Showcase, reset, and instrumentation checks

- Balanced showcase load: 826.9 ms. Its captured 600-frame window was p50 8.4 ms,
  p95 16.8 ms, max 7,193.4 ms, with 7 long frames. The trace and open DebugPanel
  add observer load, so the station matrix is the comparison baseline.
- Reset probe: immediately after the procedural load and after loading the VFX
  station, the sample count was 1; both subsequently reached exactly 600. This
  confirms that load events clear the previous window.
- Ring-write microbenchmark: seven runs of 5,000,000 Float32Array writes produced
  a median amortized cost of 0.00000228 ms/write, below the 0.05 ms/frame budget.
- A 30.1 s allocation-sampling profile (4 KiB sampling interval) observed 498.4 MB
  of app-wide sampled allocations. Only one 4.1 KiB statistical sample was
  attributed to the `GameLoop.tick` declaration across the entire interval; there
  was no recurring allocation site in the new ring-write statements. Source
  inspection confirms that the per-frame path performs one typed-array write and
  scalar cursor/count updates. `getFrameStats()` intentionally allocates only when
  queried (the debug cache queries at 4 Hz), not once per rendered frame.
- The broader 31.6 s DevTools trace contained 211 minor and 5 major app-wide GC
  cycles (184.3 ms combined top-level duration). This existing runtime churn means
  the trace cannot honestly be described as globally GC-free; the allocation
  sample and hot-path inspection isolate the instrumentation-specific conclusion.

Raw trace and harness JSON are retained as workspace-local `.superpowers/sdd/`
artifacts and are intentionally not committed. The visual evidence is
[20-frame-stats-debug-panel-webgpu.png](./20-frame-stats-debug-panel-webgpu.png).

## KIN-022 editor transform proof

Captured 2026-07-20 with the same headed Chromium 147 hardware-WebGPU launch
recipe and 1920 x 1080 viewport as the baseline above. The runtime reported the
true `WebGPU` backend. Each transform used a fresh browser context, the same
authored root -> child -> grandchild plus sibling fixture, and five real gizmo
drags. The fixture has two static cube colliders whose effective scale changes
when the root is scaled; its two group nodes have no colliders.

Each result is a rolling 600-render-frame window after the station/editor load
and five transform repetitions. As in the station matrix, `max` and `long`
include startup and authored-level load work, so they are hitch observations,
not steady-state transform costs.

| Transform | p50 (ms) | p95 (ms) | max (ms) | long frames | Preview delta per drag (pose/build/replace) | Release delta per drag (pose/build/replace) |
|---|---:|---:|---:|---:|---:|---:|
| Translate | 8.3 | 8.5 | 433.3 | 5 | 16 / 0 / 0 | 20 / 0 / 0 |
| Rotate | 8.3 | 8.5 | 808.4 | 4 | 16 / 0 / 0 | 20 / 0 / 0 |
| Scale | 8.3 | 8.4 | 574.9 | 4 | 16 / 0 / 0 | 20 / 2 / 2 |

All five repetitions produced the same counter deltas shown in the table.
Translation and rotation therefore performed no collider descriptor builds or
replacements during preview or release. Scale performed none during preview and
replaced exactly the two affected effective-scale colliders on every release.
The serial Playwright correctness run separately reported `WebGPU (WebGL2
backend)` under SwiftShader; those headless timings are intentionally excluded
from this representative hardware table. Raw results are retained in
`.superpowers/sdd/kin022-hardware-results.json`.
