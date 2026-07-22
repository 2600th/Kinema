# Kinema Experience Audit

- **Date:** 2026-07-17
- **Commit:** `9339bed839f6fc70384348ec3816adf5f76add0c` (branch `experimental/audit-fixes`)
- **Environment:** Windows 11 Pro 10.0.26200, Node 22.x, npm 10+, Chrome 150 (true WebGPU), viewport 1920×1080 @DPR1; mobile emulation 390×844 @DPR3 iPhone UA; dev server (`npm run dev`)
- **Evidence:** `docs/audits/evidence/*.png` (19 captures), console logs, Playwright output, source citations (`file:line`). Eight parallel read-only source audits + one live browser evidence pass.
- **Classification legend:** `[CD]` Confirmed defect · `[CX]` Confirmed experience issue · `[LV]` Likely issue requiring verification · `[SW]` Subjective design weakness · `[OP]` Optional polish opportunity · `[SR]` Strategic redesign opportunity · `[NW]` Not worth implementing

---

## 1. Executive Summary

Kinema is a genuinely capable browser gameplay laboratory with an unusually strong technical backbone: a correct fixed-timestep loop with interpolation and input edge-merging, textbook platformer jump feel (coyote time, buffering, apex hang, fall multiplier), a well-factored FSM/mode character architecture, a WebGPU-first TSL pipeline with three renderer paths, thorough unload hygiene, and 163 passing unit tests concentrated exactly where code was refactored into pure helpers.

The experience layer does not yet match the engineering layer. The five most damaging gaps found:

1. **The editor can be soft-bricked and silently loses work** — quitting to menu during play-test leaves an orphaned Stop bar; clicking it in the next run throws `RuntimeError: unreachable` (Rapier WASM) and F1 permanently stops opening the editor (runtime-confirmed, evidence §13). There is no dirty-state tracking, no unsaved-changes warning, and quota-exceeded saves report success.
2. **The compatibility WebGL path is a different, worse product** — zero post-processing, zero AA, and a VFX station whose sign advertises effects that are replaced by placeholder-grade cones and bars (pixel evidence `11` vs `13`). Every Safari/iOS user lands here automatically, and the active renderer is never surfaced in UI.
3. **Interaction feedback is structurally incomplete** — doors, beacons, and ropes emit no domain events, so they have no audio, no juice, and no observable success state (beacon activation produces no detectable confirmation at runtime); prompts always say "Press F" regardless of input device; detaching from a rope leaves the FSM stuck in `rope` state (runtime-confirmed).
4. **Accessibility and input parity are below baseline** — no visible focus on most controls, no gamepad menu navigation, no remapping, no motion-reduction option against a large stacked camera-motion surface, and landscape touch buttons collide with HUD chips (pixel evidence `19`).
5. **The showcase lacks an experience arc** — 70 coins with no total or completion, 2 objectives that finish a third of the way in, one checkpoint for a 454-unit corridor, death wipes all progress via full reload, and fog erases all wayfinding beyond the adjacent station.

None of these require new product scope; they are finishing, unifying, and communicating what already exists.

## 2. Product Purpose and Audiences

**Purpose (observed):** a browser-native third-person gameplay lab — one codebase to prototype mechanics (character, interactions, vehicles), author/play-test levels in-browser, and compare rendering paths (WebGPU / WebGPU-on-WebGL2 / compat WebGL) with graphics profiles.

**Audiences, in likely priority order:** (1) repository evaluator, (2) gameplay programmer prototyping, (3) designer building/play-testing levels, (4) player exploring the showcase, (5) graphics developer comparing paths. The README serves audience 1 well (accurate quick start, useful URL table — verified). The debug surface (`window.__KINEMA__`, DebugPanel) serves 2 and 5. The editor serves 3 but is the least finished major surface. The showcase serves 4 with the weakest experience arc.

**Surface separation (observed):** public-facing (menu/showcase), gameplay (HUD/controls), editor, and debug surfaces are architecturally separate but leak into each other: HUD stays visible in the editor (evidence `15`), debug-only review spawns are the only overview vantage points, and six Settings toggles are actually non-persisted debug flags.

## 3. Proposed Design Pillars

Derived from the audit, not assumed:

1. **Dependable controls, instantly** — input is never dropped (already true via edge-merge) and never locked without meaning (fix landing/interact lockouts, rope state trap).
2. **Every interaction announces itself** — one feedback contract (event → prompt → animation/VFX/audio → result) for every interactable; if it worked, you know; if it failed, you know why.
3. **One lab, three renderers, same experience** — content parity within declared budgets on all three paths, and the active path is always visible. Divergence is a labeled comparison, never silent degradation.
4. **The corridor teaches itself** — each station readable at approach distance: purpose, input, reset, payoff — without reading source.
5. **Creation you can trust** — the editor never loses work silently: dirty-state, undo everywhere, safe play-test round-trips, honest save results.
6. **Comfort and access are settings, not luck** — visible focus everywhere, device-correct glyphs, motion-reduction, remappable core inputs.

## 4. Current Strengths (preserve these)

