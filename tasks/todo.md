# Task Plan

## Goal

Fix the iOS Chrome landscape/resizing and partial-world rendering issues without regressing desktop or existing mobile touch behavior.

## Assumptions

- The "doesn't run in landscape mode automatically" report is about the web app not resizing/recovering correctly when the device rotates, not about forcing system-level orientation lock from the browser.
- Chrome on iOS uses a WebKit-based engine, so iOS-specific viewport and GPU compatibility handling should be scoped to iPhone/iPad browsers rather than desktop Chrome.
- The safest rendering fix is to prefer the existing stable WebGL renderer path on iOS unless the user explicitly opts into newer rendering behavior.

## Success Criteria

- [x] The app resizes correctly when an iOS device rotates, including landscape gameplay and overlay alignment.
- [x] Portrait mode gives a clear, non-blocking hint when the game is better experienced in landscape.
- [x] iOS uses a compatibility renderer path that avoids the reported "only some meshes are visible" behavior.
- [x] Verification includes targeted tests plus build/lint coverage.
- [x] `tasks/todo.md` reflects the final state of this task.

## Execution Plan

- [x] Step 1 -> verify: Add iOS/mobile viewport handling and a landscape guidance UI, then verify with targeted unit/test coverage.
- [x] Step 2 -> verify: Default iOS browsers to the compatibility WebGL renderer path and verify the bootstrap/renderer behavior stays valid.
- [x] Step 3 -> verify: Run the strongest relevant checks (`npm run test`, targeted Playwright/ Vitest coverage if available, `npm run build`, `npm run lint`) and update the review.

## Review

- Added viewport resolution helpers that prefer `visualViewport`, update CSS viewport variables, and trigger resizes on `resize`, `orientationchange`, and `visualViewport` changes.
- Added a non-blocking portrait hint for Apple mobile browsers and switched iOS-family browsers to the compatibility WebGL renderer path by default, with `?experimentalRenderer=1` as an escape hatch.
- Verification completed:
- `npm run test`
- `npx playwright test tests/mobile-touch-controls.ts tests/mobile-orientation.ts`
- `npm run build`
- `npm run lint` (passes with the repo's existing non-blocking warnings/infos)
