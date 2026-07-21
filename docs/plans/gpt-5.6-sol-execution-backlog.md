# GPT-5.6 SOL Execution Backlog

Ordered, implementation-ready backlog derived from `docs/audits/kinema-experience-audit.md` and `docs/plans/kinema-modernisation-plan.md` (commit `9339bed`). Finding IDs reference the audit. All file paths verified against the repository at audit time.

Global rules for the executor:
- Run per-task verification plus `npm run test && npx tsc` before marking any task done; run the relevant Playwright spec(s) serially (`--workers=1`) when the machine is loaded.
- `npm run lint` has a pre-existing failing baseline (184 errors, CRLF-dominated). Fix only findings your change introduces; never repo-wide.
- Never edit `dist/`, `node_modules/`, `test-results/`. Ask before dependency changes. `tasks/` and `CLAUDE.md` are workspace-local — do not commit.
- Renderer paths to check where marked: default WebGPU, `?forceWebGPUWebGL=1`, `?forceWebGL=1`. Input methods where marked: keyboard+mouse, gamepad (code-level if no hardware), touch emulation.
- Evidence screenshots go to `docs/audits/evidence/` with the existing naming scheme.

---

## Phase 0 — Baseline and Regression Protection

```text
Task ID: KIN-001
Title: Add frame-time and load-time instrumentation to the debug surface
Phase: 0
Priority: P1 (foundational)
Category: Performance / Testing
User impact: Medium (enables everything later)
Effort: Small
Confidence: High

Problem: No frame-time p50/p95 or station-load metrics exist; audit §19 could not set
performance targets. Optimization tasks have no acceptance instrument.
Evidence: Audit §19; no timing aggregation in src/core/GameLoop.ts or src/ui/components/DebugPanel.ts.
Desired outcome: __KINEMA__.getFrameStats() returns { p50, p95, max, longFrames, samples }
over a rolling window; level load duration is recorded per load and queryable.

Relevant files: src/core/GameLoop.ts, src/main.ts (DEV hook block lines ~400-739),
src/ui/components/DebugPanel.ts (display), src/level/LevelManager.ts (load timing).
Relevant systems: GameLoop, LevelManager.
Existing assets to reuse: DebugPanel metrics rows.
New assets required: none.

Implementation instructions:
1. In GameLoop.tick, record per-render-frame duration into a 600-sample ring buffer
   (no allocation per frame; Float32Array + cursor).
2. Expose getFrameStats() computing p50/p95/max/count of frames >33.4ms from the buffer;
   reset on level load.
3. Wrap LevelManager.load/loadStation/loadFromJSON with performance.now() timing stored
   on the manager; expose __KINEMA__.getLastLoadStats().
4. Add a DebugPanel row showing p50/p95 live.
5. Record a baseline table (per station × profile on this machine) into
   docs/audits/evidence/frame-baseline.md.

Dependencies: none.
Out of scope: any optimization; budget enforcement.
Behaviour that must not change: fixed-step semantics, hitstop accumulator behavior.

Acceptance criteria:
- getFrameStats() returns plausible numbers in dev on the showcase.
- Stats reset on level load; no per-frame allocation (verify no GC churn in a 30s trace).
- Baseline doc committed.

Verification:
- Automated tests: unit test the percentile math with a fixed buffer.
- Manual test flow: load showcase, idle 10s, query stats; load vfx station, compare.
- Required screenshots: DebugPanel showing the new row.
- Renderer paths: default WebGPU only (instrument is path-agnostic).
- Input methods: n/a.
- Performance checks: instrument overhead <0.05ms/frame (trace).

Regression risks: none meaningful (additive, DEV-gated).
Rollback or feature-flag strategy: DEV-only code; delete rows to roll back.
```

```text
Task ID: KIN-002
Title: Consolidate Playwright readiness helpers and type the __KINEMA__ surface
Phase: 0
Priority: P1 (foundational)
Category: Testing
User impact: Low direct, High indirect (flake reduction)
Effort: Medium
Confidence: High

Problem: Four specs failed under 2-worker contention and passed serially (audit §21
TEST-F10, runtime-confirmed); readiness helpers are copy-pasted with divergent timeouts;
every spec re-declares (window as any).__KINEMA__ untyped (TEST-F11), so hook/spec drift
compiles silently.
Evidence: Fixed sleeps at tests/visual-check.ts:34,61; tests/pause-pointer-lock.ts:39,59;
tests/procedural-review-screenshots.ts:58; tests/mobile-compat-procedural.ts:65; divergent
waitForReady in tests/jump-mechanics.ts:13, tests/physics-verification.ts:12,
tests/vfx-particles.ts:3, tests/procedural-coins.ts:10, tests/procedural-hazards.ts:16,
tests/vehicle-controllers.ts:95. Serial re-run of the 4 failures passed 7/7 in 3.3m.
Desired outcome: one shared helper module + typed debug API; zero fixed sleeps for
readiness; flake rate at 2 workers measurably reduced.

Relevant files: NEW tests/helpers/kinema.ts; NEW src/core/KinemaDebugApi.ts (interface);
src/main.ts (implement interface on the DEV hook object); all 16 tests/*.ts;
tests/tsconfig.json (include the interface).
Relevant systems: test infra.
Existing assets to reuse: the model wait pattern at tests/station-screenshots.ts:52-73.
New assets required: none.

Implementation instructions:
1. Define KinemaDebugApi describing every member currently attached in src/main.ts:401-738;
   type the window augmentation in tests scope.
2. Create tests/helpers/kinema.ts exporting waitForKinema(page), waitForGrounded(page),
   waitForLoadingGone(page), getPlayer(page) with one shared timeout constant (60s),
   modeled on station-screenshots.ts:52-73.
3. Replace fixed waitForTimeout readiness sleeps in the four cited specs (and any other
   pure-readiness sleeps) with the helpers. Do not alter assertions or scenario logic.
4. Keep playwright.config.ts testMatch updated only if helper file placement requires
   exclusion (helpers must not match test globs).
5. Run the full suite twice at --workers=2 and once at --workers=1; record pass rates.

Dependencies: none.
Out of scope: new scenarios; visual regression (KIN-004).
Behaviour that must not change: what each spec asserts.

Acceptance criteria:
- No spec contains a fixed sleep whose only purpose is boot/level readiness.
- tsc over tests (npm run typecheck:tests) fails if a spec uses a hook not on the interface.
- Two consecutive 2-worker full runs with 0 or fewer flakes than the recorded baseline (4).

Verification:
- Automated tests: npx playwright test (x2 at workers=2, x1 at workers=1); npm run typecheck:tests.
- Manual test flow: n/a.
- Required screenshots: n/a.
- Renderer paths: as existing specs.
- Input methods: as existing specs.
- Performance checks: total suite wall-clock not >10% worse.

Regression risks: subtle wait-semantics changes; mitigate by keeping per-spec extra waits
that guard non-readiness conditions.
Rollback or feature-flag strategy: git revert; helpers are additive.
```

```text
Task ID: KIN-003
Title: Add editor debug hooks and unit tests for CommandHistory and LevelSerializer
Phase: 0
Priority: P1
Category: Testing / Editor
User impact: High indirect (editor P1 fix verification depends on it)
Effort: Medium
Confidence: High

Problem: The entire src/editor/ tree (28 files) has zero tests and no __KINEMA__ hooks,
so editor regressions (including the P1 soft-brick chain) ship invisibly (audit §21 TEST-F1).
Evidence: no src/editor/**/*.test.ts (glob empty); __KINEMA__ block in src/main.ts:401-738
has no editor members; RT-ED-CHAIN was undetectable by the suite.
Desired outcome: deterministic unit coverage for the two pure editor cores + an e2e-drivable
editor hook set.

Relevant files: NEW src/editor/CommandHistory.test.ts; NEW src/editor/LevelSerializer.test.ts;
src/main.ts (add editor hooks, DEV-gated); src/editor/EditorManager.ts (expose minimal
accessors: isActive(), isPlayTesting(), object count).
Relevant systems: editor.
Existing assets to reuse: vitest mocking patterns from src/level/LevelManager.test.ts.
New assets required: none.

Implementation instructions:
1. Unit-test CommandHistory: execute/undo/redo ordering, 50-cap eviction, redo-stack
   invalidation on new push, undo on empty is a no-op (src/editor/CommandHistory.ts).
2. Unit-test LevelSerializer: V2 round-trip deep-equality for a document containing every
   brush type + a GLB source + parentId hierarchy + spawn point; V1→V2 migration fixture
   (src/editor/LevelSerializer.ts:170-222).
3. Add __KINEMA__ editor hooks: openEditor(), closeEditor(), isEditorActive(),
   isPlayTesting(), getEditorObjectCount(), editorUndo(), editorRedo(),
   startPlayTest(), stopPlayTest(). Route through EditorManager public methods only.
4. Extend KinemaDebugApi (KIN-002) with these members.

Dependencies: KIN-002 (interface file exists; can land in parallel with coordination).
Out of scope: fixing editor defects (Phase 1); e2e editor spec (lands with KIN-006 fix).
Behaviour that must not change: editor runtime behavior (hooks are read/驱动 wrappers only —
no new state paths).

Acceptance criteria:
- Both unit files pass; round-trip test fails if any serialized field is dropped.
- From DevTools: openEditor() opens the editor in a dev session; counts respond to placement.

Verification:
- Automated tests: npm run test.
- Manual test flow: dev session, exercise each hook from the console.
- Required screenshots: none.
- Renderer paths: default only.
- Input methods: n/a.
- Performance checks: none.

Regression risks: low; hooks are DEV-gated.
Rollback or feature-flag strategy: hooks behind import.meta.env.DEV as with existing block.
```

```text
Task ID: KIN-004
Title: Add three deterministic visual-regression anchors with real comparison
Phase: 0
Priority: P2
Category: Testing / Rendering
User impact: Medium indirect
Effort: Medium
Confidence: Medium

Problem: Screenshots are captured but never compared — no visual regression protection
exists despite committed baselines (audit §21 TEST-F2).
Evidence: no toHaveScreenshot/toMatchSnapshot anywhere in tests/ (grep empty);
tests/screenshots/ baselines unused by assertions.
Desired outcome: three anchor scenes compared with tolerance on every run.

Relevant files: NEW tests/visual-regression.ts; playwright.config.ts (add to testMatch —
NOTE the explicit allowlist gotcha: a spec not added there silently never runs);
src/main.ts (__KINEMA__.freezeForCapture() hook: pause animation mixers, hide particles,
pin a fixed camera pose).
Relevant scenes: main menu; steps station; materials station (stable, no particles/fire).
Relevant systems: renderer, test infra.
Existing assets to reuse: review spawn poses from src/level/ShowcaseLayout.ts (import like
tests/beacon-hold-objective.ts:2 does).
New assets required: committed baseline PNGs (generated on the SwiftShader CI environment,
not a dev GPU — document this in the spec header).

Implementation instructions:
1. Add freezeForCapture(): set animation mixer timeScale 0, hide GameParticles/Sparkle
   roots, snap camera via existing setCameraLook, force performance profile + DPR1.
2. Spec: for each anchor, navigate, wait ready (KIN-002 helpers), freezeForCapture,
   expect(page).toHaveScreenshot with maxDiffPixelRatio 0.02.
3. Generate baselines under the same environment Playwright CI uses (SwiftShader,
   WebGPU-on-WebGL2 — audit §20 notes true WebGPU is unavailable there).
4. Add spec filename to playwright.config.ts testMatch.

Dependencies: KIN-002.
Out of scope: per-path visual parity (KIN-023); more scenes.
Behaviour that must not change: production rendering (freeze hook is DEV-only).

Acceptance criteria:
- Suite fails when a deliberate test-only material color change is introduced (spot check,
  then revert); passes twice consecutively unmodified.

Verification:
- Automated tests: npx playwright test tests/visual-regression.ts (x2).
- Manual test flow: n/a.
- Required screenshots: the baselines themselves.
- Renderer paths: CI path (WebGPU-on-WebGL2).
- Input methods: n/a.
- Performance checks: none.

Regression risks: flaky diffs from font rendering — menu anchor may need masking of the
version text; start tolerant, tighten later.
Rollback or feature-flag strategy: remove spec from testMatch.
```