- **Loop and input integrity:** fixed 60Hz accumulator with spiral clamp, interpolation alpha, hitstop that discards frozen time (`GameLoop.ts:59-117`); render-frame edge OR-merge prevents dropped inputs at high refresh (`Game.ts:376-406`).
- **Jump feel foundation:** coyote 0.14s honored in both grounded/air modes, buffer 0.16s, apex hang 0.65×, fall 2.15×, variable jump cut (`constants.ts:61-75`, `CharacterMotor.ts:257-278`).
- **Architecture:** pluggable CharacterModes + animation-layer FSM; EventBus decoupling; pure-function extraction pattern (CarController helpers, pipelineProfile, playerGrounding) that makes tests cheap.
- **Renderer engineering:** three genuinely working paths (verified: `WebGPU`, `WebGPU (WebGL2 backend)`, `WebGLRenderer`); compat NodeMaterial sanitizer preserving material state (`compatibilityMaterialSanitizer.ts:34-95`); texel-snapped shadow follow (`LightingSystem.ts:101-116`); MRT emissive-only bloom.
- **Resource hygiene:** deep unload disposal incl. all texture slots and InstancedMesh buffers (`LevelManager.ts:41-69,687-723`); load-generation guards on async builds; throwable pooling with auto-recycle.
- **Menu visual design:** the main menu reads modern and confident (evidence `01`) — glass panel, Outfit typography, coherent cyan/purple/pink triad, animated backdrop.
- **Mobile foundations:** correct compat auto-routing on iPhone UA (verified), safe-area insets, 48–64px touch targets, portrait/landscape layouts, orientation hint.
- **Test culture where it exists:** 163 unit tests, station-load coverage for all 14 stations, state-driven vehicle specs, HUD reduced-motion block (`hud.css:845-874`).
- **Baseline health:** `npm run test`, `npm run build` pass; cold load to menu LCP 875ms, CLS 0.00 (dev, measured).

## 5. Largest Experience Gaps

Ranked by impact on the stated audiences:

1. Editor trust chain (data loss + soft-brick + undo gaps) — audiences 3, 1.
2. Compat-path parity and communication — audiences 5, 4, 1 (all Apple users).
3. Interaction feedback contract (silent doors/beacons/ropes, stale prompts, device-blind glyphs) — audiences 4, 2.
4. Showcase experience arc (no completion, punitive death reload, fog wayfinding, dead jog clip, placeholder sky) — audience 4, 1's first impression.
5. Accessibility/input parity (focus, gamepad menus, remapping, motion reduction, touch/HUD collisions) — all audiences.

## 6. First-Run Audit (Journey A: Repository Evaluator)

- **Setup accuracy:** README quick start verified end-to-end: `npm ci` → `npm run dev` → menu. `npx playwright install chromium` needed once, documented. `[OK]`
- **Time to first visible result:** dev server up in seconds; menu LCP 875ms (trace). `[OK]`
- **Time to first interaction:** Play → showcase in **7.2s measured** (dev, WebGPU, warm cache). No progress communication issue — loading screen with progress exists — but 7s is long for a lab's default route; shader warmup absence and synchronous navmesh gen (56.4ms warning, console-confirmed) contribute. `[LV]` for prod build timing.
- **Discoverability:** showcase — Play button, obvious. Editor — F1 documented in README and Help; nothing in-game hints at it. Debug panel — backtick documented; graphics tools live in Settings + DebugPanel with unclear boundaries (six Settings toggles are non-persisting debug flags `[CD]` UI-F4). `[SW]`
- **Renderer comprehension:** query params work as documented (all three verified). But the active path is displayed nowhere player-facing `[CD]` R2 — an evaluator on Safari cannot tell they're seeing the degraded path (§16).
- **Unsupported-browser recovery:** WebGPU-init failure silently falls back to bare WebGL (`RendererManager.ts:218-234`); device-lost overlay exists (`rendererBootstrap.ts:75-126`); fatal bootstrap errors get a readable fullscreen `<pre>` (`main.ts:6-24`). Good bones, missing only the "you are on the fallback" message.
- **Looks-broken moments found:** T-posing frozen NPCs in `?station=navigation` (pixel evidence `09`/`10`) `[CD]`; VFX-station sign advertising effects the compat path doesn't show (evidence `13`) `[CD]`; spurious "Impact!" toasts at spawn (evidence `07`) `[CX]`; player spawns mid-air in falling pose (evidence `07`) `[OP]`.
- **Also noted:** `tasks/TEMPLATE.md` referenced by AGENTS.md does not exist `[CD]` docs; `npm run lint` exits 1 on a documented pre-existing CRLF baseline (184 errors) — an evaluator running the advertised pre-merge pass sees a red step `[CX]`.

## 7. Gameplay and Controller Findings (Journey B/C + Phase 4)

Runtime-verified where marked; tuning table in the character audit data (key values inline).

