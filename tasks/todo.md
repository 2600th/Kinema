# Kinema Issues Fix - Session Todo

## Session 1 - Completed
- [x] **Issue 5: F5 Camera Return** - Fixed eventBus not being stored in OrbitFollowCamera constructor.
- [x] **Issue 2: Car Controller** - Fixed 3 bugs: ground detection threshold, oversized collider, floating wheels. Added COLLISION_GROUP_WORLD.
- [x] **Issue 3: Player Spawn** - Moved from z=344 to z=190. Updated flythrough start Z.
- [x] **Issue 4: Entrance Pillars** - Moved to z=185, larger pillars, emissive accents, brighter spotlight.
- [x] **Issue 1: Level Visuals** - Dark grid, enhanced emissives, dual wall strips, brighter ceiling, more dust motes.
- [x] **Issue 6: Other Gaps** - Flythrough double-start guard. Cleaned all section labels.

## Session 2 - Completed
- [x] **Car Auto-Movement** - exit() now clears input/speed/velocity. Fixed wheel steering visual (negated steerAngle).
- [x] **Playwright Tests** - Created visual-check.ts with 2 passing tests (main menu + settings tabs).
- [x] **Ambient Music** - Downloaded CC-BY "Alien Atmosphere" to public/assets/audio/ambient.mp3.

## Session 3 - Completed
- [x] **Staircase/Slope Overlap** - Moved roughPlane from x=12 to x=20, reduced size 14x14 to 10x10 to clear staircase.
- [x] **Level Visual Upgrades** - Added: bulkhead frames (every 60 units), bay pedestal edge glow strips, hero spotlights per bay, wall recessed panels between bays, reflective floor patches for SSR, low-lying fog sprites (25 ground-hugging atmospheric sprites).
- [x] **SSR + VFX Fix** - Changed smoke from NormalBlending to AdditiveBlending (prevents metalrough MRT contamination). Reduced smoke opacity 0.55->0.35. Improved bay material: roughness 0.25->0.12, metalness 0.75->0.85 for sharper SSR reflections.
- [x] **Back Wall Partition** - Added solid wall at z=200 (10 units behind spawn) with emissive accent strip. Blocks 150-unit empty void behind player.
- [x] **Key Rebinding** - Changed all interactions from E to F. Added altitudeUp/altitudeDown to InputState. E/Q now control drone altitude (Space/C still work as fallback). Updated all UI text, labels, and tests.
- [x] **Label Improvements** - Updated: Grab (F key), Throw (F key), Door (F key), Vehicles (F key + E/Q altitude hint), Movement (W/S climb, C crouch, Space rope), Double Jump (Space hint).

## Review
- TypeScript compilation: PASS (zero errors)
- Vite production build: PASS (2.27s)
- Playwright tests: PASS (2/2)
- Files modified: 6
  - `src/core/types.ts` - Added altitudeUp/altitudeDown to InputState
  - `src/input/InputManager.ts` - E->F interact, E/Q altitude, updated preventDefault
  - `src/interaction/InteractionManager.ts` - "Press F to" / "Hold F to"
  - `src/interaction/InteractionManager.test.ts` - Updated expected strings
  - `src/vehicle/DroneController.ts` - altitudeUp/altitudeDown for hover
  - `src/level/LevelManager.ts` - Overlap fix, visual upgrades, SSR fix, back wall, labels