```text
Task ID: KIN-005
Title: Regression test for runtime graphics-profile cycling (catches the destroyed-texture bug)
Phase: 0
Priority: P2
Category: Testing / Rendering
User impact: Medium
Effort: Small
Confidence: High

Problem: Runtime profile switching emits "Destroyed texture [ShadowDepthTexture] used in a
submit" ×10 on true WebGPU (audit §16 RT-PROFILE-WGPU); no spec cycles profiles at runtime
(audit §21 TEST-F8), so pipeline-rebuild lifecycle bugs ship silently.
Evidence: console capture during this audit (evidence log); __KINEMA__.setGraphicsProfile
exists at src/main.ts:618-621 and is uncalled by any spec.
Desired outcome: a spec cycles performance→balanced→cinematic→balanced mid-session and
asserts flags update with zero rendering-related console errors/warnings.

Relevant files: NEW tests/graphics-profile-cycling.ts; playwright.config.ts testMatch.
Relevant systems: RendererManager pipeline rebuild (src/renderer/RendererManager.ts,
src/renderer/rendererPipelineBuilder.ts).
Existing assets to reuse: error-filter pattern from tests/vfx-particles.ts:143-144.
New assets required: none.

Implementation instructions:
1. Boot ?station=materials (stable scene), wait ready.
2. Capture console messages; cycle profiles via setGraphicsProfile with 1s settles;
   assert getRendererDebugFlags().graphicsProfile after each.
3. Assert zero console messages matching /WGSL|ShaderModule|Destroyed texture|Invalid/i.
4. Expect this spec to FAIL on true-WebGPU hardware until KIN-011 lands — mark the
   destroyed-texture assertion with a comment linking KIN-011; on CI (WebGL2 backend) it
   documents current behavior. Do not skip the assertion.

Dependencies: KIN-002.
Out of scope: fixing the bug (KIN-011).
Behaviour that must not change: n/a (test only).

Acceptance criteria: spec runs in CI and passes there; fails locally on WebGPU hardware
with the documented warning until KIN-011.

Verification:
- Automated tests: the new spec.
- Renderer paths: CI + manual run on WebGPU hardware.
- Input methods: n/a. Performance checks: none. Screenshots: none.

Regression risks: none (test only).
Rollback or feature-flag strategy: remove from testMatch.
```

## Phase 1 — Stability and Functional Defects

```text
Task ID: KIN-006
Title: Make every scene transition terminate play-test; kill the editor soft-brick chain
Phase: 1
Priority: P0
Category: Defect fix / Editor
User impact: Transformational (editor trust)
Effort: Medium
Confidence: High

Problem: Quitting to the main menu during editor play-test leaves playTestActive set and
the Stop bar orphaned; in the next run the stale Stop restores a snapshot against disposed
physics → "[Editor] Failed to restore play-test snapshot: RuntimeError: unreachable" +
unhandled rejection → F1 permanently stops opening the editor for the session.
Evidence: Full runtime repro this audit (§13 RT-ED-CHAIN; evidence/16-orphaned-stop-bar-new-run.png
+ console msgid 681/682). Root cause: src/main.ts:245,282-292 guard scene transitions on
editorManager.isActive(), which is false during play-test (EditorManager.exit() ran);
stopPlayTest() is never called; EditorManager.toggle() early-returns while playTestActive
(src/editor/EditorManager.ts:236-238,258).
Desired outcome: leaving a run by ANY route while play-testing cleanly stops play-test,
removes the Stop bar, discards the snapshot, and leaves the editor toggleable.

Relevant files: src/editor/EditorManager.ts (add isPlayTesting(); make stopPlayTest
idempotent + safe when the source level is gone; abortPlayTest() that discards the snapshot
without restore); src/main.ts (prepareSceneLoad, returnToMainMenu, startSavedLevel,
startBlankLevelForEditor: call editorManager?.abortPlayTest() before unload when
isPlayTesting()).
Relevant systems: EditorManager lifecycle, run descriptors in main.ts.
Existing assets to reuse: existing stopPlayTest/exit code paths (EditorManager.ts:506-545).
New assets required: none.

Implementation instructions:
1. Add EditorManager.isPlayTesting(): boolean and abortPlayTest(): void — clears
   playTestActive, removes the Stop bar DOM, clears playTestSnapshot and saved camera,
   restores nothing, re-enables toggle.
2. In stopPlayTest, guard snapshot restore in try/catch; on failure, log, fall through to
   a clean editor-closed state instead of leaving playTestActive true; never leave the
   Stop bar attached after either path.
3. In src/main.ts prepareSceneLoad and returnToMainMenu (before unloadCurrentRun /
   levelManager.unload), call abortPlayTest() when isPlayTesting().
4. Also dismiss the stacked pause-menu screen when returning to main menu from play-test
   (MenuManager pop-to-root — see src/ui/menus/MenuManager.ts push/pop:133-172); runtime
   evidence showed Resume remaining visible over the main menu.
5. Add tests/editor-flow.ts (uses KIN-003 hooks): open editor → place brush (via
   placeBrush hook or brush tool invocation) → startPlayTest → returnToMainMenu (menu
   flow) → Play new run → assert no Stop bar in DOM, openEditor() succeeds, no console
   errors. Add to testMatch.

Dependencies: KIN-003 (hooks), KIN-002 (helpers).
Out of scope: dirty-state (KIN-013), undo coverage (KIN-014).
Behaviour that must not change: normal play-test start/stop round-trip including camera
restore; F1 toggle semantics; run-restart flow.

Acceptance criteria:
- Repro chain from the audit no longer produces the RuntimeError, orphaned Stop, or dead F1.
- Pause menu never remains stacked over the main menu.
- Normal play-test → Stop restores document, camera, and selection-clearing exactly as before.
- New spec passes at workers=1 and 2.

Verification:
- Automated tests: tests/editor-flow.ts; npm run test (KIN-003 units still green).
- Manual test flow: the exact audit repro (play-test → Esc → Main Menu → Play → F1;
  also: → click any lingering Stop if reachable).
- Required screenshots: editor reopened in second run.
- Renderer paths: default.
- Input methods: keyboard.
- Performance checks: none.

Regression risks: play-test camera restore path; snapshot lifecycle. Mitigate with the
normal round-trip assertion in the spec.
Rollback or feature-flag strategy: git revert (single-subsystem change).
```

```text
Task ID: KIN-007
Title: Tick the nav crowd in station-isolation mode (frozen T-pose NPCs)
Phase: 1
Priority: P1
Category: Defect fix
User impact: High (station looks broken)
Effort: Small
Confidence: High

Problem: Loading ?station=navigation spawns 5 NPCs that never move or animate (T-pose),
because NavPatrolSystem is ticked only by DebugRuntimeSystem whose nav reference is
assigned only in setupLevel, and Game.setupStation never invokes it.
Evidence: Pixel pair evidence/09 & 10 (identical T-pose agents across 3s while coins
animate); src/systems/DebugRuntimeSystem.ts:52,73; src/Game.ts:598-603 (setupStation calls
only health/spike/coin/interactable systems).
Desired outcome: NPCs patrol identically in full-showcase and station-isolation modes;
never visible in T-pose.

Relevant files: src/Game.ts (setupStation), src/systems/DebugRuntimeSystem.ts (add
setupStation or re-fetch nav ref lazily), src/navigation/NavAgent.ts (default to idle clip
on load rather than none — T-pose guard).
Relevant scenes or stations: navigation.
Relevant systems: DebugRuntimeSystem, NavPatrolSystem, NavAgent.
Existing assets to reuse: existing patrol/crowd code (works in full run).
New assets required: none.

Implementation instructions:
1. Give DebugRuntimeSystem a setupStation(key) that performs the same nav-ref fetch as
   setupLevel (src/systems/DebugRuntimeSystem.ts:52); call it from Game.setupStation.
   (Alternative: lazily re-fetch getNavPatrolSystem() each fixedUpdate when ref is null —
   choose the explicit setup call to match the existing lifecycle pattern.)
2. In NavAgent model-load completion, start the idle animation immediately so agents are
   never T-posed even pre-first-tick.
3. Extend tests/station-screenshots.ts navigation case (or a small new spec) asserting at
   least one agent position changes >0.5 units across 3s in isolation mode.

Dependencies: KIN-002.
Out of scope: nav overlay (N) / retarget (T) key behavior (works via same ref — verify only).
Behaviour that must not change: full-showcase patrol behavior; navmesh generation.

Acceptance criteria:
- ?station=navigation shows moving, animated agents within 2s of grounded-ready.
- N and T debug keys still function in both modes.

Verification:
- Automated tests: updated spec (movement assertion).
- Manual test flow: load ?station=navigation, observe patrol + press N/T.
- Required screenshots: re-capture evidence/09 equivalent showing dispersed agents.
- Renderer paths: default + ?forceWebGL=1 (agents are path-independent).
- Input methods: keyboard.
- Performance checks: none.

Regression risks: double-ticking the crowd if both setup paths run — guard with a
single-assignment or idempotent setup.
Rollback or feature-flag strategy: git revert.
```

```text
Task ID: KIN-008
Title: Add RopeMode.exit so detaching from a rope releases the FSM rope state
Phase: 1
Priority: P1
Category: Defect fix / Gameplay
User impact: High
Effort: Small
Confidence: High

Problem: After jumping/dropping off a rope the FSM remains in "rope" state through the
fall, landing, and subsequent walking — rope-hang animation persists indefinitely.
Evidence: Runtime timeline this audit (§7 ROPE-1): state stayed "rope" while grounded and
walking. Code: src/character/modes/RopeMode.ts implements enter+fixedUpdate only;
RopeState.handleInput returns null (src/character/states/RopeState.ts:13-15);
LadderMode.exit shows the correct pattern (src/character/modes/LadderMode.ts:38-45).
Desired outcome: detaching by jump, drop, or forced respawn always transitions to
air/idle appropriately.

Relevant files: src/character/modes/RopeMode.ts; src/character/PlayerController.ts
(detachFromRope ~:752-755 — ensure mode exit runs on every detach path).
Relevant scenes or stations: movement station rope; any editor level with a rope.
Relevant systems: CharacterFSM, CharacterModes.
Existing assets to reuse: LadderMode.exit pattern.
New assets required: none.

Implementation instructions:
1. Implement RopeMode.exit(ctx) mirroring LadderMode.exit: request STATE.air when not
   stableGrounded else STATE.idle.
2. Audit every detach path (jump-off at src/interaction/interactables/PhysicsRope.ts:354-361,
   crouch-drop, respawn/spawn) to confirm the mode switch calls exit.
3. Add a Playwright case (extend tests/jump-mechanics.ts or new tests/character-states.ts):
   teleport to rope (import layout math like tests/beacon-hold-objective.ts:2),
   attach via simulateHoldInteract, simulateJump, wait grounded, assert state ∈
   {idle, move, land} within 1.5s and never "rope" after grounded.

Dependencies: KIN-002.
Out of scope: rope feel tuning; analog ladder input (KIN-016).
Behaviour that must not change: on-rope swing/climb physics; attach flow.

Acceptance criteria: audit repro timeline now ends in idle; spec green.

Verification:
- Automated tests: new/extended spec; npm run test.
- Manual test flow: attach → jump off → land → walk; also crouch-drop variant.
- Required screenshots: none.
- Renderer paths: default. Input methods: keyboard (+ simulated).
- Performance checks: none.

Regression risks: minimal; symmetric with ladder.
Rollback or feature-flag strategy: git revert.
```

```text
Task ID: KIN-009
Title: Honest save results: propagate LevelSaveStore failures to the editor UI
Phase: 1
Priority: P1
Category: Defect fix / Editor
User impact: High (silent data loss)
Effort: Small
Confidence: High

Problem: On QuotaExceededError the save writes nothing but the editor still emits
editor:saved — the user sees success while their level was not persisted.
Evidence: src/level/LevelSaveStore.ts:40-45,60-73 (console.error only);
src/editor/EditorManager.ts:1335-1336 (unconditional editor:saved). Audit §13 ED-F4.
Desired outcome: save() returns success; failure surfaces a visible, persistent error
toast with the reason and the file-download fallback offered.

Relevant files: src/level/LevelSaveStore.ts (return boolean / result object from save),
src/editor/EditorManager.ts (saveLevel branch), src/editor/panels/ToolbarPanel.ts
(error state affordance if toast lives there), src/ui/components/HUD.ts only if reusing
the status lane (prefer an editor-local toast: editor UI must not depend on gameplay HUD).
Relevant systems: LevelSaveStore, editor save flow.
Existing assets to reuse: LevelSaveStore quota-handling tests
(src/level/LevelSaveStore.test.ts:81-129) — extend, they already simulate quota errors.
New assets required: none.

Implementation instructions:
1. Change LevelSaveStore.save to return { ok: boolean; reason?: "quota" | "error" } —
   update both quota catch sites.
2. In EditorManager.saveLevel, emit editor:saved only on ok; on failure show an editor
   toast "Save failed — storage full. A file download was started instead." and trigger
   the existing LevelSerializer.download as the fallback (it currently always downloads —
   keep that behavior on failure, make it opt-in on success per ED-F10 later, KIN-015).
3. Extend LevelSaveStore unit tests for the new return contract.

Dependencies: none (coordinate with KIN-015 which touches the same flow).
Out of scope: save dialog redesign (KIN-015); Ctrl+S (KIN-015).
Behaviour that must not change: successful save round-trip; corrupt-blob pruning.

Acceptance criteria: with localStorage stuffed near quota, saving shows the failure toast,
emits no editor:saved, and still produces the JSON download.

Verification:
- Automated tests: updated unit tests.
- Manual test flow: fill localStorage (dev console loop), save, observe.
- Required screenshots: failure toast.
- Renderer paths: default. Input methods: mouse.
- Performance checks: none.

Regression risks: callers of save() — grep for other call sites and update.
Rollback or feature-flag strategy: git revert.
```

