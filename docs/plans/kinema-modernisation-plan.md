# Kinema Modernisation Plan

Companion to `docs/audits/kinema-experience-audit.md` (2026-07-17, commit `9339bed`). Finding IDs reference that audit. Execution detail lives in `docs/plans/gpt-5.6-sol-execution-backlog.md`.

## 1. Recommended Product Direction

Kinema should double down on being **the trustworthy browser gameplay laboratory**: a place where every mechanic demonstrates itself, every renderer path is honest about what it shows, and the editor never betrays a creator. The audit shows the engineering core already supports this; the work is finishing the experience contract, not adding scope. Explicitly reaffirmed non-goals: no narrative, progression economy, multiplayer, or content expansion beyond the existing 14 bays (futureA stays reserved).

## 2. Systems to Preserve (do not damage)

- Fixed-step loop, interpolation, hitstop semantics, input edge-merge (`GameLoop.ts`, `Game.ts:376-406`).
- Jump-feel constants and dual coyote/buffer handling; floating-capsule motor.
- CharacterMode/FSM split; EventBus decoupling; pure-helper testing pattern.
- Renderer path trio and the compat NodeMaterial sanitizer; texel-snapped shadows; MRT emissive bloom.
- Unload/disposal hygiene and load-generation guards; throwable pooling.
- Menu visual identity (glass/Outfit/triad); mobile safe-area and touch-target foundations.
- The throw station's feedback loop — it is the internal quality bar.
- `window.__KINEMA__` deterministic hook surface (extend, never remove).

## 3. Systems to Simplify or Remove

- **Remove:** dead `getDesiredMovement` FSM chain (FSM-3); unused interaction sensor colliders *if* per-object radii are adopted instead (I-1); dead `SFXEngine.respawn()` (A11); cloned rain geometry (R12); unused FBX/setup-PNG asset duplicates from `public/` (~47MB) — move to a non-served folder or delete.
- **Simplify:** FeedbackPlayer — either use real timelines or call primitives directly (JUICE-2); double-applied volume settings path (A12); duplicated Playwright readiness helpers → one shared helper module (TEST-F10); save flow → one save dialog, download opt-in (ED-F10).
- **Do not simplify:** the three renderer paths (they are the product), the 12-state FSM (all states earn their place once rope exit is fixed).

## 4. Visual Direction

Commit to the existing **stylized color-coded laboratory** language and finish it:

- Replace the blurred-HDR sky with a designed gradient/procedural sky (per-path capable); keep HDRs for IBL only. Fixes the "unfinished blob" backdrop on every screenshot.
- Treat hall edges: visible boundary language (low emissive trim wall or gradient falloff) instead of the hard floor/void seam; raise the 0.7m curbs where the boost pad can eject players (F4).
- Hero-character material pass on the mannequin (keep the mannequin, own it: lab-specimen fresnel/trim identity rather than default purple plastic).
- Station framing kit: consistent pedestal trim + emissive accent + sign mounting per station color; reduce fog density so the next two stations' silhouettes and the end-of-corridor landmark read (wayfinding, F11).
- Density: keep bays sparse-readable; spend added detail only on interaction zones (decals/markers showing where to stand/what to try, e.g. slopes "too steep" lane marker, steps too-tall contrast block).

## 5. Interaction and Motion Language

One feedback contract for every player action (pillar 2): **input → immediate acknowledgment (≤50ms: animation start/UI tick) → world response (VFX/physics) → audio → result state (prompt/objective/HUD updates)**. Backed by:

- Domain events for door/beacon/rope (+ outcome payloads on `interaction:triggered`) so audio/juice/objectives can react (I-3/I-4).
- Prompt pipeline re-evaluates on state change, clears when unfocused, and swaps glyphs by input source (UI-F3, RT-PROMPT).
- Motion system tokens: micro (0.12–0.16s), panel (0.18–0.24s overshoot allowed), modal (0.24–0.3s), reward (0.4–0.6s), warning (instant in, 0.3s out), loading (continuous), editor state (0.12s, no overshoot). All interruptible; all respect reduced-motion. These formalize the durations already in use — no new aesthetic.

## 6. UI Design Direction

- Promote the menu token set (`menus.css:1-12`) to a shared `tokens.css` consumed by HUD, touch, loading, debug, editor; collapse the divergent touch/death triad into the menu triad; add spacing + z-index scales (UI design-system finding).
- Accessibility baseline pass (see §12) folded into every component touched.
- HUD: input-source-aware glyph component; status lane with `aria-live`; collectible chip shows `x/70`; suppress contact toasts for 1s post-load (RT-IMPACT); hide HUD in editor (RT-EDITORHUD); landscape layout grid that reserves HUD corners so touch clusters never collide (RT-TOUCH).
- Menus: focus ring token; gamepad navigation layer; dialog roles + focus trap/restore; pause stack fix (RT runtime finding); renderer/profile badge in Graphics tab + brief on-load toast ("WebGL compatibility mode — post effects off", R2).
- Settings: persist or relocate the six debug toggles (UI-F4); align slider ranges with store clamps (UI-F9); add camera-effects intensity, reduced-motion override, damage-flash cap, sprint/crouch hold-toggle, gamepad/touch look sensitivity (UI-F10/CAM-1).

