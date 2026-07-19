# KIN-020 Settings Integrity And Comfort Implementation Plan

> **Execution:** Follow test-driven development for every behavior. Each task is implemented,
> committed, and reviewed before the next begins. Preserve exact current behavior at defaults.

**Goal:** Make Settings a persistent, truthful runtime control surface and add motion/flash,
hold-toggle, remapping, and device-sensitivity comfort features.

**Architecture:** `UserSettingsStore` remains the single persisted preference source. A pure
`InputBindings` module owns keyboard-binding invariants. Renderer overrides are requested intent
and apply atomically after a profile. Runtime owners expose narrow setters; the Settings menu
persists first and calls those setters immediately.

**Stack:** TypeScript 5.9, Three.js/WebGPU renderer abstraction, Vitest 4, Playwright, Biome.

---

## Global Constraints

- Keep the `kinema.user-settings.v1` key and migrate additively.
- Default behavior must be numerically identical: camera effects `1`, damage flash `1`, reduced
  motion `system`, hold modes, gamepad look `18`, touch look `4`, and current keyboard mappings.
- Graphics profile applies first; six persisted requested overrides apply afterward and survive
  later profile changes. Apply structural renderer flags as one batch/pipeline mutation.
- Store requested effect intent even when the active renderer cannot implement it.
- Rebind `KeyboardEvent.code`, never localized `key`; reject reserved codes, swap conflicts, and
  preserve Arrow/Ctrl/right-Shift alternates.
- Toggle applies to character traversal only; clear latches at gameplay/control boundaries and
  keep vehicle meanings hold-based.
- Reduced Motion On resolves camera effects to zero and reduces decorative UI animation without
  overwriting the stored slider; Off ignores OS preference; System follows OS preference.
- Camera intensity scales outputs, not state evolution. Damage intensity linearly scales peak
  opacity and duration.
- Extend the explicitly allowlisted `tests/menu-responsive.ts`; do not add another browser spec.
- Do not modify generated files, dependencies, package manifests, or unrelated user artifacts.

## Task 1: Settings And Binding Domain Foundation

**Files:**

- Create: `src/input/InputBindings.ts`
- Create: `src/input/InputBindings.test.ts`
- Modify: `src/core/UserSettings.ts`
- Modify: `src/core/UserSettings.test.ts`

**Step 1 — RED: binding contract tests**

Add focused tests for cloned defaults, accepted `KeyboardEvent.code` values, reserved codes,
same-code no-op, primary/alternate conflict swapping, duplicate repair, and reset isolation.

Run `npx vitest run src/input/InputBindings.test.ts` and confirm failures are caused by the
missing module/API.

**Step 2 — GREEN: pure binding module**

Implement the eight action names, current primary and alternate defaults, display labels,
reserved-code policy, deep clone/sanitize helpers, and a pure swap result. Do not access DOM or
storage from this module.

Run the focused test until green.

**Step 3 — RED: settings schema, migration, and range tests**

Extend settings tests for all new defaults; post-effect values derived from the saved profile when
missing; preservation of explicit false values; malformed enum/number/binding fallback; defensive
binding cloning; and every exported min/max clamp.

Run `npx vitest run src/core/UserSettings.test.ts` and observe the expected assertion failures.

**Step 4 — GREEN: additive settings implementation**

Add the six post booleans, camera/flash intensities, reduced-motion enum, sprint/crouch modes,
gamepad/touch sensitivities, keyboard bindings, and exported range metadata. Use one sanitizer for
load and update so browser inputs and storage share bounds. Preserve the existing storage key.

Run both focused test files, then `npx tsc`.

**Step 5 — Commit**

Commit only Task 1 source/tests with subject `Add settings preference foundation`.

## Task 2: Atomic Graphics Persistence And Truthful Graphics UI

**Files:**

- Modify: `src/renderer/RendererManager.ts`
- Modify: `src/renderer/rendererState.ts`
- Modify: `src/Game.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/menus/SettingsMenu.ts`
- Modify: `src/ui/menus/MenuManager.ts`
- Modify: `src/ui/menus/menus.css`
- Add/modify focused renderer/settings-menu unit tests where existing seams permit

**Step 1 — RED: requested graphics batch behavior**

Add unit coverage proving a profile is followed by sticky requested overrides, subordinate intent
survives master post-processing off, unsupported capability does not rewrite storage, and one batch
causes at most one structural rebuild/mutation request.

Run the focused test and confirm the current sequential/profile-reset behavior fails it.

**Step 2 — GREEN: renderer requested-state batch**

Add a typed post-effect settings object and an atomic `applyPostEffectSettings` path. Keep requested
state distinct from effective pipeline flags. Expose capability/requested data needed by Settings
without deriving persistence from `getDebugFlags()`.

**Step 3 — RED/GREEN: boot and runtime persistence**

Test or inspect the bootstrap/application seam, then apply profile → AA/CAS → post batch in `main`.
Update Game profile and individual-toggle handlers to persist first and reapply requested settings.
Ensure the menu refreshes from the store whenever opened.

**Step 4 — Truthful UI and corrected shared ranges**

Build Graphics controls from persisted requested values. For unsupported effects, retain the check
state, disable interaction, and render an explanatory note. Consume exported range metadata for all
existing range controls and eliminate label/input endpoint divergence.

Run targeted tests, `npx tsc`, and scoped Biome on touched files.

**Step 5 — Commit**

Commit Task 2 with subject `Persist graphics effect settings`.

## Task 3: Remapping, Hold/Toggle, And Device Look Sensitivity

**Files:**