```text
Task ID: KIN-010
Title: Give direct-entry routes (?station=, ?spawn=) a pause menu
Phase: 1
Priority: P1
Category: Defect fix / UI-UX
User impact: High (documented workflows have no exit/settings)
Effort: Medium
Confidence: High

Problem: MenuManager is constructed only on the menu-flow branch; in direct-station and
direct-spawn entry, Escape does nothing — no pause, settings, help, restart, or exit.
Evidence: Runtime-confirmed this audit (§18): Escape in ?station=vfx play produced no
menu; src/main.ts:752-784 (MenuManager only in the else branch; registerUnload(null)).
Desired outcome: identical pause functionality on all entry routes.

Relevant files: src/main.ts (construct MenuManager on all branches; for direct entry,
skip showMainMenu and go straight into the run), src/ui/menus/MenuManager.ts (support
starting hidden with a loaded run).
Relevant systems: MenuManager, bootstrap routing.
Existing assets to reuse: existing pause stack (menu:toggle path, MenuManager.ts:97-108).
New assets required: none.

Implementation instructions:
1. Hoist MenuManager construction above the routing if/else in src/main.ts:752-784; pass
   it to registerUnload on every branch (replacing registerUnload(null)).
2. For station/spawn branches, do not call showMainMenu(); ensure menu:toggle from
   InputManager opens the pause stack once a run is active (verify gameLoop-running guard
   MenuManager.ts:98-108 holds in these modes).
3. "Main Menu" from pause in a direct-entry session should return to the standard main
   menu (the run descriptor machinery already supports starting a new run from there).
4. Extend tests/pause-pointer-lock.ts or add a small spec: boot ?station=steps, Escape →
   pause visible, Resume works.

Dependencies: KIN-002; do after KIN-006 (shared MenuManager/main.ts surface).
Out of scope: gamepad pause binding (KIN-018).
Behaviour that must not change: menu-flow behavior; direct-entry auto-start speed.

Acceptance criteria: Escape opens/closes pause on all three entry route types; Main Menu
from a direct-entry pause lands on the standard menu; no double-menu stacking.

Verification:
- Automated tests: new/extended spec.
- Manual test flow: all three routes × pause/resume/settings/main-menu.
- Required screenshots: pause over a station route.
- Renderer paths: default + ?forceWebGL=1.
- Input methods: keyboard.
- Performance checks: none.

Regression risks: menu stack state in modes it never ran in — reuse KIN-006's pop-to-root.
Rollback or feature-flag strategy: git revert.
```

```text
Task ID: KIN-011
Title: Fix ShadowDepthTexture lifetime across graphics-profile pipeline rebuilds
Phase: 1
Priority: P1
Category: Defect fix / Rendering
User impact: Medium (validation errors, risk of corruption on real WebGPU)
Effort: Medium
Confidence: Medium

Problem: Cycling graphics profiles at runtime on true WebGPU emits "Destroyed texture
[ShadowDepthTexture] used in a submit" ×10 — a command buffer references a texture the
rebuild destroyed.
Evidence: Console capture this audit (§16 RT-PROFILE-WGPU) while cycling
performance→cinematic on ?station=vfx.
Desired outcome: profile switches produce zero WebGPU validation warnings.

Relevant files: src/renderer/RendererManager.ts (profile mutation path),
src/renderer/rendererPipelineBuilder.ts (pipeline assembly),
src/renderer/rendererQuality.ts / rendererMutations.ts (shadow map size changes
1024↔2048 per src/renderer/pipelineProfile.ts:44-46 — the likely trigger).
Relevant systems: TSL RenderPipeline, shadow map resources.
Existing assets to reuse: pipelineProfile descriptor tests.
New assets required: none.

Implementation instructions:
1. Reproduce on WebGPU hardware with DevTools console; identify where shadow map size
   change disposes the light's shadow map while a queued frame still references it.
2. Sequence the rebuild: complete/flush in-flight rendering before disposing shadow
   resources (e.g., dispose after renderer.renderAsync completes, or defer old-resource
   disposal one frame).
3. Confirm KIN-005's spec assertion now passes on WebGPU hardware.

Dependencies: KIN-005 (failing test first).
Out of scope: other profile-switch visual glitches unless surfaced by the fix.
Behaviour that must not change: per-profile shadow quality; steady-state rendering.

Acceptance criteria: 10 consecutive profile cycles on WebGPU hardware with zero
validation messages; KIN-005 green locally and in CI.

Verification:
- Automated tests: KIN-005 spec.
- Manual test flow: cycle profiles rapidly during motion.
- Required screenshots: none.
- Renderer paths: true WebGPU (primary), WebGPU-on-WebGL2 (no regression).
- Input methods: n/a.
- Performance checks: profile-switch stall not worse than baseline (frame stats, KIN-001).

Regression risks: deferred disposal could leak if switch-spamming — bound the deferral.
Rollback or feature-flag strategy: git revert.
```

```text
Task ID: KIN-012
Title: Suppress physics-settle "Impact!" toasts during level-load grace period
Phase: 1
Priority: P2
Category: Defect fix / UI-UX
User impact: Medium (first-impression noise)
Effort: Small
Confidence: High

Problem: Crash-playground and table props settling at load fire hard-contact events, so
the player spawns with three fading "Impact!" toasts in the status lane.
Evidence: evidence/07-showcase-entrance-firstview-webgpu.png (three ghost rows);
src/systems/InteractableSystem.ts:208 (contact-force → hud.showStatus).
Desired outcome: no contact toasts within the first ~1.5s after level:loaded (or until
first player input), while genuine gameplay impacts still toast.

Relevant files: src/systems/InteractableSystem.ts (grace timer around the contact drain).
Relevant systems: InteractableSystem.
Existing assets to reuse: level:loaded event.
New assets required: none.

Implementation instructions:
1. On setupLevel/setupStation, record a graceUntil timestamp = now + 1.5s; skip the
   showStatus emission (not the physics) while within grace.
2. Keep the "Impact!" pathway intact for the throw station during play (threshold >12N
   unchanged).

Dependencies: none.
Out of scope: status-lane aria-live (KIN-017).
Behaviour that must not change: throw-station impact feedback during gameplay.

Acceptance criteria: fresh spawn shows zero Impact toasts across 10 loads; throwing a
prop at the wall still toasts.

Verification:
- Automated tests: optional assertion in an existing procedural spec (status lane empty
  at ready).
- Manual test flow: load showcase ×3, observe; then throw at throw station.
- Required screenshots: clean spawn HUD.
- Renderer paths: default. Input methods: keyboard.
- Performance checks: none.

Regression risks: none meaningful.
Rollback or feature-flag strategy: constant to 0 restores old behavior.
```

## Phase 2 — Character, Camera, and Interaction Foundations

```text
Task ID: KIN-013
Title: Rebracket locomotion blend thresholds so walk/jog/sprint clips all play
Phase: 2
Priority: P1
Category: Animation / Gameplay tuning
User impact: High (visible on every step taken)
Effort: Small
Confidence: High

Problem: Blend thresholds [2.0, 4.0] sit below actual speeds (run 5.2, sprint 6.76), so
ordinary running plays the Sprint clip at ~0.8× and the authored Jog clip is unreachable;
walk vs sprint differ only by playback rate.
Evidence: src/character/animation/profiles.ts:26 (thresholds);
src/core/constants.ts:42,44 (speeds); authored clip speeds walk 1.5 / jog 3.5 / sprint 6.5
(src/character/animation/AnimationController.ts:12-14); weight math :272-281. Audit §7 MOV-1.
Desired outcome: walking shows Walk, default run shows Jog, sprint shows Sprint, with
timeScale corrections staying within ~0.8–1.25.

Relevant files: src/character/animation/profiles.ts (PLAYER_PROFILE locomotion thresholds).
Relevant systems: AnimationController 3-zone blend.
Existing assets to reuse: existing UAL clips (Walk/Jog/Sprint loops).
New assets required: none.

Implementation instructions:
1. Set thresholds so zones bracket real speeds: recommend [2.6, 5.6] — walk zone <2.6
   (analog tilt), jog spans 2.6–5.6 covering default 5.2, sprint >5.6 covering 6.76.
2. Verify NPC profiles use their own speeds; adjust only if they share PLAYER_PROFILE.
3. Capture before/after side-by-side (simulateMove walk + Shift sprint) for design
   sign-off; this is a feel change requiring approval per plan §16.
4. Add an AnimationController unit test asserting zone weights at speeds 1.5/5.2/6.76.

Dependencies: none. Design approval required before merge.
Out of scope: authored clip speed changes; MOV-2 stop-feel retune.
Behaviour that must not change: physics speeds; timeScale anti-slide mechanism.

Acceptance criteria: at 5.2 m/s the jog clip holds dominant weight (>0.6); no visible
foot-sliding regression in capture; unit test green.

Verification:
- Automated tests: new unit test; npm run test.
- Manual test flow: walk/run/sprint on steps station; watch transitions.
- Required screenshots: before/after capture pair (video preferred, frames acceptable).
- Renderer paths: default. Input methods: keyboard + gamepad-analog (simulateMove partial tilt).
- Performance checks: none.

Regression risks: transition pops at new zone edges — verify starts/stops.
Rollback or feature-flag strategy: single-constant revert.
```

```text
Task ID: KIN-014
Title: Character responsiveness fixes: LandState exits, step-assist dt and height, analog ladder
Phase: 2
Priority: P2
Category: Gameplay tuning / Defect fix
User impact: Medium-High
Effort: Medium
Confidence: High

Problem: (a) LandState swallows crouch/interact up to 0.4s after >2m/s landings;
(b) step assist hardcodes *60 (frame-rate coupling) and caps at 0.15/0.2m vs the 0.3
autostep intent, snagging modest steps; (c) ladder climb ignores analog moveY (binary,
no proportional speed, deadzone 0.25 latch).
Evidence: (a) src/character/states/LandState.ts:6,20-31; entry gate AirState.ts:26-28.
(b) src/character/modes/GroundedMode.ts:490,499-500; intent constant constants.ts:32.
(c) src/character/modes/LadderMode.ts:88; entry PlayerController.ts:595-598;
latch InputManager.ts:179-181. Audit §7 FSM-2/STEP-1/LADDER-1.
Desired outcome: inputs never feel dead after landing; 0.25–0.3m steps climb; analog
climb speed on gamepad.

Relevant files: as cited above.
Relevant systems: CharacterFSM states, GroundedMode step assist, LadderMode.
Existing assets to reuse: crouch/interact transitions in IdleState/MoveState (copy gates).
New assets required: none.

Implementation instructions:
1. LandState.handleInput: add input.crouch → STATE.crouch and input.interactPressed →
   STATE.interact exits (matching IdleState.ts:21 pattern); reduce LAND_DURATION to 0.25
   (clip-finish exit remains).
2. Step assist: pass dt into the boost computation; replace *60 with 1/dt equivalents;
   raise maxStepHeight to 0.25 (walk) / 0.3 (run) aligning with AUTOSTEP.maxHeight.
3. LadderMode: climbDir = input.moveY (clamped, deadzone 0.1); entry gate on
   |moveY| > 0.15; climb speed proportional.
4. Extend tests/character-states.ts (create if KIN-008 didn't): land→crouch within 0.1s
   of touchdown; step ledges at 0.2/0.28/0.35m (build via forcePlayerPosition against
   steps-station geometry — 0.35 must still block).

Dependencies: KIN-008 (same new spec file), KIN-002.
Out of scope: MOV-2 deceleration retune (design-approval item, separate decision).
Behaviour that must not change: hard-landing juice (hitstop/FOV on player:landed);
jump-out-of-land transition.

Acceptance criteria: all three sub-fixes demonstrated by spec + manual; no new FSM warnings.

Verification:
- Automated tests: character-states spec; npm run test.
- Manual test flow: drop-land then instantly crouch; climb stairs of varying heights;
  gamepad half-tilt ladder climb.
- Required screenshots: none (state timelines suffice).
- Renderer paths: default. Input methods: keyboard + gamepad (analog via simulateMove).
- Performance checks: none.

Regression risks: land-state audio/animation timing (LandState exit earlier) — verify
land sound still plays via player:landed (event fires on touchdown, not state exit).
Rollback or feature-flag strategy: per-constant reverts.
```