- **[CD] ROPE-1 — FSM trapped in `rope` after detach.** Runtime-confirmed: attach rope → jump off → land → walk; `player.state` remains `"rope"` indefinitely (timeline captured §evidence log). `RopeMode` lacks the `exit()` that `LadderMode.ts:38-45` has. Fix: add symmetric `exit(ctx)` requesting idle/air.
- **[CD] MOV-1 — Locomotion blend thresholds don't bracket real speeds.** Thresholds `[2.0, 4.0]` (`profiles.ts:26`) vs moveSpeed 5.2 / sprint 6.76: ordinary running plays the **Sprint clip at 0.8× speed**; the authored Jog clip is unreachable except at partial analog tilt. Walk vs sprint differ only by playback rate. Retune to ≈`[2.6, 5.2]`.
- **[LV] FSM-2 — LandState swallows crouch/interact up to 0.4s** after any >2m/s landing (`LandState.ts:20-31`); movement unaffected. Add crouch/interact exits or shorten to ~0.2s.
- **[SW] MOV-2 — Stop/side-kill lambdas (58/82) kill momentum in ~40ms** — deliberate-feeling "locked" stops; a defensible lab choice but should be a conscious tuning decision (soften to ~30/50 for weight).
- **[CD] STEP-1 — Step assist bakes `*60` (frame-rate coupling) and caps at 0.15/0.2m** vs the documented 0.3 autostep intent (`GroundedMode.ts:490-500`); 0.25m steps snag.
- **[LV] LADDER-1 — Ladder climb is digital** (`forward/backward` booleans, no analog `moveY` proportionality) (`LadderMode.ts:88`).
- **[CD] FSM-3 — `getDesiredMovement` chain is dead code** encoding a divergent speed model — a landmine for contributors (`CharacterFSM.ts:72-74`).
- **[LV] CARRY-1 — Carrying while airborne** drops the carry pose while the object stays glued to the hand (`CarryState.ts:18`, `PlayerController.ts:573-581`).
- **[OK verified] Coyote + buffered jumps fire correctly; air-jump charge preserved; profile switch at runtime works.**
- **Interact stutter [SW] I-7/I-8:** empty F-press root-locks 0.3s (`InteractState.ts:7,33-36`); airborne F always ends in a "Must be grounded" toast (`AirState.ts:20`).

## 8. Interaction Findings

- **[CD] I-1 — Detection is distance-only (uniform 2.6m); every sensor collider is dead weight** — created, sized per-object, never queried (`InteractionManager.ts:97-175`). Either drive detection from sensors or delete them and add per-interactable `interactRadius` (I-2).
- **[CD] I-3/I-4 — Door, Beacon, Rope emit no domain events**; the generic `interaction:triggered {id}` carries no outcome. Confirmed downstream: AudioManager reacts only to grab/pickup/throw/focus/hold — **door open/close, beacon activation, rope grab are silent** and un-scriptable.
- **[CX] RT-BEACON — Beacon activation produces no detectable confirmation** (runtime): charge ring completes; prompt still reads "Hold F to Activate Beacon"; objective card unchanged; status lane empty; a subsequent hold recharges from zero. Conflicts with the station-isolated Playwright pass — behavior differs in the full procedural run or the prompt/objective pipeline drops the result. Needs manual play verification of root cause, but the communication failure itself is confirmed evidence.
- **[CX] RT-PROMPT — HUD prompt text goes stale** — retains previous label while hidden and across focus changes (observed repeatedly during probing).
- **[CD] I-5 — Beacon stays focusable forever post-activation** with a permanent "Beacon online" reason-as-prompt and blocked toasts on F (`ObjectiveBeacon.ts:162-165`, `InteractionManager.ts:290-291`).
- **[OP] I-6 — No enter/leave hysteresis** (acquire and drop both at 2.6m) → boundary prompt flicker.
- **[LV] I-9 — LOS ray originates at knee height** (`position.y + 0.35`) — low geometry can falsely occlude focus.
- **[LV] G-1/G-2 — Carry-jump bypasses the carry slowdown; throw/drop can spawn objects into a facing wall** (release offsets 0.12–0.8m, no clearance ray).
- **[CX] RT-IMPACT — Physics props settling at level load fire "Impact!" toasts at spawn** (evidence `07`, `InteractableSystem.ts:208`). Suppress contact toasts for the first ~1s after load.

## 9. Vehicle Findings

- **Car foundation is strong:** Rapier raycast vehicle + arcade assist layer, 30+ pure-helper unit tests, state-driven Playwright specs (entry, reverse, steering trace, planted driving, crash-shove recovery — all passing).
- **[LV] C-1 — Exit fallback can place the player inside a wall** when all three candidates fail clearance (`CarController.ts:297-305,865-869`); add a last-resort upward/rear candidate.
- **[LV] C-2 — Drone exit checks a thin ray, not capsule fit** (`DroneController.ts:184-192`); reuse the car's `intersectsShape` test.
- **[SW] C-3 — No manual reset/flip input; OOB reset only below y<-8** (`VehicleManager.ts:17,210-224`); a wedged flipped car has no recovery.
- **[CD] R6 — Zero vehicle motion VFX** (footstep dust explicitly suppressed while driving, `ParticleSystem.ts:54-64`); the vehicles station is visually inert in motion (also no boost/collision audio events — see §17).
- **[SW] LVL-F10 — Vehicles are spike-immune and can't collect coins** (`SpikeHazardSystem.ts:115`, `CoinCollectibleSystem.ts:82`) — decide and signpost.
- **[OP] Drone barrel-roll on jump is a charming juice moment worth keeping.**

## 10. Feature-Station Matrix

Full per-station build/instruction/reset data is in the level audit; condensed matrix (all stations verified loading grounded via Playwright; deep-audited: steps, throw, door, vehicles, vfx, navigation):

