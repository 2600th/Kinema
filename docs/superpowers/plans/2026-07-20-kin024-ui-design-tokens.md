# KIN-024 Unified UI Design Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan test-first and request an independent review before landing.

**Goal:** Consolidate Kinema's canonical UI palette, spacing, typography fallbacks, and global stacking layers in one CSS source without changing layout or stacking behavior.

**Architecture:** `src/ui/tokens.css` is imported first by every independently loaded UI stylesheet. Existing surface-specific variables become aliases so selectors remain stable. Global overlays consume semantic z tokens with exact current values; component-local child layers remain numeric. DOM inline styles use CSS `var(...)`; `VirtualJoystick` resolves root hex tokens once because Canvas 2D cannot resolve custom properties.

**Research:** Google Fonts' official CSS2 API documents the `display` query parameter as the `font-display` control and lists `swap` as supported. The existing URL already uses `display=swap`; only local fallback stacks change. See https://developers.google.com/fonts/docs/css2.

**Tech Stack:** CSS custom properties, TypeScript 5.9, Canvas 2D, Vitest 4, Playwright, Biome, Vite 8.

## Token Contract

- Colors: `--k-accent`, `--k-accent-hover`, `--k-accent-cyan`, `--k-text`, `--k-muted`, and background variants.
- Spacing: `--k-space-1..6` = `4/8/12/16/24/32px`.
- Typography: Outfit/Inter stacks with `ui-sans-serif`, `system-ui`, Apple, Segoe UI, and generic fallbacks.
- Global layers preserve current values: canvas 0, UI 10, fade 100, damage 999, HUD/touch 1000, effects/debug 1100, death particles 1101, menu 1200, hint 1250, loading 1300, editor context 2000, editor panels 10000, playtest 10001, fatal 99999.
- Local stacking values 0/1/2 are intentionally not global tokens.

---

### Task 1: Baseline and RED token contract

**Files:**
- Create: `src/ui/tokens.test.ts`

- [ ] Run `tests/visual-regression.ts` twice serially before source changes.
- [ ] Assert exact canonical token values, imports at the start of all four CSS entry files, and aliases for menu/editor typography and accents.
- [ ] Assert the old `#7b2fff/#ff6b9d/#00d2ff` and RGB equivalents are absent from `src/`.
- [ ] Assert global layer consumers no longer contain their prior raw z-index values.
- [ ] Assert the Google Fonts URL retains `display=swap` and the shared font token contains a complete local fallback chain.
- [ ] Run the new test and preserve the expected RED result.

### Task 2: Add the token source and migrate CSS surfaces

**Files:**
- Create: `src/ui/tokens.css`
- Modify: `src/ui/menus/menus.css`
- Modify: `src/ui/components/hud.css`
- Modify: `src/input/touch-controls.css`
- Modify: `src/editor/styles/editor.css`
- Modify: `index.html`

- [ ] Add token imports before all other rules.
- [ ] Alias existing menu/editor variables to shared tokens rather than rewriting selectors.
- [ ] Replace the divergent touch/editor pink/purple/cyan values with canonical values/tokens.
- [ ] Apply shared spacing to identical 4/8/12/16/24/32px declarations where this is a literal 1:1 substitution.
- [ ] Replace global CSS z-index literals with semantic tokens; preserve local child layers.
- [ ] Use the shared UI-layer token with a numeric fallback in `index.html`.

### Task 3: Migrate dynamic and canvas consumers

**Files:**
- Modify: `src/ui/components/DeathEffect.ts`
- Modify: `src/input/VirtualJoystick.ts`
- Modify: `src/ui/components/LoadingScreen.ts`
- Modify: `src/ui/components/DebugPanel.ts`
- Modify: `src/ui/components/FadeScreen.ts`
- Modify: `src/ui/UIManager.ts`
- Modify: `src/main.ts`
- Modify: `src/renderer/rendererBootstrap.ts`
- Modify: editor panel/playtest files containing global z layers

- [ ] Use CSS variables directly in inline DOM styles and injected stylesheets.
- [ ] Resolve `--k-accent`, `--k-accent-hover`, and `--k-accent-cyan` once for Canvas 2D; validate/fallback to canonical hex before deriving alpha colors.
- [ ] Keep DebugPanel colors unchanged while sharing only font and z tokens.
- [ ] Map every global z consumer 1:1 to its semantic token with a numeric fallback.
- [ ] Re-run the token contract and focused component tests to GREEN.

### Task 4: Visual proof and landing

**Files:**
- Update ignored state: `tasks/todo.md`, `.superpowers/sdd/progress.md`
- Create ignored evidence under: `output/kin024/`

- [ ] Run full units, TypeScript, touched-file Biome error diagnostics, build, and direct grep gates.
- [ ] Run KIN-004 anchors twice serially; the unchanged menu anchor must remain within tolerance.
- [ ] Run relevant menu, mobile touch/landscape, hazard/death, and editor journeys serially.
- [ ] Capture and inspect touch controls and death effect plus representative menu/HUD/editor surfaces.
- [ ] Request independent GPT-5.6 SOL review of the exact task diff, address findings test-first, then make one detailed KIN-024 implementation commit.
