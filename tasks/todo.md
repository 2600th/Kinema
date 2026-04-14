# Task Plan

## Goal

Fix the remaining iOS-browser regressions: landscape touch controls must fit without overlap, and the procedural level must load completely instead of stopping after the static ground/ramp subset.

## Assumptions

- The Vercel deployment at `https://kinema-play.vercel.com` is the best live repro target for the reported iOS browser behavior.
- Chrome on iOS shares WebKit engine constraints with Safari, so the solution should target Apple mobile browser behavior rather than Chrome-desktop-specific behavior.
- The procedural loader issue is more likely a runtime/asset-loading failure than a content bug, because the player ground and a few early-built meshes still appear.

## Success Criteria

- [x] Landscape touch controls remain fully visible on mobile-sized viewports without joystick/button overlap.
- [x] The procedural level fully loads on Apple mobile browser conditions instead of exiting early.
- [x] The fix matches current iOS/WebKit browser constraints where possible and degrades gracefully where not.
- [x] Verification includes relevant automated tests/build/lint.
- [x] `tasks/todo.md` reflects the final state of this task.

## Execution Plan

- [x] Step 1 -> verify: Reproduce the landscape layout break and compatibility-renderer procedural failure under iPhone-like browser conditions, capture runtime evidence, and identify the failing code path.
- [x] Step 2 -> verify: Research current iOS/WebKit browser limits for orientation handling and WebGL/WebGPU behavior, then map those findings to the repo implementation.
- [x] Step 3 -> verify: Implement the smallest code changes that fix the touch-control layout and procedural load reliability issues.
- [x] Step 4 -> verify: Run focused Playwright coverage plus `npm run test`, `npm run build`, and `npm run lint`, then push the final commit to GitHub.

## Review

- Verified with `npx playwright test tests/mobile-touch-controls.ts tests/mobile-orientation.ts tests/mobile-landscape-layout.ts tests/mobile-compat-procedural.ts`.
- Verified with `npm run test`.
- Verified with `npm run build`.
- Verified with `npm run lint` (existing repo-wide warnings/infos remain unchanged and non-blocking).