```text
Task ID: KIN-015
Title: Interaction domain events with outcomes; beacon lifecycle; wire audio/juice for door, beacon, rope
Phase: 2
Priority: P1
Category: Gameplay / Architecture
User impact: High (three silent mechanics gain feedback)
Effort: Medium
Confidence: High

Problem: Door, ObjectiveBeacon, and PhysicsRope emit no domain events; interaction:triggered
carries only {id} with no outcome; the beacon stays focusable forever post-activation with a
"Beacon online" reason-prompt and blocked toasts; consequently these actions have no audio,
no juice, and (runtime-confirmed) beacon activation shows no detectable confirmation.
Evidence: src/interaction/interactables/Door.ts:159-170; ObjectiveBeacon.ts:174-184
(console.log only) and canInteract :162-165; PhysicsRope.ts (no emits);
InteractionManager.ts:241 ({id} payload), :290-291 (reason-as-prompt). AudioManager
reactions limited to grab/pickup/throw/focus/hold (src/audio/AudioManager.ts:362-416).
Audit §8 I-3/I-4/I-5, RT-BEACON.
Desired outcome: every interactable action emits a typed domain event with outcome;
beacon completes loudly once and stops soliciting; door/rope audible.

Relevant files: src/core/types.ts (event map — add interaction:doorToggled {id, open},
objective:beaconActivated {id}, interaction:ropeAttached/ropeReleased {id});
src/interaction/interactables/Door.ts, ObjectiveBeacon.ts, PhysicsRope.ts (emit via the
eventBus they already receive or are constructed near — thread it if absent);
src/interaction/InteractionManager.ts (include outcome in interaction:triggered payload;
refresh focus after trigger so state changes re-evaluate canInteract);
src/systems/InteractableSystem.ts (unregister or prompt-suppress beacon on activation);
src/audio/AudioManager.ts (door creak/close, beacon activation chord + duck, rope attach/
release swish — synthesize in src/audio/SFXEngine.ts following existing one-shot patterns);
src/Game.ts (juice: small FOV punch + particles burst on beaconActivated — beacon burst
already exists in ParticleSystem.ts:80-99, verify it fires from the new event);
src/systems/CheckpointObjectiveSystem.ts (complete the beacon objective from the new
domain event instead of generic triggered, fixing the RT-BEACON confirmation gap).
Relevant scenes or stations: door (primary), movement (rope), any editor level with these.
Existing assets to reuse: SFXEngine one-shot patterns (SFXEngine.ts:297-341), beacon
charge particles, objective toast flow.
New assets required: none (synthesized audio).

Implementation instructions:
1. Add the four event types to the EventBus map in src/core/types.ts.
2. Emit from each interactable at the state-change moment (door after swing state flips;
   beacon at hold-complete activation; rope on attach and on every detach path).
3. Extend interaction:triggered payload to { id, outcome?: string } without breaking
   existing listeners (optional field).
4. Beacon post-activation: unregister from InteractionManager (pattern: throwable
   unregister in InteractableSystem.ts:266-425 vicinity) so no prompt/blocked toasts remain.
5. CheckpointObjectiveSystem: listen for objective:beaconActivated to complete the beacon
   objective; verify the objective card updates and the "All objectives complete" toast
   fires in the full procedural run (this closes the RT-BEACON communication failure).
6. AudioManager: subscribe to the three new events; add door/beacon/rope one-shots with
   ±10% pitch variation, mirroring jump/land implementations.
7. Playwright: extend tests (beacon-hold-objective.ts) to assert, in the FULL procedural
   run (not only station mode): hold to completion → objective card changes → prompt gone.

Dependencies: KIN-002 (typed hooks help assertions). Do before KIN-016 (prompt pipeline
reads outcomes) and before Phase 6 audio tasks.
Out of scope: glyph/device prompts (KIN-016); spatial audio.
Behaviour that must not change: hold-charge pacing (3s); door swing physics; rope physics;
existing grab/throw events.

Acceptance criteria:
- Event log shows the four events firing at correct moments.
- Beacon: activation updates objective UI, plays audio + burst, removes prompt; re-approach
  shows nothing; procedural-run spec green (the audit's failing scenario).
- Door and rope actions audible.

Verification:
- Automated tests: extended beacon spec (procedural mode) + unit test for outcome payload.
- Manual test flow: door open/close ×3, beacon full ceremony, rope attach/detach — listen.
- Required screenshots: objective card completed state.
- Renderer paths: default + ?forceWebGL=1 (events are path-independent; audio identical).
- Input methods: keyboard + touch (interact button).
- Performance checks: none.

Regression risks: EventBus map change touches typing across listeners — compile catches;
beacon unregister must not break level unload (verify teardown).
Rollback or feature-flag strategy: events are additive; revert per-file.
```

```text
Task ID: KIN-016
Title: Prompt pipeline v2: fresh evaluation, clean clearing, and input-device glyphs
Phase: 2
Priority: P1
Category: UI-UX
User impact: High
Effort: Medium
Confidence: High

Problem: Prompts hardcode keyboard labels ("Press F", hold-ring "F", Help WASD) with no
input-source tracking; runtime probing showed prompt text going stale (retaining previous
labels while hidden and across focus changes).
Evidence: src/interaction/InteractionManager.ts:11-12,294-295; src/ui/components/HUD.ts:44;
src/ui/menus/HelpMenu.ts:27-50; no last-input-device tracking anywhere (audit §12 UI-F3,
RT-PROMPT).
Desired outcome: prompts re-evaluate on focus/state change, clear fully when unfocused,
and render device-appropriate glyphs (keyboard letter / gamepad button / touch icon) that
switch live with the active input source.

Relevant files: src/input/InputManager.ts (track lastInputSource: "keyboard"|"gamepad"|
"touch"; emit input:sourceChanged on transitions — keydown, gamepad button/axis past
deadzone, touchstart); src/interaction/InteractionManager.ts (buildPromptLabel takes a
glyph provider; re-emit prompt on canInteract state changes, not only focus changes);
src/ui/components/HUD.ts (prompt + hold-ring render glyph component; clear text on hide);
src/ui/menus/HelpMenu.ts (per-source key grids or dynamic glyphs); src/core/types.ts
(event).
Relevant systems: InputManager, InteractionManager, HUD, HelpMenu.
Existing assets to reuse: existing prompt/hold DOM; gamepad mapping tables in
InputManager.test.ts for names.
New assets required: none (text/unicode glyphs: Ⓐ-style or "A"/"×" labels; no images).

Implementation instructions:
1. InputManager: maintain lastInputSource with a small hysteresis (ignore gamepad noise
   under deadzone); expose getter + event.
2. Glyph map: action → { keyboard: "F", gamepad: "X", touch: "✋" } for interact, plus
   jump/sprint/crouch used by HelpMenu.
3. InteractionManager: re-run buildPromptLabel when (a) focus changes, (b) focused
   interactable's canInteract result changes (poll its cached allowed/reason per tick —
   cheap string compare), (c) input source changes.
4. HUD: setPrompt("") must clear textContent (fix stale text observed at §8); hold-ring
   letter driven by the same glyph provider.
5. HelpMenu: show all three columns or swap grid by current source (choose swap; simpler).
6. Playwright: assert prompt text contains the gamepad glyph after a synthetic gamepad
   poll (InputManager has test coverage patterns for gamepad state — reuse), and that
   prompt textContent is empty after walking out of range.

Dependencies: KIN-015 (outcome-aware prompts), KIN-002.
Out of scope: full remapping UI (KIN-020 exposes bindings; glyphs read from one map).
Behaviour that must not change: prompt positioning/animation; interact semantics.

Acceptance criteria: device switch (keyboard→gamepad input) swaps visible glyph within
500ms; leaving range empties prompt DOM; Help reflects active device.

Verification:
- Automated tests: extended interaction spec + InputManager unit tests for source tracking.
- Manual test flow: approach door with keyboard, wiggle gamepad stick, watch glyph swap;
  touch emulation shows touch glyph.
- Required screenshots: same prompt under two sources.
- Renderer paths: default. Input methods: all three (gamepad via simulated state).
- Performance checks: no per-tick allocation in the re-evaluation path.

Regression risks: prompt re-emit loops — guard with string-compare dedup.
Rollback or feature-flag strategy: glyph provider defaults to keyboard map (revert = old text).
```

```text
Task ID: KIN-017
Title: Vehicle exit safety and manual reset input
Phase: 2
Priority: P2
Category: Gameplay / Defect fix
User impact: Medium-High (stuck states are session-enders)
Effort: Medium
Confidence: Medium

Problem: (a) Car exit falls back to projected candidate 0 unconditionally when all three
candidates fail clearance — can place the player inside a wall; (b) drone exit validates a
thin ray, not capsule fit; (c) no manual reset/flip input — a car wedged upside-down where
upright-assist torque is blocked has no recovery (OOB reset only at y<-8).
Evidence: src/vehicle/CarController.ts:297-305,865-869 (fallback), 1978-2015 (clearance
test), 1695-1746 (upright assist); src/vehicle/DroneController.ts:184-192;
src/vehicle/VehicleManager.ts:17,210-224. Audit §9 C-1/C-2/C-3.
Desired outcome: exits never embed the player; a held input rights/resets the active vehicle.

Relevant files: as cited; src/ui (prompt line for reset hint via existing status lane);
src/core/types.ts if a vehicle:reset event helps audio/VFX later.
Relevant scenes or stations: vehicles.
Existing assets to reuse: capsule intersectsShape test (CarController.ts:1978-1995);
resetToSpawn (exists, exposed via __KINEMA__).
New assets required: none.

Implementation instructions:
1. Car exit: add fallback candidates (rear of vehicle, then above roof with downward
   settle) validated by the same capsule test; only if ALL fail, place above roof + small
   upward pop (never inside geometry).
2. Drone exit: replace the thin-ray blockage check with the car's capsule intersectsShape
   validation.
3. Manual reset: while seated, holding the interact key... conflicts with exit — use a
   dedicated chord instead: hold handbrake/crouch (C) 1.5s while upside-down OR stationary
   <0.5 m/s → resetToSpawn-style upright at nearest safe pose (reuse resetToSpawn); show
   hold progress via the existing hud-hold ring.
4. Playwright: extend tests/vehicle-controllers.ts — forceVehicleTransform the car flush
   against the boundary wall, exit, assert player capsule position not intersecting wall
   (position delta from wall plane); flip car upside-down wedged (forceVehicleTransform
   rotation), simulate hold, assert upright within 3s.

Dependencies: KIN-002. Design approval on the reset input choice.
Out of scope: vehicle VFX/audio (KIN-025/KIN-026 wave); spike/coin policy (design decision).
Behaviour that must not change: normal exits; upright assist in open space; exit cooldown.

Acceptance criteria: wall-flush exits place the player free and standing in 20/20 attempts
(scripted); wedged flip recovers via hold; specs green.

Verification:
- Automated tests: extended vehicle-controllers spec (serial run).
- Manual test flow: drive into corner, exit; flip in corner, hold-reset; drone ledge exit.
- Required screenshots: none.
- Renderer paths: default. Input methods: keyboard + gamepad mapping for the chord.
- Performance checks: none.

Regression risks: exit-position changes could break existing exit assertions — update spec
expectations deliberately.
Rollback or feature-flag strategy: fallback candidates behind a small config flag.
```

## Phase 3 — UI, UX, and Editor Workflow

```text
Task ID: KIN-018
Title: Accessibility bundle: focus visibility, dialog semantics, live regions, labels
Phase: 3
Priority: P1
Category: Accessibility / UI-UX
User impact: High
Effort: Medium
Confidence: High

Problem: No authored :focus-visible on buttons/tabs/checkboxes/touch controls (runtime-
verified invisible default outline); menus lack dialog roles, focus trap/restore; status/
objective/collectible/health changes have no aria-live; icon-only touch buttons unlabeled;
opacity-0 HUD/orientation-hint exposed to assistive tech at the menu.
Evidence: menus.css:419-517,592-628,775-801; touch-controls.css:83; MenuManager.ts:52-53,
133-172; HUD.ts:53-72,139-157,165,183; TouchButton.ts:37; runtime evidence/02 and §12/§18.
Desired outcome: WCAG 2.4.7/4.1.2/4.1.3 pass for the menu and HUD surfaces.

Relevant files: src/ui/menus/menus.css (add shared :focus-visible rule using
--menu-accent-cyan, 2px outline + 2px offset targeting .menu-button, .menu-tab,
.menu-button-small, .menu-button-danger, .menu-field input[type=checkbox]);
src/ui/touch-controls.css (focus ring; remove outline:none);
src/ui/menus/MenuManager.ts (on push: role="dialog" aria-modal="true"
aria-labelledby=title id, focus first button, Tab wrap within top screen; on pop: restore
invoker focus; pop-to-root fix from KIN-006 reused);
src/ui/components/HUD.ts (status lane + objective aria-live="polite"; collectible/hearts
aria-labels; aria-hidden="true" while opacity 0 — toggle with show/hide);
src/ui/UIManager.ts:181-244 (hint aria-hidden management);
src/input/TouchControlsManager.ts:65-104 + src/input/TouchButton.ts:37 (aria-labels:
"Jump", "Sprint", "Interact", "Crouch", joystick role note).
Relevant systems: MenuManager, HUD, touch controls.
Existing assets to reuse: existing slider/select focus ring pattern (menus.css:643-651).
New assets required: none.

Implementation instructions: (as the file list above, one surface at a time)
1-6. Apply per-file changes; keep the ring token in one rule; verify no visual change for
mouse users (focus-visible only).
7. Playwright: keyboard pass spec — Tab from load must show a visible ring (assert
computed outline on focused element ≠ default), focus lands inside Settings on open and
returns to the invoker on Escape; touch buttons expose aria-labels.

Dependencies: KIN-006 (menu stack), KIN-002.
Out of scope: gamepad nav (KIN-019); remapping (KIN-020); reduced-motion (KIN-020).
Behaviour that must not change: visual design for pointer users; menu layout.

Acceptance criteria: keyboard-only user can operate main menu → Settings → back with a
visible ring at every stop and no focus escaping the dialog; screen-reader smoke test
announces dialog + labels (manual, NVDA or Narrator).

Verification:
- Automated tests: new a11y spec assertions.
- Manual test flow: Tab-through pass; Narrator/NVDA smoke.
- Required screenshots: focus ring on 3 control types (refresh evidence/02).
- Renderer paths: default. Input methods: keyboard + touch emulation.
- Performance checks: none.

Regression risks: focus trap fighting the pointer-lock click-through — scope trap to menu
open state only.
Rollback or feature-flag strategy: CSS/aria additive; revert per-file.
```

