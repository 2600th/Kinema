# KIN-031 Bay Rollout And Final Validation Design

## Goal

Close the remaining evidence-backed gaps across the 14 showcase bays, prove the vertical-slice standard across renderer paths, graphics profiles, and input sources, and publish the durable closeout evidence for KIN-001 through KIN-031.

KIN-031 is a rollout and validation task, not a second audit or a redesign. The implementation reuses the systems delivered by KIN-001 through KIN-030 and changes only bays or copy with a demonstrated remaining gap.

## Selected Approach

Three approaches were considered:

1. Validation-only closeout. This is too small because steps, slopes, grab, and `futureA` still fail explicit backlog requirements.
2. Bespoke redesign of every bay. This is too broad, risks regressing already validated work, and conflicts with the no-new-mechanics boundary.
3. Shared checklist and observability with targeted bay fixes. This is selected because it preserves completed work, gives every bay a durable proof row, and limits production changes to the documented gaps.

The user has instructed Codex to automatically select the strongest recommended option, so option 3 is the approved direction.

## Scope And Bay Decisions

The authoritative corridor order is `SHOWCASE_STATION_ORDER`:

| Bay | KIN-031 decision |
|---|---|
| `steps` | Add one clearly contrasting block above the 0.2m automatic-step limit plus an explicit “too tall — jump” cue. Do not retune step assist. |
| `slopes` | Add a red/orange approach marker and label for the 62.7-degree rejection lane. Do not change slope physics. |
| `movement` | Evidence-only. Existing rope, ladder, crouch, input prompt, audio, VFX, and reset behavior remain unchanged. |
| `doubleJump` | Evidence-only. Existing authored platforms, jump feedback, and ascending coin arc remain unchanged. |
| `grab` | Add a real pressure-outline mini-goal using the existing grabbable cubes. Completion produces status, audio, and VFX, then visibly resets the delivered cube and target for replay. |
| `throw` | Preserve the validated gallery and refill loop. Add touch throw guidance and a source-aware carried-object hint. |
| `door` | Evidence-only. Existing prompt, event, beacon, checkpoint, audio, VFX, and reset contracts remain unchanged. |
| `vehicles` | Preserve vehicle physics and feedback. Replace the keyboard-only station copy and show source-aware drone altitude guidance on entry. |
| `platformsMoving` | Evidence-only. Prove motion and cycle repeatability. |
| `platformsPhysics` | Evidence-only. Retain the KIN-030 perimeter and boost-launch safety proof. |
| `materials` | Evidence-only passive exhibit. Interaction/audio/reset are explicitly `N/A`; prove renderer/profile presentation and zero primitive-shaped trimeshes. |
| `vfx` | Evidence-only passive exhibit. Prove renderer-honest sign content, profile density, and compatibility parity. |
| `navigation` | Remove keyboard-only `N/T` developer keys from the player-facing sign. Keep the debug controls operational and prove patrol motion across renderer paths. |
| `futureA` | Keep the bay honestly reserved with no activity or collectibles. Do not invent a placeholder mechanic. |

Every station’s primary sign and every new marker receives a stable scene-object name so Playwright can inspect production truth without coordinate clicking.

## Readability Geometry

`ProceduralBuilder` continues to own authored bay geometry.

- The steps contrast block is a primitive static cuboid higher than `0.30m`, placed beside the traversable lane and styled with the existing warning palette. It is named `StepsTooTallCue_col`; its label is `StepsTooTallLabel`.
- The slopes cue is a non-colliding floor marker at the 62.7-degree lane entrance, named `SlopesTooSteepMarker`, with `SlopesTooSteepLabel`.
- The grab goal is a shallow, non-blocking outlined pad at the free left side of the bay, named `GrabGoalOutline`, with `GrabGoalLabel`. The player can move any authored `PushCubeS`, `PushCubeM`, or `PushCubeL` body onto it.
- Existing bay collision, station colors, and KIN-030 boundary geometry remain unchanged outside these explicit additions.

## Grab Goal Runtime Contract

A focused `GrabGoalSystem` owns the goal state. It is registered in `Game` and wired through both `setupLevel()` and `setupStation("grab")`; custom levels and other isolated stations clear it.

The system finds the goal visual by stable name and the three authored cubes by their existing rigid-body `userData.name`. A cube counts only when it is dynamic, inside the target bounds, and settled for a short dwell. This prevents completion while the cube is still carried through the zone.

The state machine is:

1. `ready`: cyan outline, no cube accepted.
2. `settling`: a valid released cube remains inside the target for the dwell duration.
3. `completed`: outline turns green and emits `objective:completed` with id `grab-delivery`, text `Cube delivered`, and the world-space completion position.
4. `resetting`: after a short visible celebration, the delivered cube is restored to its authored pose with zero velocity and the outline returns to `ready`.

The existing objective event receives an optional `position`; existing objective producers remain source-compatible. `UIManager` already renders the completion text and `AudioManager` already maps objective completion. `ParticleSystem` uses the optional position to emit the existing completion particle vocabulary. No new asset or unrelated event family is introduced.

Narrow debug API methods expose the current goal state and a deterministic real-body placement action. They do not bypass the goal logic; the placement hook moves an actual Rapier body and lets the production fixed-update state machine complete it.

## Input Honesty