## 7. Animation Direction

- Rebracket locomotion thresholds to authored speeds so walk/jog/sprint all live (MOV-1) — the single most visible animation fix; verify with side-by-side capture.
- State-exit correctness: rope exit (ROPE-1), land-state early exits for crouch/interact (FSM-2), airborne carry pose (CARRY-1).
- Then polish only where the contract demands: crouch enter/exit blend, vehicle enter/exit (short teleport-mask fade is acceptable at lab scope), NPC idle default instead of T-pose before first tick.
- Keep code-driven movement (no root motion); keep timeScale anti-slide approach.

## 8. VFX Hierarchy

1. **Critical/warning:** damage flash (capped intensity setting), hazard telegraphs, OOB/void warning.
2. **Interaction confirmations:** door swing dust, beacon activation burst (exists — must fire visibly with the event fix), grab/throw (exist), rope attach.
3. **Rewards:** coin burst (exists), checkpoint (exists), all-coins celebration (new, one-shot).
4. **Locomotion/vehicle support:** footstep/land dust (exist), vehicle dust/skid + boost trail (new, pooled, all-path).
5. **Ambient:** sparkles/motes/grass — becomes profile-scaled and distance-culled (R3/R5) and never visually outranks tiers 1–3.

Every effect ships with: trigger event, pooled implementation, all-three-path behavior (or explicit compat fallback), profile multiplier (perf 0.35 / balanced 0.65 / cinematic 1.0), reduced-effects respect.

## 9. Audio Direction

- Context lifecycle first: pause ducks/halts sustained SFX (A2); `visibilitychange` suspends (A1); editor ducks music (A3); fix stop/start double-layer race (A4).
- Complete the event map once interaction events exist: door, beacon, rope, fall-damage hit, boost, vehicle collision, editor confirmations (place/save/undo — subtle ticks), menu-open symmetry.
- Music: raise on-foot intensity reachability (A9), motif + shorter gameplay reverb to reduce fatigue (A10); keep the 4-layer architecture.
- Efficiency: pooled UI/coin voices with min-interval gates (A6/A8); pre-built death reverb/checkpoint chorus (A7).
- Profiles: gameplay full mix; editor SFX-only (music off); debug/menu unchanged. No spatialization initially (A5 → deferred; mono is acceptable at lab scope — revisit after core contract lands).

## 10. Editor UX Direction

Target: **PlayCanvas-grade trust at Kinema scope.**

- Kill the P1 chain: scene transitions always terminate play-test; stale Stop impossible; snapshot restore guarded (RT-ED-CHAIN).
- Truth systems: dirty flag on every mutation → toolbar dot + `beforeunload` warning (ED-F1); save returns success honestly (ED-F4); Ctrl+S implemented (ED-F3); overwrite confirm (ED-F13); session-local GLB banner at import + placeholder flagging on load (ED-F9).
- Undo everywhere: route all document/inspector mutations through commands (ED-F6); child-aware delete (ED-F7); keep history across play-test if feasible, else warn.
- Workflow: in-editor Open dialog from LevelSaveStore; download opt-in; camera pose survives F1 toggle (ED-F14); drag-end collider rebuild (ED-F5).
- Capability (second wave): drag-to-size brushes (params exist, ED-F8), multi-select (ED-F11), primitive palette (ED-F12), named object generation ("Block 3" not "Object").
- Control separation: creation tools (toolbar/palette) vs advanced (snapping values, physics types — inspector groups) vs graphics/debug (stays in DebugPanel) vs destructive (delete/overwrite — confirm affordances). Desktop-first stands; no mobile editor.

## 11. Renderer and Graphics Strategy

- **Parity floor for compat:** `antialias:true` at creation + a minimal post stack (FXAA-equivalent already free via MSAA; add LUT + vignette via a small composer) scaled by profile; keep TSL exclusives (SSR/GTAO/TSL VFX) as labeled WebGPU features (R1).
- **Honesty layer:** renderer/profile badge (R2); per-path station content labeled — compat VFX bay gets its own accurate sign text (LVL-F12) or upgraded content.
- **Stability:** fix ShadowDepthTexture destroyed-texture warnings on profile rebuild (RT-PROFILE-WGPU); add the profile-cycling regression test; shader warmup via `compileAsync` before loading-screen hide (R4).
- **Cost:** profile-scaled VFX (R3); sparkle distance-culling (R5); trimesh→primitive collider sweep (LVL-F2/F3); compat sanitize on dirty-flag not periodic sweep (R9); async navmesh (console warning).
- **CI blindness:** document that SwiftShader tests WebGPU-on-WebGL2 only; add a manual true-WebGPU checklist and (optional) a scheduled run on real-GPU hardware.