```text
Task ID: KIN-019
Title: Gamepad menu navigation and pause binding
Phase: 3
Priority: P1
Category: UI-UX / Input
User impact: High for controller users (currently locked out of menus)
Effort: Medium
Confidence: High

Problem: Menus cannot be navigated by gamepad at all, and no gamepad button opens pause
(Escape is keyboard-only) — a controller player cannot start, pause, or configure.
Evidence: gamepad state consumed only in gameplay polling (src/input/InputManager.ts:116,224);
menu:toggle emitted only from Escape (:319); MenuManager mouse/DOM-only (:97-108,251-286).
Audit §12 UI-F2.
Desired outcome: D-pad/left-stick moves focus, A/Enter activates, B backs out, Start
toggles pause — whenever a menu is open; Start opens pause in gameplay.

Relevant files: src/input/InputManager.ts (menu-mode gamepad reader: when
MenuManager.isMenuOpen() — expose a query or listen to menu:opened/closed — poll buttons
with repeat-delay and drive focus); src/ui/menus/MenuManager.ts (focusNext/focusPrev over
the active screen's focusable buttons — DOM order; activate = .click(); back = pop());
mapping: Start(9)→menu:toggle also during gameplay.
Relevant systems: InputManager, MenuManager.
Existing assets to reuse: KIN-018 focus rings (gamepad nav drives the same focus);
gamepad button mapping tables already unit-tested (InputManager.test.ts).
New assets required: none.

Implementation instructions:
1. Track menu-open state in InputManager via menu:opened/menu:closed events (exist per
   AudioManager usage AudioManager.ts:523-539).
2. In the input poll loop, when menu open: read dpad up/down + left-stick Y (deadzone
   0.5, initial 400ms then 150ms repeat), A (activate), B (back); suppress gameplay input.
3. Gameplay mode: Start edge → emit menu:toggle.
4. Drive document focus (button.focus()) so KIN-018 rings show; activation clicks the
   focused element (works for checkboxes/selects too — for sliders, left/right adjusts
   ±step when a slider is focused).
5. Unit-test the new mapping (extend InputManager.test.ts gamepad matrices).
6. Playwright cannot emulate Gamepad API directly — assert via unit tests + a DEV-only
   __KINEMA__.simulateGamepadMenuInput(button) hook exercised by a small spec.

Dependencies: KIN-018 (rings), KIN-002/003 (hook typing).
Out of scope: remapping; glyph swap (KIN-016 handles).
Behaviour that must not change: gameplay gamepad feel; keyboard/mouse menu operation.

Acceptance criteria: full menu journey (main → settings → change a slider → back → play →
pause → resume) completable with only a controller (manual, hardware) and via the
simulation hook (automated).

Verification:
- Automated tests: unit matrices + hook-driven spec.
- Manual test flow: hardware controller journey (mark as requires-hardware if unavailable;
  do not claim verified without it).
- Required screenshots: focused button via gamepad nav.
- Renderer paths: default. Input methods: gamepad (primary), keyboard (non-regression).
- Performance checks: none.

Regression risks: input suppression while menu open must release cleanly on close.
Rollback or feature-flag strategy: gate menu-reader behind a settings flag default-on.
```

```text
Task ID: KIN-020
Title: Settings integrity and comfort options (persistence, ranges, motion/flash/hold-toggle, remap core)
Phase: 3
Priority: P1
Category: UI-UX / Accessibility
User impact: High
Effort: Large
Confidence: Medium-High

Problem: Six graphics toggles (Post-processing/SSAO/SSR/Bloom/Vignette/LUT) silently don't
persist and can show stale initial state; slider ranges are narrower than store clamps
(FOV 60-75 vs 50-90; deadzone floor lies); and the settings surface lacks: camera-effects
intensity, damage-flash cap, in-app reduced motion, sprint/crouch hold-vs-toggle,
gamepad/touch look-sensitivity, and any input remapping.
Evidence: UserSettings.ts:5-23 (missing fields); Game.ts:234-236,272-298 (debug-event-only);
SettingsMenu.ts:86,107,116,139-142,204 (ranges/stale init); hardcoded sensitivities
InputManager.ts:8, TouchControlsManager.ts:23; hardcoded keys InputManager.ts:122-163,316;
camera stack CAM-1 (constants.ts:99-105 + ScreenShake); damage flash hud.css:346-352.
Audit §12 UI-F4/F9/F10, §11 CAM-1, §18.
Desired outcome: every Settings control persists and applies; comfort/access options exist;
core five actions rebindable.

Relevant files: src/core/UserSettings.ts (add fields + clamps + migration defaults);
src/ui/menus/SettingsMenu.ts (persist the six via settings.update; import range constants
from UserSettings; new controls); src/Game.ts (apply persisted post flags on boot like
existing profile application at :234-298); src/camera/OrbitFollowCamera.ts + src/juice/
ScreenShake.ts/FOVPunch.ts (multiply by settings.cameraEffectsIntensity 0–1);
src/ui/hud.css + HUD.ts (flash cap class); src/input/InputManager.ts (bindings map
keyed by action, persisted; sensitivities from settings); src/ui/menus/HelpMenu.ts
(reflect rebinds via KIN-016 glyph map).
Relevant systems: UserSettings, SettingsMenu, renderer flags, camera/juice, input.
Existing assets to reuse: UserSettings migration pattern (:69-179); settings slider
components.
New assets required: none.

Implementation instructions:
1. Persistence: add the six post flags to UserSettings (default = profile-derived on
   first run: read current renderer flags at save-time); apply on boot after profile.
2. Ranges: export min/max constants from UserSettings and import in SettingsMenu; fix
   deadzone floor to 0.02.
3. Comfort: cameraEffectsIntensity (0–1, default 1) multiplying look-ahead, lateral
   drift, landing dip, FOV kicks, shake amplitude; reducedMotion ("system"|"on"|"off");
   damageFlashIntensity (0–1 → caps overlay opacity/duration).
4. Hold/toggle: sprint and crouch mode settings consumed in InputManager poll.
5. Remap: bindings map for move(4)/jump/interact/crouch/sprint; capture-next-key UI in
   Controls tab; conflict = swap; reset-to-default button. Persist.
6. Look sensitivity: expose GAMEPAD_LOOK_SPEED and TOUCH_LOOK_SENSITIVITY as settings.
7. Split UI: keep the six post toggles in Graphics but now honest; add "Comfort" section
   under Controls.
8. Tests: UserSettings unit tests for new fields/migration; spec: toggle SSAO off,
   reload, assert still off and applied (getRendererDebugFlags).

Dependencies: KIN-016 (glyph map reads bindings), KIN-018/019 (menu semantics).
Out of scope: per-profile audio settings; VFX density user override (profile-driven,
KIN-026).
Behaviour that must not change: default feel with all settings at defaults (intensity 1
must be bit-identical camera behavior).

Acceptance criteria: reload persistence for every control in Settings; camera intensity 0
yields a visibly stable camera (capture); rebound interact key updates prompts (KIN-016);
sliders reach store extremes.

Verification:
- Automated tests: unit + persistence spec.
- Manual test flow: full settings sweep; motion-sensitive pass at intensity 0.25.
- Required screenshots: new Comfort section; Controls with remap UI.
- Renderer paths: default + compat (post toggles apply where supported).
- Input methods: all three.
- Performance checks: none.

Regression risks: boot-order of persisted flags vs profile application — apply profile
first, then user overrides (mirror existing sequence in src/main.ts:106-113).
Rollback or feature-flag strategy: new fields default to legacy behavior; migration keeps
old saves valid.
```

```text
Task ID: KIN-021
Title: Editor trust: dirty-state, unsaved-changes warning, Ctrl+S, overwrite confirm, GLB session banner
Phase: 3
Priority: P1
Category: Editor
User impact: Transformational for creators
Effort: Medium
Confidence: High

Problem: No dirty flag exists; refresh/close silently loses work; tooltip advertises
Ctrl+S but no handler exists (browser Save dialog appears; FreeCamera eats KeyS);
same-name saves silently overwrite; imported GLBs are session-local with only a
console.warn and become magenta wireframes on reload with no explanation.
Evidence: audit §13 ED-F1/F3/F13/F9 with citations (main.ts:746-751; ToolbarPanel.ts:49;
EditorManager.ts:584-666; LevelSaveStore.ts:33-35; GLBPlacementTool.ts:81-84;
EditorManager.ts:1468-1482).
Desired outcome: PlayCanvas-grade save honesty at Kinema scope.

Relevant files: src/editor/EditorManager.ts (dirty flag set by every mutation path —
command execution, inspector edits, document ops; cleared on save/load; KeyS+cmd handler
with preventDefault before FreeCamera consumes it; overwrite confirm using
LevelSaveStore.list()); src/editor/panels/ToolbarPanel.ts (dirty dot on Save button);
src/main.ts:746-751 (beforeunload preventDefault when dirty AND editor active or
play-testing); src/editor/tools/GLBPlacementTool.ts (post-import banner);
src/editor/EditorManager.ts:1468-1482 (flag placeholder-substituted objects in hierarchy
with a warning row/icon + inspector note).
Relevant systems: editor document/lifecycle, save flow.
Existing assets to reuse: CommandHistory (all commands already funnel through it — hook
dirty there for command-based edits); KIN-009 result contract.
New assets required: none.

Implementation instructions:
1. dirty: set on CommandHistory.execute/undo/redo and on every direct-mutation site
   found in the ED-F6 table (they exist until KIN-022 routes them through commands —
   set dirty at the mutation helpers to cover both eras).
2. Toolbar dot + title suffix "Untitled*"; clear on successful save (KIN-009 ok).
3. Ctrl/Cmd+S in EditorManager.onKeyDown (capture phase, before FreeCamera; preventDefault).
4. Overwrite: if LevelSaveStore.list() contains the chosen name, confirm dialog.
5. beforeunload: preventDefault + returnValue when dirty.
6. GLB import: non-blocking banner "Imported model is session-only — copy it to
   public/assets/models/ to keep it after reload." with dismiss; on load, placeholder
   objects get a ⚠ marker in hierarchy + inspector explanation.
7. Extend tests/editor-flow.ts: mutate → dirty dot visible; save → cleared; Ctrl+S saves
   (no browser dialog — assert via saved list); reload with dirty → cannot assert native
   dialog in Playwright, assert the handler registers preventDefault intent via an
   exposed flag instead.

Dependencies: KIN-003 (hooks/tests), KIN-006 (lifecycle), KIN-009 (save results).
Out of scope: undo coverage (KIN-022); open dialog (KIN-022 wave).
Behaviour that must not change: save format; download fallback behavior from KIN-009.

Acceptance criteria: the four trust behaviors demonstrable; no browser Save dialog on
Ctrl+S; banner appears on GLB import; placeholders explained on reload.

Verification:
- Automated tests: extended editor-flow spec + unit for dirty transitions.
- Manual test flow: full create→save→import GLB→reload cycle.
- Required screenshots: dirty dot; GLB banner; placeholder marker.
- Renderer paths: default. Input methods: keyboard+mouse.
- Performance checks: none.

Regression risks: capture-phase KeyS vs FreeCamera backward movement — only intercept
with cmd/ctrl modifier.
Rollback or feature-flag strategy: per-feature revert; dirty flag is additive.
```

