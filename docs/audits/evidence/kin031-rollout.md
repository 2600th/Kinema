# KIN-031 Rollout Evidence

- Date: 2026-07-22
- Branch: `experimental/audit-fixes`
- Hardware browser: installed headed Chrome `150.0.7871.129`
- Hardware viewport: 1920 x 1080, DPR 1
- Hardware renderer: true `WebGPU` for the 17-view gallery and 14-bay balanced measurements
- Automated browser renderer: Playwright Chromium/SwiftShader (`WebGPU (WebGL2 backend)` for default and forced-WebGPU-WebGL2; `WebGLRenderer` for compatibility)
- Server: Vite development server at `127.0.0.1:5173`

This is single-machine development-build evidence, not certification for all browsers or hardware.

## Before/After Gallery

All after images were captured in a fresh installed-Chrome context with the balanced profile and true WebGPU. The 17 after images and the two renderer-path spot images were visually inspected: signs were readable, the steps/slopes markers and grab target were visible, the reserved bay was honest, and no new clipping or HUD overlap was observed.

| # | View | KIN-030 before | KIN-031 after |
|---:|---|---|---|
| 01 | Entrance | [before](./kin030-review/01-entrance.png) | [after](./kin031-review/01-entrance.png) |
| 02 | Mid overview | [before](./kin030-review/02-overviewMid.png) | [after](./kin031-review/02-overviewMid.png) |
| 03 | Steps | [before](./kin030-review/03-steps.png) | [after](./kin031-review/03-steps.png) |
| 04 | Slopes | [before](./kin030-review/04-slopes.png) | [after](./kin031-review/04-slopes.png) |
| 05 | Movement | [before](./kin030-review/05-movement.png) | [after](./kin031-review/05-movement.png) |
| 06 | Double jump | [before](./kin030-review/06-doubleJump.png) | [after](./kin031-review/06-doubleJump.png) |
| 07 | Grab | [before](./kin030-review/07-grab.png) | [after](./kin031-review/07-grab.png) |
| 08 | Throw | [before](./kin030-review/08-throw.png) | [after](./kin031-review/08-throw.png) |
| 09 | Door | [before](./kin030-review/09-door.png) | [after](./kin031-review/09-door.png) |
| 10 | Vehicles | [before](./kin030-review/10-vehicles.png) | [after](./kin031-review/10-vehicles.png) |
| 11 | Moving platforms | [before](./kin030-review/11-platformsMoving.png) | [after](./kin031-review/11-platformsMoving.png) |
| 12 | Physics platforms | [before](./kin030-review/12-platformsPhysics.png) | [after](./kin031-review/12-platformsPhysics.png) |
| 13 | Materials | [before](./kin030-review/13-materials.png) | [after](./kin031-review/13-materials.png) |
| 14 | VFX | [before](./kin030-review/14-vfx.png) | [after](./kin031-review/14-vfx.png) |
| 15 | Navigation | [before](./kin030-review/15-navigation.png) | [after](./kin031-review/15-navigation.png) |
| 16 | Future lab | [before](./kin030-review/16-futureA.png) | [after](./kin031-review/16-futureA.png) |
| 17 | End overview | [before](./kin030-review/17-overviewEnd.png) | [after](./kin031-review/17-overviewEnd.png) |

Renderer-honesty spot checks: [WebGPURenderer on WebGL2](./kin031-review/renderer-webgpu-webgl2-vfx.png) and [compatibility WebGLRenderer](./kin031-review/renderer-compat-vfx.png).

## 14-Bay Checklist

`PASS` means the production behavior was asserted by the rollout spec, existing focused browser coverage, or inspected hardware evidence. `N/A` means the bay deliberately has no such contract; it is not an omitted check.