## 12. Accessibility Baseline

Ship as one bundle (each item cited in audit §18): visible focus tokens on all interactive elements; dialog roles + focus trap/restore; aria-live for status/objective/collectibles/health; aria-hidden on opacity-0 phantoms; labeled touch buttons; gamepad menu navigation + pause binding; input remapping for move/jump/interact/crouch/sprint; sprint/crouch hold-vs-toggle; camera-effects intensity slider (0–100%); damage-flash cap; in-app reduced-motion honoring OS default; slider ranges matched to store; contrast raise on informational text. Explicitly not pursued: subtitle/caption systems, screen-reader-driven 3D gameplay.

## 13. Performance Strategy

Measure → budget → optimize, in that order:

1. **Phase 0 instrumentation:** in-app frame-time probe (p50/p95/long frames) exposed via `__KINEMA__.getFrameStats()`; prod-build load timing; per-station draw-call/triangle counts via renderer.info; memory across 3 load cycles.
2. **Budgets (set after baseline, per profile/path):** target-class examples to validate, not to enforce today — balanced@1080p discrete GPU ≈ 16.6ms p95; compat mobile-class ≈ 33ms p95; showcase load ≤4s prod cold.
3. **Known-cost work queue (already evidence-backed):** shader warmup (R4), async navmesh, trimesh sweep (LVL-F2/F3), VFX profile scaling (R3), sparkle culling (R5), compat sanitize dirty-flag (R9), audio pooling (A6/A7), collider index copy (F3), editor drag rebuild (ED-F5), serve-folder asset purge.
4. **Regression gates:** frame-stats assertions in Playwright (loose bands), bundle-size check in CI, load-time budget in the station spec.

## 14. Recommended Vertical Slice

**"Entrance → Steps → Movement → Door" (first four bays + arrival), 3–5 minutes, plus the renderer badge.** Includes: menu → load (warmup + progress) → spawn (grounded, no phantom toasts) → steps (autostep + too-tall cue + coins x/70) → movement bay (ladder/crouch/rope with fixed rope exit and per-mechanic signs) → door bay (door with sound/event, beacon with confirmed activation celebration, checkpoint) → pause/resume → restart. Runs on all three renderer paths with the badge visible; keyboard+gamepad+touch.

**Why this slice:** it exercises every system the audit found weakest (interaction contract, prompts, state exits, HUD communication, wayfinding, renderer honesty) inside the first two minutes of a real visitor's session, while touching zero new content. **Validates:** feedback contract, accessibility bundle, compat parity floor, locomotion retune, coin arc. **Unchanged:** vehicles, editor (parallel track), stations 5–14 visuals. **Assets required:** none new (sky + markers are procedural/CSS; all animation clips exist). **Success evidence:** before/after capture set at fixed spawns on all three paths; state-transition timeline for rope/land; a11y checklist pass; beacon activation observable in one event log line + HUD change. **Lessons propagate:** the station framing kit, feedback contract, and glyph system then roll out bay-by-bay (Phase 8).

## 15. Phased Implementation Roadmap

Mirrors the backlog ordering (IDs there):

- **Phase 0 — Baseline & regression protection:** frame/load instrumentation; shared Playwright helpers + serialized heavy suites; editor `__KINEMA__` hooks + CommandHistory/LevelSerializer unit tests; profile-cycling and parity smoke tests; visual baseline harness (deterministic frame); CI notes on SwiftShader blindness.
- **Phase 1 — Stability & functional defects:** editor play-test chain (P1); quota-save honesty; frozen nav NPCs; rope FSM exit; ShadowDepthTexture rebuild bug; pause-stack fix; direct-entry pause menu; spurious impact toasts.
- **Phase 2 — Character/camera/interaction foundations:** locomotion rebracket; land-state exits; step assist dt + height; interaction domain events + outcome payloads; prompt pipeline (fresh, device-aware); beacon lifecycle; car exit safety + manual vehicle reset; camera comfort setting groundwork.
- **Phase 3 — UI/UX & editor workflow:** token unification; accessibility bundle; settings persistence/relocation; editor dirty-state + save flow + undo coverage + camera persistence; HUD-in-editor; landscape HUD/touch grid.
- **Phase 4 — Animation & game feel:** missing juice hooks; crouch/vehicle transitions; NPC idle default; feedback-contract polish per action.
- **Phase 5 — Art direction & visual modernisation:** sky; hall edges; station framing kit; hero material; fog/wayfinding; interaction-zone markers.
- **Phase 6 — VFX & audio:** hierarchy implementation with profile scaling; vehicle dust/skid/boost; celebration; audio lifecycle (pause/tab/editor); new event sounds; music reachability/motif; pooling.
- **Phase 7 — Performance/compat/a11y closure:** compat post stack + badge; trimesh sweep; sparkle culling; async navmesh; sanitize dirty-flag; budget gates; Safari hardware pass; remap UI.
- **Phase 8 — Rollout & validation:** apply slice standard to bays 5–14; full-matrix re-test (3 paths × 3 inputs × profiles); before/after gallery; re-run all suites; document remaining limitations.