```text
Task ID: KIN-022
Title: Editor undo-everywhere, child-aware delete, camera persistence, drag-end collider rebuild
Phase: 3
Priority: P2
Category: Editor
User impact: High
Effort: Large
Confidence: Medium

Problem: Undo skips inspector transforms, material edits, physics-type, rename, reparent,
group/ungroup, visibility, lock (direct mutations); deleting a parent orphans children
(dangling parentId, invisible-but-listed, broken serialization); editor camera pose is
lost on plain F1 toggle; dragging non-cuboid brushes rebuilds trimesh colliders every
objectChange event.
Evidence: audit §13 ED-F6 coverage table (EditorManager.ts:982-1104,109-154);
ED-F7 (:1262-1284, HierarchyPanel.ts:210-218); ED-F14 (FreeCamera.enable:89-94);
ED-F5 (:1218-1222,1133-1143).
Desired outcome: every editor mutation is undoable; deletes are subtree-consistent;
camera persists; drags are smooth.

Relevant files: src/editor/EditorManager.ts (route the direct-mutation sites through
CommandHistory commands with before/after captures); src/editor/EditorDocument.ts
(subtree collection for delete); src/editor/panels/InspectorPanel.ts (edit-commit
boundaries: push one command per field commit, not per keystroke);
src/editor/CommandHistory.ts (optional coalescing key for slider scrubs);
src/editor/FreeCamera.ts + EditorManager enter/exit (persist pose across toggles);
src/editor/EditorManager.ts:1110-1143 (defer needsRebuild to drag-end; rebuild trimesh
only when scale changed).
Relevant systems: editor command/document layer.
Existing assets to reuse: KIN-003 CommandHistory tests (extend per new command);
existing gizmo drag-end command pattern (:1110-1131) as the template.
New assets required: none.

Implementation instructions:
1. Define command builders: SetTransform, SetMaterialProp, SetPhysicsType, Rename,
   Reparent, Group, Ungroup, SetVisibility, SetLock, DeleteSubtree (collects descendants
   depth-first; undo restores tree + physics + meshes).
2. Inspector: commit on blur/enter/slider-release; coalesce continuous scrubs into one
   command.
3. Delete: replace single-target removal with DeleteSubtree everywhere (Delete key,
   context menu).
4. Camera: save FreeCamera pose in exit(), restore in enter() when present (play-test
   path already does this — unify the mechanism).
5. Drag: set needsRebuild only at onGizmoDragEnd; translation-only changes on trimesh
   shapes update collider position without rebake.
6. Tests: extend CommandHistory units per command (round-trip execute/undo leaves
   document deep-equal); editor-flow spec: material color change → Ctrl+Z restores;
   delete parent → children gone from hierarchy and save output; F1 out/in retains
   camera position (getEditorObjectCount + a camera-pose hook).

Dependencies: KIN-003, KIN-021 (dirty integrates with commands).
Out of scope: multi-select, drag-to-size, primitive palette (deferred wave).
Behaviour that must not change: serialization format; existing undoable actions.

Acceptance criteria: ED-F6 table rows all flip to "Yes"; orphan-children repro fixed;
smooth pillar drag (frame stats during drag show no rebuild spikes); camera persists.

Verification:
- Automated tests: unit + spec as above; npm run test.
- Manual test flow: 15-minute editing session exercising every mutation with undo/redo.
- Required screenshots: none (state assertions).
- Renderer paths: default. Input methods: keyboard+mouse.
- Performance checks: KIN-001 stats during trimesh drag before/after.

Regression risks: highest in backlog — the command refactor touches many paths; land
command-by-command with tests green between each.
Rollback or feature-flag strategy: per-command commits; revert individually.
```

```text
Task ID: KIN-023
Title: Landscape HUD/touch layout grid; hide gameplay HUD inside the editor
Phase: 3
Priority: P2
Category: UI-UX / Mobile
User impact: High for touch players
Effort: Small-Medium
Confidence: High

Problem: In mobile landscape, the jump button collides with the hearts chip, interact
with the objective card, and sprint hides behind the coin chip; separately, the gameplay
HUD stays visible inside the editor behind panels.
Evidence: evidence/19-mobile-landscape-ingame-touch-compat.png (collisions);
evidence/15-editor-opened.png (HUD in editor); hud.css:183-192 vs touch-controls.css
landscape blocks (:118-177). Audit §12 RT-TOUCH / RT-EDITORHUD; TEST gap: the passing
mobile-landscape-layout spec checks only touch-vs-touch overlap.
Desired outcome: no HUD/touch intersection at 844×390 through 932×430 landscapes;
editor shows no gameplay HUD.

Relevant files: src/ui/hud.css (landscape media block: shift hearts/objective/coin chips
inward/downsize when (orientation:landscape) and (max-height:500px));
src/ui/touch-controls.css (reserve corner exclusion zones); src/ui/UIManager.ts
(hide/show HUD on editor:opened/editor:closed — events exist); tests/mobile-landscape-layout.ts
(extend assertions to include HUD chip rects vs touch button rects).
Relevant systems: HUD, TouchControlsManager, UIManager.
Existing assets to reuse: existing landscape media queries; editor:opened/closed events.
New assets required: none.

Implementation instructions:
1. Define the landscape layout contract: corners = touch clusters; HUD chips move to
   top-center band (coin left-of-center, hearts right-of-center, objective below hearts
   band with reduced width).
2. Apply via CSS only (no JS layout).
3. UIManager: subscribe editor:opened → hide #hud root (aria-hidden too, per KIN-018);
   editor:closed → restore.
4. Extend the landscape spec: assert pairwise non-intersection of ALL touch buttons vs
   ALL HUD chips at 844×390 and 932×430.

Dependencies: KIN-018 (aria-hidden pattern).
Out of scope: portrait tweaks (no collision found); editor mobile.
Behaviour that must not change: desktop HUD layout; safe-area handling.

Acceptance criteria: extended spec green at both sizes; editor session shows no hearts/
coins (evidence re-capture).

Verification:
- Automated tests: extended mobile-landscape-layout.ts.
- Manual test flow: landscape emulation walkthrough; editor open/close.
- Required screenshots: re-capture of evidence/19 and evidence/15 equivalents.
- Renderer paths: compat (mobile path). Input methods: touch.
- Performance checks: none.

Regression risks: CSS collisions with notch safe-areas — test with viewport-fit device.
Rollback or feature-flag strategy: CSS revert.
```

```text
Task ID: KIN-024
Title: Unify design tokens (color triad, spacing, z-index) across all UI surfaces
Phase: 3
Priority: P2
Category: UI-UX
User impact: Medium (perceived polish/consistency)
Effort: Medium
Confidence: High

Problem: Design tokens exist only in menus.css; touch controls and DeathEffect use a
near-duplicate divergent triad (#7b2fff/#ff6b9d/#00d2ff vs #7b6cff/#ff79ba/#62e6ff);
spacing and z-index are magic numbers across 8 files; Google Fonts is a runtime
dependency with no bundled fallback.
Evidence: menus.css:1-12; touch-controls.css:70-108; DeathEffect.ts:7;
VirtualJoystick.ts:253-254; z-index inventory audit §12; index.html:10.
Desired outcome: one token source consumed everywhere; single accent triad; documented
z-scale; font fallback that doesn't flash unstyled on offline/dev.

Relevant files: NEW src/ui/tokens.css (imported first by menus.css, hud.css,
touch-controls.css, src/editor/styles/editor.css); DeathEffect.ts + VirtualJoystick.ts +
LoadingScreen.ts + DebugPanel.ts (read getComputedStyle custom props or move inline
colors to classes); index.html (font-display strategy + local fallback stack).
Relevant systems: all UI surfaces.
Existing assets to reuse: the menu triad as canonical.
New assets required: none (self-host fonts NOT required — fallback stack suffices at
lab scope; self-hosting is a deferred option).

Implementation instructions:
1. tokens.css: --k-accent/-hover/-cyan, --k-text/-muted, --k-bg variants, --k-space-1..6
   (4/8/12/16/24/32), --k-z-canvas..--k-z-fatal matching the current working order
   (0/10/100/999/1000/1100/1200/1250/1300/99999).
2. Migrate the divergent triad consumers to the canonical tokens (visual delta is subtle:
   #7b2fff→#7b6cff etc. — capture before/after of touch controls + death effect).
3. Replace z-index literals with tokens file-by-file (behavior-preserving).
4. Keep DebugPanel's separate blue-grey theme but source its z-index from tokens.
5. Fonts: font-display: swap is in the Google URL already? verify; add full local
   fallback stack (system-ui chain) so offline dev renders cleanly.

Dependencies: after KIN-018/023 (avoid merge conflicts in the same CSS).
Out of scope: any redesign; editor visual refresh.
Behaviour that must not change: layout metrics; z-order.

Acceptance criteria: grep finds no hex from the old touch triad; KIN-004 visual anchors
within tolerance (menu unchanged); death/touch capture approved.

Verification:
- Automated tests: KIN-004 anchors; existing menu-responsive spec.
- Manual test flow: menu/HUD/touch/death/editor visual sweep.
- Required screenshots: before/after touch + death effect.
- Renderer paths: default. Input methods: touch + keyboard.
- Performance checks: none.

Regression risks: z-order subtleties — migrate literal-to-token 1:1, no renumbering.
Rollback or feature-flag strategy: CSS revert per-file.
```

## Phases 4–6 — Feel, Art, VFX, Audio

```text
Task ID: KIN-025
Title: Complete the feedback contract: missing juice hooks, coin x/70 + celebration, checkpoint respawn on death
Phase: 4
Priority: P2
Category: Gameplay tuning / UI-UX / VFX
User impact: High
Effort: Medium
Confidence: Medium-High

Problem: Core actions lack any feedback hook (crouch, sprint-start, pickup/drop, ladder/
rope attach, vehicle enter/exit/boost, collect camera-pop); collectibles show a bare
count with no total, no completion event, nothing at 70/70; death (0 hearts) triggers a
full level reload wiping all progress — punishing for a sandbox (design-approval item).
Evidence: audit §11 JUICE-1 (wired list at Game.ts:167-228; ParticleSystem.ts:31-99);
§10/§15 LVL-F7 (HUD.ts:191-204, no total/event); §10 LVL-F5 (PlayerHealthSystem.ts:116-120
→ full-reset → main.ts:368-388 reload); checkpoint exists (CheckpointObjectiveSystem.ts:61).
Desired outcome: every listed action has a proportionate feedback response; coins read
x/70 with a one-shot celebration at completion; death respawns at last checkpoint
(fall-back: entrance) without reload, preserving coins.

Relevant files: src/Game.ts (juice wiring — small FOVPunch/addTrauma presets per event;
uses events incl. KIN-015's); src/juice/* (presets); src/systems/CoinCollectibleSystem.ts
(emit collectible:allCollected; expose total); src/ui/components/HUD.ts (x/total chip;
celebration pulse); src/systems/ParticleSystem.ts (celebration burst reusing coin pool);
src/audio (celebration chord via existing objectiveComplete pattern);
src/systems/PlayerHealthSystem.ts (death resolution: "checkpoint-respawn" instead of
"full-reset" when a checkpoint is active; keep full-reset when none);
src/core/types.ts (allCollected event).
Relevant systems: juice, coins, health, HUD.
Existing assets to reuse: all pools/synths; hud pulse mechanics (HUD.ts:342-355).
New assets required: none.

Implementation instructions:
1. Juice presets table: {event → {fovPunch?, trauma?, particles?}} kept small (crouch:
   none visual, audio only exists; pickup/drop: tiny fov 0.5; vehicle enter/exit: trauma
   0.15 + dust burst at seat; boost: fov +3 sustained while held (via existing speed
   FOV path); collect: 0.3 fov pop). Do NOT add shake to menu/UI actions.
2. Coins: expose total from CoinLayout registration; HUD chip "n/70"; at n==total emit
   allCollected → celebration burst + chord + status toast.
3. Death: in resolveDeath, if checkpointManager has an active respawn point →
   respawn there with i-frames + full hearts, no reload; else current behavior.
   FLAG: requires design approval (plan §16); implement behind a const
   DEATH_RESPAWN_AT_CHECKPOINT = true for easy flip.
4. Specs: extend procedural-hazards.ts — 3 hits with checkpoint active → position ==
   checkpoint, coins preserved; coins spec — collect all in one station via
   teleportToCollectible loop, assert chip text n/70 increments.

Dependencies: KIN-015 (events), KIN-020 (cameraEffectsIntensity multiplies new juice).
Out of scope: vehicle VFX (KIN-026 wave); audio lifecycle (KIN-027).
Behaviour that must not change: existing jump/land/throw juice; hazard i-frames.

Acceptance criteria: action-by-action manual sweep shows proportionate feedback with
intensity slider scaling all of it; death respawn preserves coins; specs green.

Verification:
- Automated tests: extended hazards + coins specs.
- Manual test flow: full action sweep on foot + vehicle.
- Required screenshots: x/70 chip; celebration moment.
- Renderer paths: default + compat (bursts are all-path pools).
- Input methods: keyboard + touch.
- Performance checks: frame stats during celebration burst.

Regression risks: death-flow change touches restart machinery — keep full-reset code
path intact behind the flag.
Rollback or feature-flag strategy: DEATH_RESPAWN_AT_CHECKPOINT flag; juice preset table
entries individually removable.
```