| Bay | Approach sign | Input guidance | Interaction/result | Audio/VFX confirmation | Reset/replay | Renderer honesty | Coins/reachability | Balanced p95 |
|---|---|---|---|---|---|---|---|---|
| Steps | PASS | PASS: jump cue | PASS: traversable vs too-tall contrast | N/A | N/A | PASS | PASS | PASS |
| Slopes | PASS | N/A | PASS: rejection lane and marker | N/A | N/A | PASS | PASS | PASS |
| Movement | PASS | PASS | PASS: ladder/crouch/rope | PASS | N/A | PASS | PASS | PASS |
| Double jump | PASS | PASS | PASS: ascending platform/coin route | PASS | N/A | PASS | PASS | PASS |
| Grab | PASS | PASS | PASS: real-body delivery objective | PASS | PASS: cube and target restore | PASS | PASS | PASS |
| Throw | PASS | PASS: source-aware | PASS: four real throws | PASS | PASS: pool refill/reuse | PASS | PASS | PASS |
| Door | PASS | PASS: three sources | PASS: open/close and checkpoint | PASS | PASS | PASS | PASS | PASS |
| Vehicles | PASS | PASS: car/drone source-aware | PASS: car and drone entry/exit | PASS | PASS: canonical transform restore | PASS | PASS | PASS |
| Moving platforms | PASS | N/A | PASS: repeated displacement | N/A | PASS: cyclic motion | PASS | PASS: static sampled coin | PASS |
| Physics platforms | PASS | N/A | PASS: real boost launch | PASS | PASS: pad reusable | PASS | PASS | PASS |
| Materials | PASS | N/A | N/A: passive exhibit | N/A | N/A | PASS: no primitive-shaped trimeshes | PASS | PASS |
| VFX | PASS | N/A | N/A: passive exhibit | N/A | N/A | PASS: path-specific truthful sign/counts | PASS | PASS |
| Navigation | PASS | N/A | N/A: passive crowd exhibit | N/A | N/A | PASS | PASS: five agents move | PASS |
| Future lab | PASS: Reserved / Future demos | N/A | N/A: reserved | N/A | N/A | PASS | N/A: intentionally zero collectibles | PASS |

Every active-bay coin was checked for floor support/clearance. A real movement-based collection sample was used per active bay; the moving-platform sample was deliberately changed to static `platformsMoving-coin-4` so the test does not pass because a platform carries a coin into the player during setup. The back-half `showcase-checkpoint-back` also activated at the VFX/navigation transition.

## Renderer / Profile / Input Matrix

Each renderer boot exercised all nine profile/input cells without reloading between cells. Every cell checked the production input source, renderer/profile badge, door action/reset, steps/movement traversal setup, and the exact selected VFX profile target (`1120`, `2080`, or `3200` configured instances).

| Renderer route | Profile | Input | Result |
|---|---|---|---|
| default | performance | keyboard | PASS |
| default | performance | gamepad | PASS |
| default | performance | touch | PASS |
| default | balanced | keyboard | PASS |
| default | balanced | gamepad | PASS |
| default | balanced | touch | PASS |
| default | cinematic | keyboard | PASS |
| default | cinematic | gamepad | PASS |
| default | cinematic | touch | PASS |
| forced WebGPU/WebGL2 | performance | keyboard | PASS |
| forced WebGPU/WebGL2 | performance | gamepad | PASS |
| forced WebGPU/WebGL2 | performance | touch | PASS |
| forced WebGPU/WebGL2 | balanced | keyboard | PASS |
| forced WebGPU/WebGL2 | balanced | gamepad | PASS |
| forced WebGPU/WebGL2 | balanced | touch | PASS |
| forced WebGPU/WebGL2 | cinematic | keyboard | PASS |
| forced WebGPU/WebGL2 | cinematic | gamepad | PASS |
| forced WebGPU/WebGL2 | cinematic | touch | PASS |
| compatibility WebGL | performance | keyboard | PASS |
| compatibility WebGL | performance | gamepad | PASS |
| compatibility WebGL | performance | touch | PASS |
| compatibility WebGL | balanced | keyboard | PASS |
| compatibility WebGL | balanced | gamepad | PASS |
| compatibility WebGL | balanced | touch | PASS |
| compatibility WebGL | cinematic | keyboard | PASS |
| compatibility WebGL | cinematic | gamepad | PASS |
| compatibility WebGL | cinematic | touch | PASS |

Two consecutive serial runs passed all three renderer cases:

| Run | Default | Forced WebGPU/WebGL2 | Compatibility WebGL | Total |
|---|---:|---:|---:|---:|
| A | 11.8 min | 6.0 min | 6.7 min | 25.0 min |
| B | 11.7 min | 6.3 min | 7.1 min | 25.6 min |

## Installed-Chrome Hardware Measurements

Each station measurement is a fresh isolated station, balanced profile, true WebGPU, and a reset 600-frame window. The allowed threshold is matched KIN-001 p95 x 1.10 + 2 ms (`11.24ms`, or `11.35ms` for Throw).