- Modify: `src/input/InputManager.ts`
- Modify: `src/input/InputManager.test.ts`
- Modify: `src/input/TouchControlsManager.ts`
- Modify: `src/input/InputGlyphs.ts`
- Modify: `src/input/InputGlyphs.test.ts`
- Modify: `src/ui/menus/SettingsMenu.ts`
- Modify: `src/ui/menus/menus.css`
- Modify: `src/ui/menus/HelpMenu.ts`
- Modify: `src/ui/menus/HelpMenu.test.ts`
- Modify: `src/ui/UIManager.ts`
- Modify: `src/main.ts`
- Modify: `src/Game.ts`

**Step 1 — RED: input runtime tests**

Add tests for every default and remapped keyboard action, preserved alternates, exact default
gamepad look output, min/max sensitivity output, touch sensitivity, hold/toggle rising edges,
toggle-off behavior, mixed input sources, and latch clearing at control boundaries.

Run `npx vitest run src/input/InputManager.test.ts` and confirm the new cases fail correctly.

**Step 2 — GREEN: runtime input application**

Inject bindings and sensitivity settings into `InputManager` and `TouchControlsManager`. Resolve
character traversal hold/toggle after raw input aggregation; preserve hold semantics in vehicles.
Add narrow setters so Settings changes apply immediately.

**Step 3 — RED/GREEN: prompt and glyph propagation**

Extend glyph tests so current bindings determine keyboard labels. Update Help and interaction HUD
consumers through explicit binding input or a provider. Prove a rebound interact key changes the
visible prompt without reload.

**Step 4 — RED/GREEN: remap and Controls/Comfort UI**

Add a capture-next-key flow with status text, cancellation, reserved-key feedback, conflict swap,
and reset. Add sprint/crouch mode and device-look sensitivity controls under a Comfort section.
Ensure capture cleanup on menu hide/dispose and retain keyboard/gamepad menu accessibility.

Run focused input, glyph, Help, and UI tests; run `npx tsc` and scoped Biome.

**Step 5 — Commit**

Commit Task 3 with subject `Add accessible input preferences`.

## Task 4: Camera, Reduced-Motion, And Damage-Flash Comfort

**Files:**

- Create or modify focused tests under `src/camera/`, `src/juice/`, and `src/ui/components/`
- Modify: `src/camera/OrbitFollowCamera.ts`
- Modify: `src/juice/ScreenShake.ts`
- Modify: `src/juice/FOVPunch.ts`
- Modify: `src/ui/components/HUD.ts`
- Modify: `src/ui/components/hud.css`
- Modify: `src/ui/UIManager.ts`
- Modify: `src/ui/menus/SettingsMenu.ts`
- Modify: `src/ui/menus/menus.css`
- Modify: `src/main.ts`

**Step 1 — RED: camera output-scaling tests**

Create deterministic tests for intensity one retaining legacy output, zero removing landing,
look-ahead, lateral/drift, dynamic-FOV/FOV-punch, vehicle motion-offset, and shake contributions,
and internal shake/spring state continuing to advance at zero.

Run the focused tests and observe expected missing-setter/output failures.

**Step 2 — GREEN: output-only camera intensity**

Add one camera-effects setter and route it to all named contributions. Keep follow, collision,
crouch height, zoom, and manual orbit unscaled. Scale shake output after trauma calculation.

**Step 3 — RED/GREEN: damage flash**

Add DOM tests for intensity zero, intensity one legacy values, intermediate linear opacity/duration,
and fall/spike variants. Fix the overlay opacity path and drive CSS custom properties from HUD.

**Step 4 — RED/GREEN: tri-state reduced motion**

Test System/On/Off resolution with a controllable media-query seam. Set an explicit root state for
CSS so Off can override an OS preference. Initialize and immediately update camera/HUD/menu owners
without modifying the stored camera slider.

Run focused tests, `npx tsc`, and scoped Biome.

**Step 5 — Commit**

Commit Task 4 with subject `Add motion and flash comfort controls`.

## Task 5: Browser Journeys, Evidence, And Final Integration

**Files:**

- Modify: `tests/menu-responsive.ts`
- Modify typed DEV API files only if deterministic assertions require a production-truth seam
- Add: `docs/audits/evidence/26-settings-comfort.png`
- Add: `docs/audits/evidence/27-settings-remap.png`

**Step 1 — RED: extend the allowlisted Playwright journey**

Add serial tests that seed legacy settings, assert corrected slider attributes/endpoints, persist
SSAO false across reload, distinguish requested intent on compat, remap interact and observe the
prompt, exercise conflict swap/reset, and validate Comfort values after reopen/reload.

Run each new test with `npx playwright test tests/menu-responsive.ts --grep <name>` and confirm it
fails for the missing integration—not for procedural-load readiness.

**Step 2 — GREEN: close integration gaps only**

Make the smallest production changes required by the failing journeys. Do not introduce broad DEV
state setters; expose sanitized settings/requested renderer state only when normal UI assertions
cannot establish the runtime truth deterministically.

**Step 3 — Capture and inspect evidence**

Capture the Comfort and Remap sections at desktop width. Inspect both images for readable labels,
unclipped focus/status text, correct slider values, and keyboard/gamepad focus visibility.

**Step 4 — Full verification**

Run:

1. `npm run test`
2. `npx tsc`
3. scoped Biome on every touched source/test file
4. `npm run build`
5. new Playwright journeys serially on default and `?forceCompat=1`
6. the complete `tests/menu-responsive.ts` serially

Record repository-wide lint baseline separately without claiming it clean. Document unavailable
physical controller, touch hardware, and true-WebGPU checks.

**Step 5 — Final review and commit**

Obtain a GPT-5.6 SOL whole-task review, resolve every actionable P0–P2 finding with focused tests,
rerun affected verification, update `tasks/todo.md` to DONE, and commit Task 5 with subject
`Verify KIN-020 settings journeys`.