```text
Task ID: KIN-026
Title: VFX system pass: profile scaling, sparkle culling, vehicle dust/skid/boost, compat parity behavior
Phase: 6
Priority: P2
Category: VFX / Performance / Rendering
User impact: High (vehicles feel alive; low-end perf)
Effort: Large
Confidence: Medium

Problem: Graphics profiles never scale VFX density (all counts hardcoded: 400 sparkles
uncullable, 60 motes, 400 grass blades/strip, 200 rain, 40 embers, 100 orbit points, 7
pools); heavy additive stacks near the VFX bay at cinematic 2.0 DPR; zero vehicle motion
VFX (dust suppressed while driving); several small leaks/allocs.
Evidence: audit §15 R3/R5/R6 with citations (SparkleParticles.ts:44-130,120,129;
ProceduralBuilder.ts:374-384,2676-2712; GrassEffect.ts:10-134; VfxShowcase.ts:159,563,714,
631-644; ParticleSystem.ts:54-64; R8 ProceduralBuilder.ts:4059; R12 VfxShowcase.ts:483-486).
Desired outcome: per-profile density multipliers (perf 0.35 / balanced 0.65 / cinematic
1.0) across ambient systems; sparkles distance-culled; pooled wheel-speed dust + skid
marks + boost trail on all paths; leaks fixed.

Relevant files: src/renderer/pipelineProfile.ts or a new src/core/vfxProfile.ts (single
multiplier source consumed at build time); ProceduralBuilder.ts (sparkles/motes/grass
counts × multiplier; region-based sparkle culling by camera Z); VfxShowcase.ts (rain/
ember/orbit counts; dead rainDropGeo removal; self-sufficient dispose);
src/systems/ParticleSystem.ts + GameParticles.ts (vehicle dust emitter: pooled
MeshBasicMaterial billboards driven by wheel contact + speed from
vehicle:speedUpdate/handlingUpdate events — events exist per AudioManager.ts:222-227);
CarController (emit wheel-contact world positions in the existing handling payload if
absent); ProceduralBuilder.ts:4059 (hoist scratch vector).
Relevant scenes or stations: corridor-wide, vfx, vehicles.
Relevant systems: renderer profiles, particle pools, vehicle controllers.
Existing assets to reuse: ParticlePool SOA implementation; Kenney smoke textures already
in assets for VfxShowcase smoke.
New assets required: none.

Implementation instructions:
1. Introduce getVfxDensity(profile) and thread through every hardcoded count site listed
   above (build-time; profile switch mid-session may keep current density until next
   load — acceptable, document it).
2. Sparkles: chunk into 4 corridor regions, cull by player Z distance (re-enable
   frustumCulled where math allows).
3. Vehicle dust: pooled emitter, rate ∝ speed, only when wheels grounded; skid puffs on
   drift/handbrake (handlingUpdate has drift amount); boost trail = brief additive
   streak; all MeshBasicMaterial (all-path); density × profile multiplier; respects a
   reduced-effects intent (map to performance profile initially).
4. Fix R8/R12 allocations/leaks.
5. Specs: extend vfx-particles.ts — assert particle runtime density differs between
   performance and cinematic loads (expose active-count via a __KINEMA__ hook);
   vehicle spec asserts dust emitter activates while driving.

Dependencies: KIN-001 (measure), KIN-015/KIN-017 (events stable), KIN-005 (profile spec).
Out of scope: compat post stack (KIN-028); new showcase effects.
Behaviour that must not change: gameplay burst feedback (pools stay full-density —
they are tier-2 feedback, not ambient).

Acceptance criteria: performance profile shows measurably fewer ambient particles
(hook count) and better p95 at the vfx bay (KIN-001 before/after); driving produces dust
on all three paths; heap stable across 3 vfx-station loads.

Verification:
- Automated tests: extended vfx + vehicle specs.
- Manual test flow: drive with drift/boost on all paths; profile A/B at vfx bay.
- Required screenshots: vehicle dust on WebGPU + compat; perf-vs-cinematic vfx bay pair.
- Renderer paths: all three.
- Input methods: keyboard.
- Performance checks: KIN-001 p95 at vfx bay per profile, recorded in the baseline doc.

Regression risks: density threading touches many builders — do counts-only changes,
no structural edits; screenshot-gate cinematic look (KIN-004 tolerance).
Rollback or feature-flag strategy: getVfxDensity returns 1.0 → exact current behavior.
```

```text
Task ID: KIN-027
Title: Audio lifecycle correctness: pause, tab-visibility, editor ducking, restart race, pooling
Phase: 6
Priority: P2
Category: Audio
User impact: High (worst offenders in a prototyping tool)
Effort: Medium
Confidence: High

Problem: Pausing while driving leaves the engine droning under the menu (only music
ducks); backgrounding the tab keeps music/engine playing; the editor keeps full music
forever; a stop→start race within the 1.6s fade can double-layer music; per-event synth/
Reverb allocation risks pops (UI hover, death, checkpoint).
Evidence: audit §17 A1/A2/A3/A4/A6/A7 with citations (AudioManager.ts:523-539 duck-only;
no visibilitychange in src/**; EditorManager.ts:367 + no editor:* audio subscription;
MusicEngine.ts:162,164,175-220,242-261; SFXEngine.ts:770-794,844, checkpoint :322-323).
Desired outcome: audio always matches context; no doubled music; no allocation pops.

Relevant files: src/audio/AudioManager.ts (menu:opened pause → ramp SFX bus to ~0.1 &
pause sustained sources; menu:closed restore; editor:opened → stopMusic(1.0) or duck to
0.15 [choose duck: SFX remain for editor feedback later]; editor:closed → restore;
visibilitychange → Tone context suspend/resume with guard for gesture requirements);
src/audio/MusicEngine.ts (start(): force-dispose existing loops before creating; stop():
capture loop refs locally for deferred dispose); src/audio/SFXEngine.ts (pooled UI synth
with min-interval 60ms; pre-built death reverb + checkpoint FM/chorus at construction).
Relevant systems: audio.
Existing assets to reuse: createSafeDynamicsStage degradation pattern; pendingUnducks
hygiene.
New assets required: none.

Implementation instructions: (per file list; sequence: race fix → pause/visibility →
editor → pooling)
1-4 as above.
5. Unit tests: mock Tone (pattern exists in createSafeDynamicsStage.test.ts) — assert
   start-after-stop disposes old loops (A4); assert pause event pauses sustained sources;
   assert UI synth reuse (single instance across 10 triggers).

Dependencies: KIN-015 (if editor audio ticks come later they hang off these hooks).
Out of scope: new SFX content (door/beacon/rope land with KIN-015; boost/collision with
KIN-026 wave); music reachability/motif retune (A9/A10 — separate design-review task,
deferred).
Behaviour that must not change: land dedup; volume settings routing; degraded-path
fallbacks.

Acceptance criteria: pause while driving = near-silence then clean resume; tab switch
30s = silence, return = resume; editor session music ducked; 10 rapid menu round-trips
produce no layered music (listen + heap loop-count stable); hover spam produces no
crackle (manual listen — mark perceptual judgment as such).

Verification:
- Automated tests: new unit tests with mocked Tone.
- Manual test flow: the four scenarios above with audio on (requires listening — flag
  any judgment as manual-perceptual).
- Required screenshots: n/a.
- Renderer paths: default. Input methods: keyboard.
- Performance checks: allocation profile during hover spam (DevTools).

Regression risks: context suspend on gesture-locked browsers — guard resume in the
existing ensureToneStarted flow.
Rollback or feature-flag strategy: per-behavior revert; all additive listeners.
```

```text
Task ID: KIN-028
Title: Compat renderer parity floor: AA + minimal post stack, renderer badge, honest per-path VFX signage
Phase: 7
Priority: P1
Category: Rendering / Compatibility
User impact: Transformational for Safari/iOS users; High for evaluators
Effort: Large
Confidence: Medium

Problem: The compat WebGL path renders with zero post-processing and zero AA (flat,
jagged, ungraded) and is auto-selected for all Safari/Apple users; the active renderer/
profile is surfaced nowhere player-facing; the VFX station sign advertises effects the
compat path replaces with placeholder-grade content (pixel-proven).
Evidence: RendererManager.ts:306-310 (post bypass); rendererBootstrap.ts:13-16
(antialias:false); mobilePlatform.ts:59-61 (auto-route); evidence/11 vs 13 comparison;
badge absence (DebugPanel-only backend at DebugPanel.ts:179-180); sign text
ProceduralBuilder.ts:1443 vs compat bay :3768-4086. Audit §16 R1/R2, §10 LVL-F12.
Desired outcome: compat gets MSAA + LUT + vignette (profile-scaled); a persistent
unobtrusive badge names path+profile with a one-time toast on fallback; per-path-accurate
VFX signage.

Relevant files: src/renderer/rendererBootstrap.ts (antialias:true for fallback creation);
NEW src/renderer/compatPostStack.ts (EffectComposer or minimal two-pass: render → LUT+
vignette shader pass — three/examples postprocessing is available under three);
src/renderer/RendererManager.ts (route compat render() through the stack; wire
setGraphicsProfile/LUT/vignette flags to it; expose active badge string — rendererState
already computes labels at rendererState.ts:127-133); src/ui (badge element in HUD corner
+ Graphics tab line + fallback toast); src/level/ProceduralBuilder.ts (compat vfx bay
sign text describes actual compat content, or pass a path-aware label builder).
Relevant scenes or stations: all; vfx primarily.
Relevant systems: compat renderer, HUD, settings.
Existing assets to reuse: LUT files already shipped (public/assets/postfx/*); vignette
math from the TSL pipeline as reference; sanitizer unchanged.
New assets required: none.

Implementation instructions:
1. Enable antialias:true (MSAA) in createFallbackRenderer; measure cost on a low-tier
   device profile (CPU-throttle emulation acceptable as proxy, note limitations).
2. Build compatPostStack honoring: LUT (existing .CUBE/.3dl loaders in the TSL path —
   reuse the parsed LUT data), vignette, profile gating (performance: MSAA only;
   balanced: +LUT; cinematic-equivalent: +vignette). No AO/SSR/bloom on compat — labeled
   WebGPU features.
3. Badge: small fixed chip (e.g. bottom-right, hud.css tokens) "WebGL · balanced";
   auto-fallback (WebGPU init failure or Apple route) additionally shows a 4s toast
   "Compatibility renderer active — some effects reduced". Graphics tab shows the full
   line (R2).
4. Signage: compat vfx bay label lists its actual effects.
5. Parity spec: same-station screenshots per path via KIN-004 harness (separate baselines
   per path); assert named-object visibility parity via getLevelObjectState for a fixed
   object list (audit TEST-F9).

Dependencies: KIN-004 (harness), KIN-005/011 (pipeline stability first), KIN-024 (badge
tokens).
Out of scope: TSL feature emulation on compat; Safari hardware certification (separate
manual pass, plan §18).
Behaviour that must not change: WebGPU paths byte-identical (badge aside); sanitizer
behavior; compat correctness on mobile.

Acceptance criteria: compat screenshots show AA + grading (visibly closer to evidence/11
than evidence/13 baseline); badge visible on all paths; fallback toast fires only on
auto-fallback; parity spec green; compat mobile p95 not >10% worse than pre-change
(KIN-001 stats under CPU throttle).

Verification:
- Automated tests: parity spec + existing mobile-compat-procedural.ts.
- Manual test flow: three-path visual sweep at vfx/materials/steps; iPhone-UA emulation.
- Required screenshots: new three-path comparison set (replaces evidence 11-13 series).
- Renderer paths: all three (this task IS the path work).
- Input methods: n/a.
- Performance checks: compat frame stats before/after on throttled profile.

Regression risks: highest rendering risk in backlog — the fragile path; land in three
steps (AA → badge/signage → post stack), each behind ?compatPost=0 escape hatch.
Rollback or feature-flag strategy: ?compatPost=0 query param restores bare path;
badge/toast independently revertible.
```