| Bay | Load ms | p50 ms | p95 ms | Allowed ms | Result |
|---|---:|---:|---:|---:|---|
| Steps | 348.5 | 9.6 | 10.1 | 11.24 | PASS |
| Slopes | 342.4 | 9.6 | 10.1 | 11.24 | PASS |
| Movement | 287.6 | 9.7 | 10.1 | 11.24 | PASS |
| Double jump | 327.8 | 9.5 | 10.1 | 11.24 | PASS |
| Grab | 353.7 | 9.5 | 10.1 | 11.24 | PASS |
| Throw | 351.2 | 9.6 | 10.1 | 11.35 | PASS |
| Door | 404.7 | 9.6 | 10.1 | 11.24 | PASS |
| Vehicles | 371.0 | 9.6 | 10.1 | 11.24 | PASS |
| Moving platforms | 355.1 | 9.6 | 10.1 | 11.24 | PASS |
| Physics platforms | 414.5 | 9.6 | 10.1 | 11.24 | PASS |
| Materials | 413.4 | 9.6 | 10.1 | 11.24 | PASS |
| VFX | 463.2 | 9.6 | 10.1 | 11.24 | PASS |
| Navigation | 348.3 | 9.7 | 10.1 | 11.24 | PASS |
| Future lab | 554.8 | 9.6 | 10.1 | 11.24 | PASS |

The 36-cell hardware spot matrix below reports `p95 ms / load ms` for four scenes. Software-backend full-showcase load times are development-machine observations, not production budgets.

| Renderer | Profile | Entrance | Vehicles | VFX | Navigation |
|---|---|---:|---:|---:|---:|
| WebGPU | performance | 10.2 / 395.7 | 10.1 / 389.7 | 10.1 / 346.0 | 10.1 / 395.9 |
| WebGPU | balanced | 12.2 / 1112.9 | 10.1 / 426.4 | 10.1 / 465.6 | 10.1 / 429.8 |
| WebGPU | cinematic | 20.1 / 671.4 | 10.1 / 561.2 | 10.1 / 854.9 | 10.1 / 462.7 |
| WebGPU on WebGL2 | performance | 20.1 / 29597.4 | 10.1 / 992.8 | 10.1 / 4662.4 | 10.1 / 355.8 |
| WebGPU on WebGL2 | balanced | 38.4 / 63893.1 | 10.1 / 1631.1 | 10.1 / 7903.6 | 10.1 / 498.9 |
| WebGPU on WebGL2 | cinematic | 56.7 / 21121.4 | 10.1 / 1843.9 | 10.1 / 7901.5 | 10.1 / 1028.1 |
| WebGLRenderer | performance | 10.2 / 22407.9 | 10.1 / 1165.5 | 10.1 / 2140.7 | 10.1 / 194.6 |
| WebGLRenderer | balanced | 10.1 / 6179.7 | 10.1 / 289.4 | 10.1 / 541.8 | 10.1 / 135.1 |
| WebGLRenderer | cinematic | 10.1 / 521.1 | 10.1 / 163.5 | 10.1 / 140.1 | 10.1 / 146.2 |

The balanced hardware-WebGPU entrance p95 was `12.2ms`, below the fixed KIN-030 `20.895ms` ceiling. The three compatibility-post VFX windows and three bare windows were each `10.1ms`; median ratio `1.00`, below the `1.10` ceiling.

## Balanced GTAO Evaluation

The current balanced pipeline measured p95 `10.1`, `10.2`, and `10.1ms`; the denoise candidate measured `10.1`, `10.1`, and `10.2ms`. Both had zero captured errors. Inspection of [current](./kin031-gtao-balanced-current.png) and [candidate](./kin031-gtao-balanced-denoise-candidate.png) showed no material quality gain. Denoise therefore remains cinematic-only; no production change was justified.

## Error Accounting

The hardware job completed with 17 gallery captures, two renderer spots, 14 balanced bay windows, and 36 renderer/profile/scene windows. It recorded zero unexpected console/page errors and zero harness failures. Three occurrences of the already-known Tone scheduling signature (`Start time must be strictly greater than previous start time`) were classified separately; they are not silently discarded and remain an audio-tail limitation.

## Commands And Artifacts

```powershell
npx playwright test tests/rollout-validation.ts --workers=1
node .superpowers/sdd/kin031-hardware-evidence.mjs
$env:KIN031_GTAO_VARIANT='current'; node .superpowers/sdd/kin031-gtao-evaluation.mjs
$env:KIN031_GTAO_VARIANT='denoise-candidate'; node .superpowers/sdd/kin031-gtao-evaluation.mjs
```

Raw JSON and harness scripts remain workspace-local under `.superpowers/sdd/`; the reviewed PNG evidence and this report are the durable record.

## Limitations

- Real Safari/iOS hardware was not available; Chromium compatibility routing is a signal, not Safari certification.
- Gamepad behavior used the standards-shaped browser gamepad surface; no physical controller was tested.
- Touch used standards-shaped browser touch events; no physical phone/tablet was tested.
- Audio correctness was asserted structurally; perceptual mix, timing, fatigue, and speaker/headphone behavior were not listening-tested.
- Results cover one high-end Windows machine and do not certify low-end, multi-GPU, thermal, battery, or production-host behavior.