Static world signs remain binding-neutral. Runtime guidance owns device-specific copy.

- After throwable pickup, the HUD shows the correct throw control for keyboard/mouse, gamepad, or touch.
- On drone entry, the HUD shows `E/Q`, right-stick vertical, or right-look-zone vertical guidance according to the current input source.
- The Help screen includes throw and drone-altitude rows for all three input sources.
- The navigation station sign describes player-visible behavior only; `N/T` remain available as developer debug keys but are not presented as universal gameplay input.

Small pure copy helpers are unit-tested for all input sources before UI wiring.

## Back-Half Checkpoint And Coin Policy

`futureA` remains reserved and its five coins are removed. The 70-collectible contract delivered by KIN-025 is preserved by relocating those five coins into a visible trail from the VFX bay toward a second checkpoint between the VFX and navigation bays.

The existing `CheckpointManager` and checkpoint visuals are reused. `CheckpointObjectiveSystem` keeps `showcase-checkpoint` at the door and adds `showcase-checkpoint-back`. Activating either checkpoint updates the respawn point; only the existing first-checkpoint objective completion remains one-shot.

This resolves two backlog items without new mechanics:

- KIN-T13: reserved content no longer implies an activity.
- KIN-T20: the back half of the corridor gains clear recovery coverage.

The relocated coins form an authored, floor-supported route and keep the global total at exactly 70. Isolated `futureA` exposes `0/0`; the active bay receiving the trail owns those placements in station-filter mode.

## Automated Rollout Proof

One new allowlisted `tests/rollout-validation.ts` spec provides the cross-cutting matrix. It uses three world boots, not 27:

- default renderer route,
- forced WebGPURenderer-on-WebGL2 route,
- forced compatibility WebGLRenderer route.

Each boot cycles `performance`, `balanced`, and `cinematic`. At every profile it activates and observes keyboard, standards-shaped synthetic gamepad, and standards-shaped composed touch input. This yields 27 explicit renderer/profile/input observations while keeping startup cost bounded.

Each observation proves:

- expected renderer route/backend and applied profile,
- renderer badge accuracy,
- production input source detection,
- door prompt/action/reset through production listeners,
- no page or console rendering errors.

The same boot then spot-checks grab completion/reset, vehicle guidance/reset, VFX path/profile honesty, navigation motion, `futureA` passivity, and the back-half checkpoint. Existing domain specs remain authoritative for deep mechanic behavior.

Coin reachability uses floor-support and clearance queries for every placement plus real collection samples; teleport-only collection is not described as reachability.

## Hardware And Performance Proof

The configured Playwright project uses SwiftShader, so it cannot certify true WebGPU. Hardware-WebGPU proof is run separately in headed installed Chrome and must report `activeBackend === "WebGPU"`.

Performance evidence is separate from correctness observations:

- 600-frame true-WebGPU windows for all 14 review bays at balanced,
- entrance plus vehicles, VFX, and navigation across three paths and three profiles,
- fresh browser contexts for independent samples,
- zero rendering diagnostics,
- post-change p95 no worse than `before × 1.10 + 2ms`,
- KIN-030 balanced hardware-WebGPU entrance ceiling retained at `20.895ms`,
- KIN-028 compatibility-post VFX ratio retained at `<= 1.10`.

Balanced GTAO denoise is evaluated visually and by p95 as KIN-T19, but remains unchanged unless both quality and performance evidence justify a separate reviewed change.

## Evidence And Closeout

The immediate before gallery is `docs/audits/evidence/kin030-review/`. KIN-031 adds:

- `docs/audits/evidence/kin031-review/` with the same 17 named viewpoints,
- `docs/audits/evidence/kin031-rollout.md` with paired links, the 14/14 checklist, the 27-cell matrix, performance results, environments, and limitations,
- a dated section 24 addendum in `docs/audits/kinema-experience-audit.md`,
- `docs/audits/kinema-implementation-closeout.md` covering every KIN task, design decisions, deviations, stale findings, and optional-tail disposition.

The final addendum records KIN-T17/LVL-F14 as stale because throwable CCD already existed before the audit. It records environment/approval limitations honestly, including real Safari/iOS hardware, physical gamepad hardware, and perceptual audio review.

KIN-T18 asset deletion and KIN-T22 WebKit configuration remain deferred because they require separate maintainer approval. Other optional tail work stays out of KIN-031 unless required by a failing acceptance proof.

`AGENTS.md` is corrected during finalization to describe the existing Goal/Constraints/Execution Plan/Review todo structure instead of referencing the nonexistent ignored `tasks/TEMPLATE.md`.

## Verification Gates

Every behavior change follows RED/GREEN TDD. Each implementation cluster receives an independent GPT-5.6 SOL spec/code-quality review before the next cluster.

Final verification is:

1. focused unit and browser tests per cluster,
2. `npm run test`,
3. `npx tsc`,
4. touched-file Biome with zero new errors,
5. `npm run build`,
6. the rollout matrix and hardware/evidence runs,
7. `npx playwright test --workers=1` twice consecutively on an otherwise idle machine,
8. final whole-branch GPT-5.6 SOL review with every Critical/Important finding resolved.

Transient Playwright traces, local scripts, and raw output remain untracked and are deleted after durable evidence is copied into `docs/audits/evidence/`.