Order rationale: Phase 0 before 1 because the editor P1 fix needs the hooks/tests to prove itself; events (Phase 2) before audio/VFX phases because they're the substrate; art (5) after foundations so markers land on final framing. Change the order only if evidence contradicts (e.g., if profiling shows load time dominates perception, pull warmup into Phase 1).

## 16. Impact-versus-Effort Matrix

**Quick wins (high impact / small):** rope exit; locomotion thresholds; renderer badge; frozen-NPC fix; quota-save honesty; Ctrl+S; spurious-toast suppression; slider-range alignment; coin `x/70`; asset-folder purge; focus-ring token.
**Foundational (high / medium-large):** editor play-test chain + dirty-state; interaction domain events + prompt pipeline; accessibility bundle; compat post stack; VFX profile scaling; audio lifecycle; Playwright helper consolidation + editor hooks.
**High impact / large:** undo-everywhere; station framing kit + sky; full glyph/input-source system; gamepad menu navigation.
**Nice / small (schedule opportunistically):** hysteresis; dead-code removals; env-label sync; landing-spring damping; futureA coins.
**Requires design approval:** death → checkpoint-respawn instead of full reload (F5); MOV-2 stop-feel retune; vehicle spike/coin policy (F10); sky direction; hero-material look.
**Regression-prone (gate with tests/captures):** compat post stack; locomotion retune; undo refactor; profile VFX scaling; interaction event rename.
**Reuses existing assets:** everything except zero new binary assets required in Phases 0–7.
**New art/audio needed:** none mandatory (procedural sky, synth audio, CSS/shader markers); optional later: custom character skin.

## 17. Dependencies

- Interaction domain events → audio/VFX/objective tasks for door/beacon/rope; prompt pipeline.
- Editor hooks + unit tests → editor P1 fix verification → undo expansion → workflow polish.
- Frame instrumentation → all optimization acceptance criteria and budget gates.
- Token file → accessibility bundle → glyph system → gamepad menu nav.
- Compat parity test → compat post stack → per-path station content honesty.
- Profile multiplier plumbing → VFX scaling → overdraw culling acceptance.

## 18. Risks

Carried from audit §24 plus execution risks: compat composer touching the sanitizer path (mitigate: parity test first, feature-flag `?compatPost=0`); WGSL/TSL churn across three.js ~0.183 pin (keep `docs/threejs-changelog-notes.md` current); event renames breaking untyped `__KINEMA__` specs (type it first, TEST-F11); undo refactor regressions (CommandHistory tests first); perceived-feel regressions from retunes (capture-gated, design sign-off); single-machine perf numbers (record hardware identity with every baseline).

## 19. Deferred Recommendations

Audio spatialization (A5); WebKit Playwright project + real-Safari certification cadence; multi-select/box-select (after single-select trust lands); drag-to-size brushes (after undo coverage); level-editor asset persistence beyond localStorage (e.g., File System Access API) — valuable but new scope; visual-regression expansion beyond 3 anchor scenes; music motif system beyond reachability fix; NPC audio presence; input-remap conflict-resolution UI beyond core five actions.

## 20. Rejected Recommendations (with reasons)

- **Progression/story/economy/multiplayer/content packs:** out of product scope by brief and evidence — the lab framing is the value.
- **Full mobile editor:** desktop-first stands; mobile is for play/validation (README-aligned; no evidence of need).
- **Photorealistic art direction / new character & environment asset packs:** cost dwarfs value; the stylized lab language is closer and ownable.
- **Physically simulated vehicle realism:** the arcade assist layer is the right call for a lab; realism would fight the crash-playground fun.
- **Replacing Tone.js synthesis with sample libraries:** synthesis fits the lab (zero asset weight, infinite variation); fix lifecycle/coverage instead.
- **Migrating off rapier3d-compat or three.js pin as part of this effort:** churn risk unrelated to experience goals; keep upgrades on their own track (notes doc exists).
- **Deleting the WebGPU-on-WebGL2 path as redundant:** it is the only CI-testable TSL path and the only true A/B lever — keep.
- **Blanket "add more particles/juice everywhere":** audit shows the ambient tier is already over-served; the contract approach targets meaning, not volume.
