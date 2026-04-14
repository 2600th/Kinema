# Task Plan

## Goal

Fix the remaining Safari verification issues: UI elements should adapt cleanly to small/mobile viewports, and the VFX station should remain visibly populated on the Safari compatibility renderer path.

## Assumptions

- The VFX station issue is not a failed level load; the current Safari/WebGL fallback is simply too sparse to read as a proper station.
- The UI sizing complaint is most likely in the in-game HUD/touch layout rather than the main menu shell, because the menu layout already scales acceptably in Safari-like viewport probes.
- The right fix is a surgical improvement to Safari/mobile fallback behavior, not a redesign of the overall renderer or UI system.

## Success Criteria

- [x] Safari compatibility rendering shows a visibly populated VFX station instead of a nearly empty bay.
- [x] Small-screen/mobile UI surfaces adapt more predictably to viewport size changes.
- [x] Relevant verification passes run successfully.
- [x] `tasks/todo.md` reflects the final state of the work.

## Execution Plan

- [x] Step 1 -> verify: Inspected the Safari/WebGL VFX fallback plus viewport-sensitive UI layers, then reproduced the concrete touch-layout issue in a Safari/WebKit iPhone-sized probe where joystick zones overflowed off-screen.
- [x] Step 2 -> verify: Expanded the compatibility VFX fallback with visible tornado, fire, lightning, laser, and scanner props, and tightened viewport/safe-area anchoring for touch controls plus other Safari-sensitive UI sizing rules.
- [x] Step 3 -> verify: Verified with `npm run test`, `npm run build`, Safari/WebKit mobile emulation, screenshots, and runtime object-state probes showing touch controls inside the viewport and fallback VFX objects present on the compatibility path.

## Review

- Safari compatibility path now renders a materially fuller VFX station instead of only a few sparse fallback primitives.
- Touch controls no longer hang off-screen on iPhone-sized Safari emulation; the earlier repro had joystick zones extending past both screen edges, and the updated layout now keeps them fully inside the viewport.
- Additional viewport-sensitive UI pieces were moved toward `dvh`/`dvw` and safe-area-aware sizing so Safari responds more predictably to mobile screen dimensions.
- Remaining risk: real-device Safari can still differ from Playwright WebKit in subtle ways, so the next strongest confirmation is your manual Safari/iPhone check against this updated dev or deployed build.
