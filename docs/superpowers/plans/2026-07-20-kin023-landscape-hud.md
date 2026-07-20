# KIN-023 Landscape HUD And Editor Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan with test-first increments and independent review.

**Goal:** Give mobile landscape a collision-free HUD/touch contract and hide the complete gameplay HUD while editing without losing live HUD state.

**Architecture:** `HUD` owns a lightweight `#hud` root around only gameplay surfaces. Editor events toggle that root's native `hidden` state, while a composed root `aria-hidden` value reflects both editor visibility and existing menu accessibility suppression. A landscape-only CSS media query moves the collectible, health, and objective surfaces into a compact top-center band; touch geometry stays unchanged.

**Tech Stack:** TypeScript 5.9, DOM/CSS, Vitest 4, Playwright, Biome, Vite 8.

## Constraints

- Preserve desktop and portrait layout, current safe-area handling, and touch-control geometry.
- Do not clear or rebuild HUD content on editor open/close.
- Keep editor and menu accessibility suppression independent and order-safe.
- Test both 844x390 and 932x430 with iPhone-like touch/browser signals.
- Keep browser verification serial and do not overwrite or stage the user's original audit captures.

---

### Task 1: Specify HUD visibility ownership with failing unit tests

**Files:**
- Modify: `src/ui/components/HUD.test.ts`
- Modify: `src/ui/UIManager.test.ts`

- [ ] Assert `HUD` creates `#hud`, hides it visually/accessibly for editor mode, and restores the same populated elements afterward.
- [ ] Assert menu accessibility suppression and editor hiding compose correctly in both release orders.
- [ ] Assert `UIManager` routes `editor:opened` and `editor:closed` to the HUD visibility API.
- [ ] Run `npx vitest run src/ui/components/HUD.test.ts src/ui/UIManager.test.ts` and preserve the expected RED result.

### Task 2: Implement non-destructive editor HUD visibility

**Files:**
- Modify: `src/ui/components/HUD.ts`
- Modify: `src/ui/UIManager.ts`

- [ ] Create a `#hud` root containing only HUD-owned elements.
- [ ] Add an editor-active state that toggles native `hidden` without calling destructive `hideGameHUD()`.
- [ ] Compute root `aria-hidden` from editor-active OR menu accessibility suppression.
- [ ] Subscribe/unsubscribe through the existing `UIManager` event lifecycle.
- [ ] Run the focused unit tests to GREEN.

### Task 3: Specify and implement the landscape collision contract

**Files:**
- Modify: `tests/mobile-landscape-layout.ts`
- Modify: `src/ui/components/hud.css`

- [ ] Parameterize the browser spec over 844x390 and 932x430.
- [ ] Assert every visible touch button is inside the viewport and pairwise non-intersecting with the collectible, health, and objective HUD surfaces.
- [ ] Run the extended spec before CSS changes and preserve the expected RED collision diagnostics.
- [ ] Add a max-height 500px landscape media query that places stats around center and the objective below them, using safe-area-aware widths.
- [ ] Run the two viewport cases serially to GREEN.

### Task 4: Prove editor behavior and finish the card

**Files:**
- Modify: `tests/mobile-landscape-layout.ts`
- Create ignored evidence under: `output/kin023/`
- Update ignored state: `tasks/todo.md`, `.superpowers/sdd/progress.md`

- [ ] Add a real editor open/close journey that proves `#hud` visual/accessibility state and live content restoration.
- [ ] Run focused and full units, `npx tsc`, scoped Biome error diagnostics, and `npm run build`.
- [ ] Run the complete KIN-023 browser spec twice serially.
- [ ] Capture 844x390 gameplay and desktop editor-open screenshots, inspect both, and retain them outside the user's audit files.
- [ ] Request independent GPT-5.6 SOL review of the exact task diff, address findings test-first, then commit the final verified increment.