| Station | Demonstrates | Instruction | Payoff/feedback | Reset | Verdict |
|---|---|---|---|---|---|
| steps | autostep + stairs | sign only | coins | full-reload only | works; no too-tall contrast cue `[OP]`; 0.2m cap contradicts sign intent (STEP-1) |
| slopes | 23.5°/43.1°/62.7° | sign lists angles | slide rejection | — | works; no marker for "too steep" lane `[OP]` |
| movement | ladder+crouch+rope | one combined sign | coins | — | 3 mechanics, 1 bay: rope at x=-14 easy to miss `[SW]`; ROPE-1 lives here |
| doubleJump | air jump tiers | sign | coin arc | — | works |
| grab | grab/pull cubes | sign | grab juice | — | free-form, no goal `[SW]` |
| throw | pick/throw gallery | sign | **best in showcase**: toppling pyramids, "Impact!" toast, auto-refill | pool recycle | model for other stations |
| door | door+beacon+checkpoint | sign | objectives + checkpoint juice | — | RT-BEACON confirmation failure; only objective content in project |
| vehicles | car+drone | sign | crash props | y<-8 only | inert visually (R6); C-1/C-3 |
| platformsMoving | kinematic riders | sign | coins mid-air | — | works |
| platformsPhysics | boost/drum/spring | sign | 6× launch | — | launch clears 0.7m curbs → void falls `[LV]` F4 |
| materials | 10 PBR samples | sign lists all 10 | visual only | — | sphere trimeshes `[CD]` F2 perf |
| vfx | 4 GPU effects | sign lists 4 | visual only | — | **compat shows different content under same sign** `[CD]` (evidence `11` vs `13`) |
| navigation | navmesh crowd | sign incl. N/T keys | watch crowd | — | **frozen T-pose NPCs in isolation mode** `[CD]` F1 (evidence `09`/`10`) |
| futureA | reserved | "Reserved" sign | none | — | still has 5 coins `[OP]` F9 |

## 11. Camera and Game-Feel Findings

- **Solid:** spring-arm with fast-contract/slow-expand collision (12/4), texture-cached 30Hz shapecast, landing dip, sprint/speed FOV, vehicle chase profiles, rope min-distance, grab override — per-mode profiles already exist in config form (`constants.ts:87-105`).
- **[SW/CX] CAM-1 — Stacked motion with no reduction setting:** look-ahead 1.9 + lateral drift 0.22 + landing dip + FOV kicks (cap 12 on foot, +15 vehicle) + 3-axis rotational shake; no camera-effects intensity setting anywhere. Real motion-sickness surface for a demo product.
- **[LV] CAM-3 — 30Hz cast cache can allow 1–2 frame wall clips** on fast approach; **[OP] CAM-2** landing spring slightly underdamped (C=22 vs critical 24.5).
- **Juice inventory:** wired — jump, land, hard-land (hitstop+FOV), grab, throw, checkpoint, spike, death, respawn. **Missing hooks [OP] JUICE-1:** crouch, sprint-start, pickup/drop, ladder/rope attach, vehicle enter/exit/boost, collect camera-pop. **[OP] JUICE-2:** FeedbackPlayer timeline is used only with duration:0 — dead abstraction.
- **Land dedup done right** (`AudioManager.ts:330-351`) — keep.

## 12. UI and UX Findings

- **[CD] UI-F1 — No authored `:focus-visible` on buttons/tabs/checkboxes/touch controls** — runtime-verified: focus lands with the browser's default dark 1px outline, invisible on the dark theme (evidence `02`). Sliders/selects have rings (`menus.css:643-651`) — extend that pattern.
- **[CD] UI-F2 — No gamepad menu navigation** (gamepad state consumed only during gameplay; Escape is keyboard-only, `InputManager.ts:319`).
- **[CD] UI-F3 — Prompts/Help/hold-ring hardcode keyboard glyphs** ("F", WASD) with no input-source tracking (`InteractionManager.ts:11-12`, `HUD.ts:44`, `HelpMenu.ts:27-50`).
- **[CD] UI-F4 — Six Settings toggles don't persist** (Post-processing/SSAO/SSR/Bloom/Vignette/LUT emit debug events only; absent from `UserSettings.ts:5-23`) and their initial state can be stale.
- **[CD] UI-F5 — Reduced-motion honored only by HUD**; menu backdrop (6 infinite animations), loading shimmer, death iris ignore it.
- **[LV→CX] UI-F6/RT — No focus management or trap; pause menu stacks over main menu** — runtime-confirmed: after play-test → Main Menu, the pause screen (Resume/…) remains visible over the main menu.
- **[CD] UI-F7/F8 — No dialog roles/aria; icon-only controls unlabeled; no aria-live for status/objective/collectible/health;** plus runtime-observed: HUD and orientation hint are `opacity:0` but not `aria-hidden`, so screen readers see phantom UI at the menu.
- **[CD] UI-F9 — Slider ranges narrower than store clamps** (FOV 60–75 vs 50–90; deadzone slider lies below 0.02).
- **[SW] UI-F10 — Missing: remapping, hold/toggle options, camera-shake/flash caps, gamepad/touch look-sensitivity sliders.**
- **[LV] UI-F11 — Low-contrast informational text** (version 0.28 alpha, level details 0.5, empty state 0.4).
- **[CX] RT-TOUCH — Landscape touch/HUD collisions:** jump under hearts chip, interact under objective card, sprint under coin chip (evidence `19`); the passing `mobile-landscape-layout` spec checks only touch-vs-touch overlap.
- **[CX] RT-EDITORHUD — Gameplay HUD remains visible inside the editor** (evidence `15`).
- **Design system:** tokens exist only for menus; touch/death effect use a near-duplicate divergent triad (`#7b2fff/#ff6b9d/#00d2ff` vs `#7b6cff/#ff79ba/#62e6ff`); spacing and z-index are unmanaged magic numbers across 8 files; Google Fonts runtime dependency with no bundled fallback `[SW]`.
- **UI motion:** durations cluster sanely (0.16–0.34s, overshoot on cards); no interruption issues observed; gap is reduced-motion + a shared motion-token set, not new animation.

## 13. Editor Findings