```text
Task ID: KIN-029
Title: Load-time and physics-cost batch: shader warmup, async navmesh, primitive colliders, sanitize dirty-flag
Phase: 7
Priority: P2
Category: Performance
User impact: High (first impression; low-end CPUs)
Effort: Large
Confidence: Medium-High

Problem: 7.2s Play→interactive (dev, measured) with no shader warmup before the loading
screen hides (first-reveal compile hitches); navmesh generation blocks the main thread
56.4ms (console-warned); primitive-shaped statics use trimesh colliders (incl. 792-tri
sphere trimeshes) with per-index array conversion; compat path full-scene-traverses every
120 frames.
Evidence: measured load + console this audit (§19); R4 (no compileAsync; main.ts:256-263);
LVL-F2 sites (ProceduralBuilder.ts:438,651,699,2153,3045,2610); F3 (ColliderFactory.ts:51);
R9 (RendererManager.ts:292-303).
Desired outcome: prod-build Play→interactive ≤4s on the baseline machine; no first-reveal
hitches; navmesh off the critical path; narrow-phase and build cost reduced; no periodic
compat sweeps.

Relevant files: src/main.ts (await renderer warmup — WebGPU renderer.compileAsync(scene,
camera) — inside startGame/startStation before finishSceneLoad); src/level/NavMeshManager.ts
(use/finish generateAsync — the API its own warning recommends); src/level/ProceduralBuilder.ts
(cited sites → createFixedCuboid / ColliderDesc.ball / .cylinder; keep trimesh for
genuinely irregular meshes: ramps with cut geometry, stairs keep trimesh only if steps
aren't expressible as boxes — steps ARE box series, convert); src/physics/ColliderFactory.ts:51
(copy typed array without map); src/renderer/RendererManager.ts (drop the 120-frame sweep;
sanitize on requestCompatibilitySanitize + child-count dirty only).
Relevant systems: loading pipeline, physics build, compat sanitize.
Existing assets to reuse: yieldProgress structure; the newer primitive-collider patterns
already in the throw station (addFixedCuboidCollider).
New assets required: none.

Implementation instructions:
1. Warmup: WebGPU/WebGPU-on-WebGL2 → await compileAsync before loadingScreen.hide;
   compat → render one hidden warm frame. Add load-stage progress text ("Compiling
   shaders…").
2. Navmesh: switch to generateAsync, gate NPC spawn on completion (agents already handle
   async model loads — reuse the load-generation guard pattern).
3. Colliders: convert cited sites; verify each with the physics-verification spec + a
   collider-count/type assertion via a debug hook; slopes MUST remain walkable at the
   three authored angles (spec exists).
4. ColliderFactory index copy: new Uint32Array(index.array) style copy.
5. Sanitize: dirty-flag only; verify mobile-compat-procedural still green (it exercises
   late-added objects → ensure editor spawn + level load call requestCompatibilitySanitize,
   already wired at main.ts:394-396).
6. Record before/after: load times (getLastLoadStats), frame p95 at steps + materials,
   build-time breakdown.

Dependencies: KIN-001 (instrument first).
Out of scope: bundle-size work (vendor chunks are load-parallel and cacheable — deferred);
asset purge is a separate trivial task (delete unused FBX/Unity dirs from public/assets/
models/ — ask maintainer, binary deletion).
Behaviour that must not change: collision behavior (slopes/steps/materials interactions);
compat NodeMaterial swapping correctness; load progress UX.

Acceptance criteria: measured Play→interactive improvement recorded (target ≤4s prod on
baseline machine — validate against KIN-001 numbers, adjust target with evidence if the
machine differs); zero first-reveal hitch >50ms at vfx bay reveal; physics specs green;
navmesh warning gone.

Verification:
- Automated tests: physics-verification.ts, station-screenshots.ts (all 14), procedural
  specs — full suite serial.
- Manual test flow: cold-load feel check ×3; vfx-bay first look.
- Required screenshots: loading progress with new stage text.
- Renderer paths: all three (warmup differs per path).
- Input methods: n/a.
- Performance checks: the before/after table is the deliverable.

Regression risks: collider conversion changing contact behavior at edges — the slope/
step specs are the gate; warmup lengthening the loading screen on slow GPUs (progress
text mitigates perception).
Rollback or feature-flag strategy: per-site collider reverts; warmup behind ?warmup=0.
```

## Phase 5 + 8 — Art Direction and Rollout

```text
Task ID: KIN-030
Title: Art direction pass 1: designed sky, hall edge treatment, fog/wayfinding, spawn polish
Phase: 5
Priority: P2
Category: Visual art / Rendering
User impact: High (every screenshot, every first impression)
Effort: Large
Confidence: Medium

Problem: The blurred city HDR reads as an unfinished sky on all paths; hard floor/void
seam at hall edges; fog erases all wayfinding beyond the adjacent station (labels
illegible one bay away, pixel-proven); player spawns mid-air in a falling pose; 0.7m
boundary curbs allow boost-pad ejections into the void.
Evidence: evidence/07/08/09/11 (sky/fog/seam); §10 LVL-F11, F4; spawn pose evidence/07.
Desired outcome: a designed gradient/procedural sky (IBL unchanged), edge-lit hall
boundary, fog tuned so two stations + an end landmark read, grounded spawn, and safe
bounds where the boost pad fires.

Relevant files: src/renderer/rendererAssets.ts + RendererManager (background: gradient/
procedural sky separate from environment IBL — three supports scene.background vs
scene.environment split); src/level/ProceduralBuilder.ts (boundary trim: low emissive
strip along hall edges; raise curbs to ≥1.2m flanking platformsPhysics; end-of-corridor
landmark beacon (tall emissive pylon at futureA — reuse station lamp components));
src/level/LightingSystem.ts (fog density/color retune per profile — verify labels at
2-station distance); player spawn Y (spawn points currently drop the capsule — set spawn
Y to grounded height at REVIEW_GROUND_Y, src/level/ShowcaseLayout.ts:107).
Relevant scenes or stations: corridor-wide; platformsPhysics curbs; futureA landmark.
Relevant systems: renderer background, procedural build, lighting/fog.
Existing assets to reuse: station color system, lamp/spotlight kit, sparkle motes.
New assets required: none (procedural sky; no textures).

Implementation instructions:
1. Sky: vertical gradient (deep slate → warm horizon working with the existing ACES
   grade) as scene.background on all three paths; keep HDR PMREM as scene.environment.
   Design sign-off on the gradient stops before rollout (capture 3 candidates).
2. Fog: reduce density so the next two station signs are legible at approach (verify at
   1920×1080 from each review spawn); consider per-profile density only if perf demands.
3. Edge: emissive trim strip + darker apron replacing the raw seam; raise cited curbs.
4. Landmark: end-pylon visible from entrance (test in evidence re-capture).
5. Spawn: grounded spawn pose (adjust spawn Y or pre-settle one physics step before
   reveal — physicsWorld.step() already runs pre-reveal at main.ts:276; set Y so the
   capsule starts at rest).
6. Re-capture the full station evidence set; KIN-004 baselines will need regeneration
   (coordinate — this task invalidates visual baselines by design).

Dependencies: KIN-004 (regen baselines after), KIN-028 (sky must render on compat),
design approval on sky/fog values.
Out of scope: station framing kit + interaction-zone markers (follow-up art pass 2,
scoped per-bay during Phase 8 rollout); hero-character material (separate approval).
Behaviour that must not change: IBL lighting response; station color identities;
collision layout except cited curbs.

Acceptance criteria: from the entrance, two station signs legible + landmark visible
(screenshot); no void-visible seam in any station capture; spawn shows no falling pose;
boost pad cannot eject over the raised curbs (scripted launch test).

Verification:
- Automated tests: KIN-004 regenerated anchors; station-screenshots suite green.
- Manual test flow: full corridor walk on all three paths.
- Required screenshots: refreshed evidence set (entrance/overviews/all stations).
- Renderer paths: all three.
- Input methods: n/a.
- Performance checks: KIN-001 p95 unchanged ±5% at entrance.

Regression risks: fog retune affects perceived depth everywhere — capture-gated approval;
background split behaving differently on compat (test early).
Rollback or feature-flag strategy: sky/fog constants; curb heights as literals — easy revert.
```

```text
Task ID: KIN-031
Title: Rollout: apply the vertical-slice standard to bays 5–14 and run the full validation matrix
Phase: 8
Priority: P2
Category: Rollout / Testing
User impact: High (consistency)
Effort: Very large (bounded per-bay)
Confidence: Medium

Problem: Phases 1–7 land the contract on the slice (entrance→steps→movement→door +
badge); the remaining ten bays need the same standard: framing kit, interaction-zone
markers, per-bay feedback completeness, per-path honesty, reset clarity.
Evidence: plan §14/§15; station matrix audit §10 (per-bay gaps listed: slopes lane
marker, grab goal, vehicles inertness fixed by KIN-026, materials/vfx/navigation/futureA
items).
Desired outcome: every bay meets the slice checklist; full matrix re-test passes;
before/after gallery published.

Relevant files: src/level/ProceduralBuilder.ts (per-bay passes); systems files per bay
as needed; docs/audits/evidence/ (gallery).
Relevant scenes or stations: slopes, doubleJump, grab, throw, vehicles, platformsMoving,
platformsPhysics, materials, vfx, navigation, futureA.
Existing assets to reuse: everything landed in Phases 1–7.
New assets required: none.

Implementation instructions:
1. Define the per-bay checklist from the slice: readable sign at approach; input shown
   with device glyph; interaction confirmed (event+audio+VFX); reset behavior visible;
   per-path content honest; coins reachable; frame p95 within budget.
2. One PR per bay (or per cluster) applying gaps from the audit matrix: slopes too-steep
   lane marker; steps too-tall contrast block; grab mini-goal (pull cube onto pressure
   outline — uses existing pieces); futureA — remove coins or add placeholder activity
   (design call); materials collider conversion arrives via KIN-029.
3. Full validation: 3 paths × 3 input methods × performance/balanced/cinematic on the
   slice + spot bays; all suites serial; refresh all evidence; document remaining
   limitations in docs/audits/kinema-experience-audit.md §24 addendum.

Dependencies: all prior tasks.
Out of scope: new mechanics or bays.
Behaviour that must not change: the validated slice.

Acceptance criteria: checklist table complete for 14/14 bays; full suite green twice;
gallery committed.

Verification: full matrix as above; before/after gallery; final audit addendum.
Regression risks: per-bay drift — checklist discipline.
Rollback or feature-flag strategy: per-bay PRs.
```

## P3 Optional-Polish Tail (execute opportunistically; each maps to an audit ID with full evidence/fix detail)

| ID | Item | Audit ref | Effort |
|---|---|---|---|
| KIN-T01 | Delete dead FSM getDesiredMovement chain (+ comment FSM as animation-layer) | FSM-3 | S |
| KIN-T02 | Remove unused interaction sensor colliders OR adopt per-object interactRadius | I-1/I-2 | S-M |
| KIN-T03 | Focus hysteresis (acquire 2.6 / release 2.9) + knee-height LOS raise | I-6/I-9 | S |
| KIN-T04 | Empty-press interact: skip state entry when nothing focused; gate air interact | I-7/I-8 | S |
| KIN-T05 | Throw/drop wall-clearance ray | G-2 | S |
| KIN-T06 | Carry-jump policy decision (keep slowdown airborne or allow) | G-1 | S |
| KIN-T07 | Landing spring critical damping option (C 22→24.5) | CAM-2 | S |
| KIN-T08 | Camera near-band cast rate 60Hz | CAM-3 | S |
| KIN-T09 | Dead SFXEngine.respawn removal; volume double-apply cleanup | A11/A12 | S |
| KIN-T10 | Music reachability + motif + reverb retune (design review) | A9/A10 | M |
| KIN-T11 | Degraded-dynamics headroom (-3dB buses) | A13 | S |
| KIN-T12 | Env-select label sync; exposure persistence decision | R10/R7 | S |
| KIN-T13 | futureA coins removal (or placeholder activity) | LVL-F9 | S |
| KIN-T14 | Editor: multi-select, drag-to-size brushes, primitive palette, named objects | ED-F8/F11/F12 | L |
| KIN-T15 | In-editor Open dialog from LevelSaveStore; download opt-in; prompt→dialog | ED-F10 | M |
| KIN-T16 | JSON-level rotated/trimesh colliders + CCD flags | LVL-F13 | M |
| KIN-T17 | Throw-target CCD (bottles/cans) | LVL-F14 | S |
| KIN-T18 | public/assets purge of unused FBX/Unity duplicates (~47MB; maintainer approval) | §19 | S |
| KIN-T19 | Balanced-tier GTAO denoise evaluation | R11 | M |
| KIN-T20 | Checkpoint coverage for the back half of the corridor | LVL-F6/F8 | M |
| KIN-T21 | tasks/TEMPLATE.md restoration or AGENTS.md correction | §6 | S |
| KIN-T22 | Playwright WebKit project as a Safari compatibility signal | §20 | M |

---

**Execution order summary:** KIN-001…005 (parallel-friendly) → KIN-006…012 (stability; 006 first) → KIN-013…017 (foundations; 015 before 016) → KIN-018…024 (UI/editor; 018 before 019) → KIN-025 → KIN-026/027 (parallel) → KIN-028 → KIN-029 → KIN-030 → KIN-031. Tail tasks slot wherever adjacent files are already open.
