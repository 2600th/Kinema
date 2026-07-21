# KIN-028 Compatibility Renderer Parity Implementation Plan

> **For agentic workers:** Execute test-first, preserve the three internal commit boundaries, and request independent GPT-5.6 SOL review before closing the card.

**Goal:** Raise the WebGL compatibility renderer from a bare fallback to an honest, measurable parity floor without changing WebGPU rendering.

**Architecture:** `RendererManager` continues to own renderer selection, effective graphics state, LUT assets, resize, render routing, and disposal. A new WebGL-only `CompatPostStack` owns an `EffectComposer` chain of `RenderPass -> CompatGradePass`. The final raw pass combines Three-equivalent output tone mapping/color conversion with the existing TSL vignette/LUT order, samples the shared parsed 3D LUT, and renders the HDR scene at a measured 0.75 compatibility scale with capped 2x MSAA; performance bypasses the composer entirely. Renderer presentation state is exposed as a small immutable value and consumed by a dedicated UI badge/toast plus the Graphics settings line. `ProceduralBuilder` selects accurate per-path copy and exposes a stable station-sign name for structural path-parity checks.

**Measured re-plan:** Three’s official EffectComposer is WebGLRenderer-only, and its `OutputPass` supplies tone mapping/output conversion. The initial `RenderPass -> OutputPass -> CompatGradePass` design failed the mandatory SwiftShader A/B at 233.3 ms enabled versus 150 ms bare. Combining `OutputPass` semantics into the raw grade pass reduced enabled p95 to 200 ms; preserving half-float HDR and applying a 0.75 internal compatibility scale brought the unchanged three-window gate inside 1.10x. Because canvas MSAA does not affect offscreen composer targets, both composer render targets initially received up to four samples.

**Full-suite revalidation:** After the complete serial matrix exposed a repeatable 1.143 enabled/bare ratio on the slower sustained-load proxy, the offscreen target cap was reduced from 4x to 2x MSAA while retaining the 0.75 scale and unchanged grade shader. The same three-window gate then measured 250.0ms enabled versus 233.4ms bare (1.071), with zero runtime errors.

**Feature escape hatch:** `?compatPost=0` disables compatibility antialias context creation and the composer, restoring the prior bare render branch. It intentionally leaves the renderer badge/signage visible because those are disclosure rather than rendering mutations.

## Stale-Card Corrections

- KIN-024 tokens and z-index contracts are already landed.
- Settings post-effect intent now persists in `UserSettings`; only compatibility capabilities are missing.
- Compat VFX is animated and substantially richer than the audit’s static placeholder description, but its five effects still differ from the four advanced demos and the shared sign remains inaccurate.
- `RendererAssetLibrary` already owns parsed `Data3DTexture` LUTs; no loader duplication is needed.
- Frame p50/p95, renderer flags, named-object state, and station capture hooks already exist.
- Playwright SwiftShader represents WebGPURenderer-on-WebGL2, not hardware WebGPU or Safari. Final true-WebGPU proof must use headed Chrome; Safari certification remains out of scope.

## Commit 1 - Establish parity anchors and compatibility AA

**Files:** `src/renderer/rendererBootstrap.ts`, `src/renderer/RendererManager.ts`, focused renderer tests, `src/level/ProceduralBuilder.ts`, `tests/visual-regression.ts`, snapshot baselines.

1. Add a pure compatibility feature-flag resolver and pass its value into fallback renderer construction.
2. Write RED unit/browser contracts proving antialias `true` when enabled and `false` for `compatPost=0`.
3. Give the existing VFX station label a stable `VFX_StationSign` name without changing its transform or material.
4. Extend the existing allowlisted KIN-004 visual harness with separate default, forced-WebGPU-WebGL2, and bare-compat VFX captures plus fixed structural visibility/bounds assertions (`StationFloor_col`, `ShowcaseBay0_col`, `ShowcaseBayAccent0`, and `VFX_StationSign`).
5. Run targeted units, TypeScript, scoped Biome, build, and the serial visual-regression slice; commit the green increment.

## Commit 2 - Add the honesty layer

**Files:** renderer presentation state/tests, `src/ui/components/RendererStatusBadge.ts`, `src/ui/components/hud.css`, `src/ui/UIManager.ts` or bootstrap ownership seam, `src/ui/menus/SettingsMenu.ts` and tests, `src/main.ts`, `src/level/ProceduralBuilder.ts` and focused tests, affected Playwright specs/baselines.

1. Define one presentation value: backend label, applied profile, compact label, full settings label, compatibility state, and automatic-fallback flag.
2. Distinguish explicit compatibility forcing from automatic Apple routing and failed WebGPU bootstrap.
3. Write RED UI contracts, then render a persistent tokenized bottom-center chip and one accessible 4s automatic-fallback toast.
4. Show the full renderer/profile/capability line in Graphics settings and keep it current on menu rebuild/profile changes.
5. Select advanced and compatibility VFX sign copy from one pure label builder; describe the actual four advanced or five compatibility exhibits.
6. Extend existing browser tests for all-path badge text, live profile updates, fallback-only toast, and sign text. Update badge-affected visual baselines; commit independently.

## Commit 3 - Add the compatibility post stack

**Files:** new `src/renderer/compatPostStack.ts` and test, `RendererManager.ts`, `rendererState.ts` and tests, affected visual/mobile/profile specs, KIN-028 evidence.

1. Write RED ownership/profile/capability tests for a WebGL-only composer.
2. Create `EffectComposer` with `RenderPass` and one reusable raw output-grade pass for tone mapping, output conversion, LUT, and vignette; apply capped 2x samples to both internal render targets and the measured 0.75 compatibility scale.
3. Route only compatibility renders through it when enabled and effective: performance = bare composer disabled (canvas MSAA); balanced = LUT; cinematic = LUT + vignette.
4. Reuse cached LUT textures and synchronize LUT name/strength, vignette darkness, master post toggle, profile changes, pixel ratio, resize, and disposal.
5. Advertise only Post/LUT/Vignette capabilities on compat; keep SSAO/SSR/Bloom unavailable and leave every WebGPU descriptor/branch unchanged.
6. Add final enabled-compat visual baseline and compare the fixed structural object list across all paths.
7. Run an A/B mobile compatibility p95 probe under identical Chromium/SwiftShader CPU-throttle conditions (`compatPost=0` vs enabled), recording hardware/tool limitations. Require enabled p95 <= 1.10x bare.
8. Capture new three-path evidence plus headed Chrome hardware-WebGPU proof, run full gates, request SOL review, and commit.

## Final Verification

- Focused and full Vitest; `npx tsc`; production build; touched-file Biome zero-error gate.
- Repository lint diagnostic count no worse than the recorded pre-change 134 errors / 269 warnings / 11 infos.
- Serial `visual-regression`, `mobile-compat-procedural`, `graphics-profile-cycling`, and the narrowly affected VFX/menu cases.
- Three-path screenshot inspection and named-object visibility matrix.
- Mobile compatibility p95 A/B with proxy limitations documented.
- Headed Chrome confirms hardware WebGPU badge/path remains healthy and visually unchanged aside from disclosure.
- Independent GPT-5.6 SOL review returns Ready YES after any fixes.