- **[CD/P1] RT-ED-CHAIN — The play-test/menu/stop chain breaks the editor** (full runtime repro): play-test → Esc → Main Menu leaves `playTestActive` set and the Stop bar orphaned; in the next run the stale Stop fires `stopPlayTest` against disposed physics → `[Editor] Failed to restore play-test snapshot: RuntimeError: unreachable` + unhandled rejection → **F1 permanently dead for the session** (evidence `16` + console). Root cause: scene transitions check `isActive()` (false during play-test) and never call `stopPlayTest()` (`main.ts:245,282-292`; `EditorManager.ts:236-238,258`).
- **[CD/P1] ED-F1 — No dirty-state tracking, no unsaved-changes warning** (no dirty flag anywhere in `src/editor`; `beforeunload` never prevents, `main.ts:746-751`).
- **[CD] ED-F4 — Quota-exceeded save still emits `editor:saved`** (user sees success; nothing written) (`LevelSaveStore.ts:40-73`, `EditorManager.ts:1335-1336`).
- **[CD] ED-F3 — Advertised Ctrl+S is unimplemented** (tooltip says it; no KeyS handler; browser Save dialog results).
- **[SW] ED-F6 — Undo covers placement/delete/duplicate/gizmo only.** Not undoable: inspector transforms, material edits, physics-type, rename, reparent, group/ungroup, visibility, lock; play-test wipes history.
- **[LV] ED-F7 — Deleting a parent orphans children** (dangling `parentId`, invisible-but-listed, serialized broken).
- **[CD] ED-F9 — Session-local GLB trap:** only a console.warn on import; reload substitutes magenta wireframe with no on-screen explanation.
- **[SW] ED-F10 — Save/Load round-trip incoherent:** save = `window.prompt` + forced file download + localStorage; in-editor load = file picker only; the saved-levels list is reachable only via main-menu Level Select into play mode.
- **[CD] ED-F5 — Per-frame trimesh collider rebuild while dragging** non-cuboid brushes (`EditorManager.ts:1218-1222,1133-1143`).
- **[SW] ED-F8/F11/F12 — Fixed-size stamp brushes** (drag-to-size params exist unwired), **no multi-select**, **no primitive palette** (spheres only via load path).
- **[LV] ED-F14 — Editor camera pose lost on plain F1 toggle** (only play-test preserves it).
- Hierarchy shows raw collision names and generic "Object" entries (evidence `15`) `[OP]`.
- **Verified capability:** a new user CAN create → place → play-test → save; trust and round-trip are what's missing, not core function.

## 14. Animation Findings

- **Foundation:** 87 clips loaded, 65 bones bound (console-verified); velocity-matched timeScale + forwardAlignment anti-slide (`AnimationController.ts:283-321`); additive one-shots; event markers driving footsteps/throw-release.
- **[CD] MOV-1 (again, as animation):** the jog clip is dead content; running is a slowed sprint clip. Single highest-value animation fix: rebracket thresholds to authored speeds (walk 1.5 / jog 3.5 / sprint 6.5 vs speeds 5.2/6.76), or retune authored speeds.
- **[CD] ROPE-1:** rope-hang pose persists on the ground (runtime-verified).
- **[LV] CARRY-1:** airborne carry loses the carry pose while the object stays socketed.
- **[LV] FSM-2:** 0.4s land lock reads as unresponsiveness after drops.
- **[OP]:** no crouch-enter/exit transition polish, no vehicle enter/exit animation (teleport swap), NPC T-pose default before first tick (visible in the F1 defect, evidence `09`).
- **No root motion (code-driven movement throughout) — appropriate for this project; keep.**

## 15. VFX and Particle Findings

