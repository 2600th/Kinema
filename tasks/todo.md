# Task Plan

## Goal

Research reliable iOS/Android support patterns for three.js, and identify the root cause of the iOS 16 load that appears to stop after showing only the player/ground/static frame in Chrome on iOS.

## Assumptions

- Chrome on iOS still runs on Apple WebKit, so iOS 16 constraints are fundamentally WebKit/WKWebView constraints rather than Chromium desktop behavior.
- The reported static-frame symptom likely happens after partial world bootstrap, so the key failure may be in asynchronous procedural building, asset loading, render-loop continuity, or another platform-incompatible code path rather than initial app startup.
- The right answer should combine platform research with repo-specific diagnosis instead of assuming one generic mobile three.js fix.

## Success Criteria

- [x] Research captures current, platform-specific guidance for supporting three.js on iOS and Android, with emphasis on browser/runtime constraints relevant to this repo.
- [x] The iOS 16 loader/static-frame failure is traced to a concrete likely cause in this codebase or runtime behavior.
- [x] Findings distinguish between platform limits, probable repo bugs, and next-step fixes.
- [x] `tasks/todo.md` reflects the final state of this investigation.

## Execution Plan

- [x] Step 1 -> verify: Researched mobile support constraints: iOS Chrome still follows WebKit/WKWebView limits, orientation lock remains limited, `visualViewport` is the correct visible-viewport source, and the repo should stay on compatibility WebGL plus capability-gated scene features for Apple mobile browsers.
- [x] Step 2 -> verify: Inspected the renderer/load path, procedural builder, asset loaders, and audio bootstrap; reproduced an iOS-like WebKit failure locally with Playwright WebKit using an iOS 16-style Chrome UA.
- [x] Step 3 -> verify: Traced the blocking failure to Tone/Tone.js audio initialization aborting bootstrap in a WebKit-like environment; once audio init was allowed to degrade to a silent controller, the menu loaded and the procedural level completed with late-stage objects (`NavPlatform`, `VFX_Scanner`, `FutureA_barrier_0`) visible.
- [x] Step 4 -> verify: Added safe audio fallbacks plus silent-controller bootstrap recovery, then verified with `npm run test`, `npm run build`, `npx playwright test tests/mobile-compat-procedural.ts --reporter=line`, and a Playwright WebKit iOS-16-style local probe.

## Review

- Root cause identified: audio bootstrap compatibility was aborting app startup on a WebKit-like mobile path, which matches the user-observed partial/static scene better than a pure procedural geometry failure.
- Repo now degrades audio safely instead of failing bootstrap when Tone dynamics or downstream nodes are not supported.
- Local WebKit is still only a close proxy for iOS Chrome, not a physical iOS 16 device, so the next strongest confirmation is a real-device pass on Chrome/Safari iOS 16+.