- **Inventory:** 7 pooled InstancedMesh burst types (footstep/jump/air/land/coin/damage/beacon — all paths); 400 corridor sparkles + 60 dust motes (always-drawn, `frustumCulled=false`); TSL grass (WebGPU only, box fallback); VFX bay V2 (WebGPU only) vs legacy TSL vs compat static bay; spike sprites; DOM death iris.
- **[CD] R3 — Profiles never scale VFX density** (all counts hardcoded; verified flags change but content doesn't).
- **[LV] R5 — Additive overdraw risk:** 400 uncullable sparkles + up to ~20 additive sheets near the VFX bay at cinematic 2.0 DPR.
- **[LV] R4 — No shader warmup before loading-screen hide** (`compileAsync` never called); contributes to the 7.2s first-load and first-reveal hitches.
- **[CD] LVL-F12 — VFX sign matches only the V2 path** (pixel evidence `13`).
- **[CD] R6 — No vehicle dust/skid/boost VFX.**
- **[OP] R8/R12 — per-frame allocation in compat billboards; dead cloned rain geometry.**
- **Hierarchy (proposed):** 1. damage/hazard warnings → 2. interaction confirmations (door/beacon/grab/throw) → 3. rewards (coins/checkpoint) → 4. locomotion support (dust/landing) → 5. ambient (sparkles/motes). Today tiers 1–3 are underserved while tier 5 is always-on — inverted priorities `[SW]`.

## 16. Visual and Rendering Findings

- **Renderer paths (verified):** WebGPU full TSL; WebGPU-on-WebGL2 full TSL (true A/B value); compat = **no post, no AA** (`RendererManager.ts:306-310`, `rendererBootstrap.ts:13-16`) `[CD]` R1 — the single largest parity gap, auto-affecting all Apple users.
- **[CD] R2 — Active path/profile surfaced nowhere player-facing** (DebugPanel only).
- **[CX] RT-PROFILE-WGPU — Profile switching emits "Destroyed texture [ShadowDepthTexture] used in a submit" ×10** (WebGPU validation, runtime-captured) — pipeline rebuild lifecycle bug, currently untested.
- **Art direction (pixel evidence 01/07/08/09/11):** the project currently reads as *a clean editor-test environment with flashes of identity*. Strong: per-station color coding, pedestal glow, signage sprites, coherent menu brand. Weak: blurred city HDR reads as an unfinished sky `[SW]`; hard floor/void seam at hall edges; placeholder purple mannequin as the hero character `[SW]`; sterile empty walkways (16–26u) between bays; fog kills silhouette readability beyond the adjacent bay `[CX]` (evidence `07`).
- **Coherent-world verdict:** between "editor test environment" and "asset showcase"; the smallest unifying direction is committing to the existing **stylized color-coded lab** language: designed sky (gradient/procedural, not blurred HDR), consistent trim/emissive station framing, hero-character material pass, and edge treatment for the hall.
- **[OP] R7/R10/R11:** exposure/env non-persistence; env-select label mismatch; balanced GTAO shimmer risk (no denoise below cinematic).
- **[CD] LVL-F2/F3 — Trimesh colliders on primitive-shaped statics** (incl. 792-tri sphere trimeshes in materials bay) + per-index array conversion (`ColliderFactory.ts:51`) — the half-finished half of a documented optimization.

## 17. Audio Findings

- **Coverage is broad** (30+ mapped events — footsteps speed-scaled, impact-scaled landings, vehicle engine/drift layers, UI, checkpoints) and the lifecycle fallbacks are robust (two-layer degradation, verified silent-controller path).
- **[CD] A2 — Pause doesn't silence sustained SFX** (engine/drone/slide keep sounding under the pause menu; only music ducks).
- **[LV] A1 — No tab-visibility handling** (Transport + oscillators continue when backgrounded — the worst offender for a prototyping tool).
- **[SW] A3 — Music neither ducks nor stops in the editor.**
- **[CD via I-3] — Door/beacon/rope have no sounds** (no events to react to).
- **Missing:** fall-damage hit, climb/rope movement, vehicle boost/collision, NPC presence, low-health warning, editor action feedback, non-pause menu open (asymmetric with close) — list in audio audit.
- **[LV] A4 — stop→start race can double-layer music** within the 1.6s fade (menu round-trip).
- **[SW] A9/A10 — Melody/perc layers effectively unreachable on foot** (intensity ceiling 0.6 vs thresholds 0.5/0.75); aimless generative texture + 6s reverb risks fatigue.
- **[OP] A5/A6/A7/A8 — No spatialization; per-event synth/Reverb allocation; no per-sound cooldowns.**
- **Perceptual quality unverified** (no listening in this environment) — timing/mix judgments deferred.

## 18. Accessibility Findings

WCAG 2.2-informed, pragmatic:

- **2.4.7 Focus Visible — FAIL** (runtime-verified, evidence `02`): UI-F1.
- **2.1.1 Keyboard/controller — PARTIAL:** menus Tab-operable; no gamepad nav (UI-F2); no focus management/trap (UI-F6); Escape-only pause is keyboard-bound; **and direct-entry routes (`?station=`, `?spawn=`) have no pause/menu at all** (runtime-confirmed) `[CD]`.
- **4.1.2 / 4.1.3 — FAIL:** no dialog roles; unlabeled icon controls; no live regions; phantom `opacity:0` UI exposed to AT (runtime-observed).
- **2.3.3 / 2.2.2 — PARTIAL:** reduced-motion only in HUD (UI-F5); no in-app motion toggle; stacked camera motion with no cap (CAM-1).
- **2.3.1 — VERIFY:** 2.5s damage flash + hit pulses; no flash-intensity cap (UI-F10).
- **1.4.3 — VERIFY:** low-alpha informational text (UI-F11).
- **2.5.8 — PASS:** touch targets 48–64px (runtime-measured), menu buttons full-width.
- **Not recommended:** captions/subtitle systems (no speech), screen-reader-first gameplay — out of scope for a 3D lab; focus on the failures above.

## 19. Performance Findings

Measured (dev server, Chrome 150, RTX-class GPU assumed from WebGPU availability; single machine):

- Cold load → menu: **LCP 875ms, CLS 0.00** (trace).
- Play → showcase interactive: **7 239ms** (measured once, warm).
- Navmesh generation: **56.4ms synchronous main-thread** (console warning, runtime).
- Profile switch: works live; emits destroyed-texture validation warnings (§16).
- Playwright suite: 46/50 parallel (2 workers, SwiftShader) with 4 contention flakes that pass serially — the suite runs at the edge of its environment budget `[CX]`.
- Bundle (build output): vendor-rapier 2 234kB (842 gzip), vendor-three 1 449kB (420 gzip), AudioManager chunk 310kB (73 gzip; Tone.js), LevelManager 226kB. Editor correctly lazy-loaded (75kB). Total initial gzip ≈1.5MB before assets.
- Assets: 87.8MB in `public/assets`, ~47MB of which are unused source-pack duplicates (Unity FBX variants, setup PNGs) served publicly `[OP]`; 6 HDRs ~9MB; LUTs ~4.3MB.
- Code-level risks pending measurement: sparkle/rain CPU updates per frame (R3/R5), trimesh build cost (LVL-F2), compat 2s full-scene sanitize sweep (R9), per-event audio allocation (A6/A7).
- **No frame-time p50/p95 captured** — deferred to Phase 0 of the plan (needs an in-app frame-time probe for honest numbers; single-machine DevTools sampling under MCP load would mislead). Targets must be set only after that baseline.

## 20. Compatibility Findings

- Three renderer paths verified live with correct backend labels; iPhone-UA auto-routing to compat verified.
- Compat gap = R1 (no post/AA) + station content divergence (vfx bay, grass) + no path indicator (R2).
- Real Safari untested (Windows host) — WebKit signal only via code paths; Playwright WebKit not in config. **Unverified.**
- Gamepad hardware untested — code-level only. Touch verified via emulation only.
- Playwright environment note: SwiftShader lacks WebGPU → CI exercises WebGPU-on-WebGL2, never true WebGPU; true-WebGPU regressions (like RT-PROFILE-WGPU) are structurally invisible to CI `[CX]`.

## 21. Testing Findings

- **Strong:** pure-helper unit pattern; state-driven Playwright; all-station load coverage; mobile layout suite; deterministic `__KINEMA__` hooks.
- **[P1] TEST-F1 — Editor: zero coverage** (28 files — CommandHistory, LevelSerializer, gizmo, panels) and no editor debug hooks, so the RT-ED-CHAIN P1 shipped invisibly.
- **[CD] TEST-F2 — Screenshots captured but never compared** — no visual regression despite committed baselines.
- **Gaps (confirmed):** grab/throw/door never triggered; 6 of 12 FSM states never exercised; checkpoints/respawn untested; camera zero-coverage; profile-switch runtime untested (would have caught RT-PROFILE-WGPU); no WebGPU↔WebGL parity assertion; touch joystick drag never tested (would have caught RT-TOUCH? no — that needs HUD-overlap assertions, also absent).
- **[CX] TEST-F10 — Contention flakes:** 4 specs fail at 2 workers, pass serially (this session, evidence in run logs); wall-clock sleeps + divergent copy-pasted readiness helpers.
- **[OP] TEST-F11 — Untyped `__KINEMA__` copy-pasted across specs.**

## 22. Reference Analysis (transferable principles only)

1. **Sketchbook (swift502)** — browser third-person sandbox: single unified demo world where every mechanic is 10 seconds from spawn; vehicles share one input/camera grammar with on-foot. Transfer: compress travel, unify vehicle/foot feedback grammar.
2. **Bruno Simon's portfolio** — physics playground first impression: instant comprehension (no instructions), joyful physical feedback for trivial actions, landmark-based wayfinding visible from spawn. Transfer: readable horizon landmarks instead of fog; make the first 10 seconds a toy.
3. **PlayCanvas Editor** — browser engine editor: relentless dirty-state honesty (unsaved dot, confirm dialogs), hierarchy naming discipline, single save model. Transfer: the editor trust chain (dirty flag → warn → honest save results → named objects).
4. **Astro's Playroom** — feedback-stack quality bar (principles only): every action pairs animation + particle + sound + haptic at consistent intensity tiers. Transfer: the per-action feedback contract of §11/§15, scaled to lab scope — not its content volume.
5. **three.js examples gallery** — rendering comparison UX: the active technique/backend is always labeled on-screen with live-tweakable parameters. Transfer: renderer/profile badge + comparison spawns (R2 fix).

## 23. Target Experience (Phase 16)

- **10 seconds:** you're a character in a color-coded lab corridor; you can see three stations and a landmark endpoint; a badge tells you renderer/profile; movement already feels crisp.
- **30 seconds:** you've climbed steps, collected coins with count "x/70" ticking, and one station has confirmed completion with sound+VFX; prompts show your device's buttons.
- **2 minutes:** you've thrown something at the gallery, driven the car (dust trailing, engine pitching), seen the VFX bay honestly labeled for your renderer, and know F1 opens the editor because the HUD told you.
- **Movement:** current accel/jump feel preserved; jog clip alive; no post-landing input deadness; rope/ladder exit clean.
- **Interaction:** every interactable follows the contract (§3 pillar 2); nothing ends in silence.
- **Stations:** approach → readable sign → obvious interaction → confirmed payoff → visible reset.
- **UI:** focus visible everywhere; gamepad drives menus; motion-reducible; landscape touch never collides with HUD.
- **Editor:** dirty-dot honesty; undo everything; play-test round-trip preserves camera/selection; saves fail loudly; session-local imports labeled at import time.
- **Renderers:** compat gets AA + a minimal post stack + honest per-path station content; the badge names your path; profiles visibly scale VFX density.
- **Audio:** actions confirm; pause/background/editor silence appropriately; music reaches its own layers.
- **Performance feel:** stable frame pacing at balanced on ordinary hardware; no first-reveal hitches (warmup); measured targets only after Phase 0 baseline.
- **Must not become:** a content-heavy game (no progression/story/economy), a photoreal showcase, a mobile-first editor, or a multiplayer platform.

### Current vs Target

| Area | Current State | Target State | Main Gap |
|---|---|---|---|
| First-run | Menu polished; 7.2s to play; broken-looking NPCs/VFX on some paths | <4s perceived + nothing that looks broken | warmup, F1 nav fix, compat honesty |
| Movement | Excellent core; sprint-clip-only locomotion; rope trap; land lockout | Same core + alive jog + clean state exits | 4 targeted fixes |
| Camera | Good follow; stacked motion, no comfort option | Same + comfort slider + no wall clips | settings + cast rate |
| Interactions | Distance-focus works; silent doors/beacons/ropes; stale prompts | Full feedback contract, device glyphs | events + prompt pipeline |
| Vehicles | Strong physics; no motion feedback; exit edge cases | Dust/audio/boost feedback; safe exits; manual reset | juice + 3 fixes |
| Stations | Load reliably; weak arcs; frozen nav NPCs | Self-teaching bays with payoffs | per-station passes |
| UI/HUD | Modern menu; focus/gamepad/aria gaps; touch collisions | Accessible, device-aware, collision-free | systematic UI pass |
| Editor | Capable but untrusted; soft-brick chain | PlayCanvas-grade trust | P1 chain + dirty-state + undo |
| Animation | 87 clips, good blending tech; dead jog; missing transitions | All authored content reachable | threshold retune + polish |
| VFX | Good pools; inverted priority; path gaps | Tiered hierarchy, profile-scaled, all paths | scaling + parity |
| Audio | Broad coverage; lifecycle gaps; unreachable layers | Context-aware, complete coverage | pause/tab/editor + events |
| Graphics | 3 paths work; compat bare; hidden state | Labeled parity within budgets | compat post + badge |
| Compatibility | Auto-routing works; CI blind to true WebGPU | Tested parity matrix | parity tests + Safari pass |
| Performance | Healthy load; unmeasured frame times; known CPU risks | Measured budgets + scaled effects | Phase 0 baseline first |

## 24. Risks and Unverified Areas

- **Unverified:** real Safari/iOS hardware behavior; gamepad hardware; audio perceptual quality (timing/mix/annoyance); production-build load times (all numbers are dev-server); frame-time p50/p95 (needs in-app probe); multi-GPU/low-end hardware behavior; RT-BEACON root cause (confirmed as communication failure; underlying activation logic conflict with the passing isolated spec needs manual play).
- **Risks in the plan:** compat post-processing (R1 fix) touches the most fragile path — needs the parity test first; locomotion threshold retune (MOV-1) changes visible feel everywhere — needs before/after capture gates; interaction event additions touch the EventBus contract — version the event names; editor undo expansion risks regressions in the only un-tested subsystem — land CommandHistory tests before refactoring it; profile-based VFX scaling changes cinematic look — screenshot-gate it.
- **Conflicting evidence:** beacon activation (works in isolated Playwright, failed confirmation in live procedural probing); F1 keypress (native CDP press didn't trigger, synthetic dispatch did — likely CDP quirk, but verify a real keyboard).

### 2026-07-22 implementation closeout addendum

This addendum updates status without rewriting the 2026-07-17 audit snapshot. The implementation ledger and exact evidence are in [Kinema Implementation Closeout](./kinema-implementation-closeout.md) and [KIN-031 Rollout Evidence](./evidence/kin031-rollout.md).

- The five headline gaps are materially addressed: the editor trust/undo chain, compatibility parity/labeling, interaction outcome feedback, accessibility/input parity, and the showcase recovery/readability arc all received their planned KIN-001–031 work.
- The 14-bay matrix is now 14/14: all bays have readable stable signs; Steps and Slopes have explicit rejection cues; Grab has a replayable real-body delivery goal; Throw proves real pool recycling; Vehicles provide source-aware guidance; moving/physics platforms have behavior proof; Materials/VFX/Navigation are honestly passive; Future Lab is reserved with zero collectibles; and a back-half checkpoint/trail closes the recovery gap.
- All 27 renderer/profile/input observations passed twice consecutively. Installed Chrome additionally captured the 17-view true-WebGPU gallery, two alternate-renderer spots, 14 balanced bay windows, and 36 renderer/profile/scene windows with zero unexpected errors. An exact 36-window prechange baseline was recaptured from isolated worktree commit `5cb3f28` on the same host/browser/viewport; every matched post window passed `before p95 x 1.10 + 2ms`.
- KIN-001 supersedes the original “no frame-time p50/p95” limitation. On the final hardware run every balanced isolated bay measured `10.1ms` p95; matched per-bay gates were `11.24ms` (`11.35ms` for Throw). Balanced true-WebGPU entrance measured `12.2ms` against the fixed `20.895ms` ceiling. Compatibility VFX post/bare median ratio was `1.00` against `1.10`.
- `RT-BEACON` is resolved: full-run browser proof now observes the outcome event, prompt lifecycle, audio/VFX, objective/checkpoint behavior, and reset contract. The historical conflict remains above to preserve the original evidence trail.
- `KIN-T17 / LVL-F14` is stale because throwable/target CCD already existed before the audit. `A12` volume double-application and `R10` environment-label mismatch are superseded unless reproduced against the final branch.
- `KIN-T13`, `KIN-T20`, and `KIN-T21` were included and completed. `KIN-T19` was runtime-authenticated after `c8ea41f`: current balanced reported `aoDenoiseActive=false` for all three runs, the candidate reported `true` for all three, both had zero errors, and the candidate showed no material visual or performance advantage. Production therefore remains cinematic-only denoise.
- Optional tails remain deferred where no acceptance proof required them: dead FSM/sensor cleanup, interaction hysteresis/empty-press policy, throw wall clearance, carry-jump policy, camera damping/cast cadence, music/dynamics perceptual tuning, exposure persistence, editor feature expansion/Open flow, and level-schema collider/CCD expansion. The asset purge is deferred because no validated unused-asset manifest exists. WebKit remains deferred because it requires separate configuration/runtime approval and is not Safari certification.

Updated limitations: real Safari/iOS hardware, physical gamepad and touch hardware, perceptual audio review, production-host timing, and low-end/multi-GPU/thermal behavior remain unverified. Chromium/SwiftShader and device emulation are compatibility signals only. Three known Tone scheduling errors were separated from zero unexpected hardware-run errors; they are not claimed resolved.
