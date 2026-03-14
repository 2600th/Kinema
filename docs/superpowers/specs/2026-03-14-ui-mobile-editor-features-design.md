# UI, Mobile Controls, Editor & Help Features

**Date:** 2026-03-14
**Status:** Design

## Overview

Five features to improve usability across desktop and mobile:
1. Responsive settings UI (graphics overflows on small screens)
2. Debug panel toggle from settings UI
3. Help/keybindings reference screen
4. Editor play-test mode (Start/Stop like Unity/Unreal)
5. Full mobile touch controls with virtual joysticks

---

## 1. Responsive Settings UI

**Problem:** The Graphics tab has 20+ controls that overflow the viewport on small screens and tablets. No scrolling container exists.

**Design:**
- Add `max-height: 60vh; overflow-y: auto` to the settings tab content container
- Add smooth momentum scrolling (`-webkit-overflow-scrolling: touch`)
- Increase touch targets to 44px minimum on mobile breakpoints
- Add scroll fade indicator (gradient at bottom when content overflows)

**Files:** `src/ui/menus/menus.css`, `src/ui/menus/SettingsMenu.ts`

---

## 2. Debug Panel Toggle from Settings UI

**Problem:** Debug panel is only accessible via backtick key, which is non-discoverable.

**Design:**
- Add a "Show Debug Panel" toggle to the Graphics tab in Settings (under Quality section)
- When toggled, emit `debug:toggle` event (same as backtick key)
- Persist the preference in UserSettings
- Sync state when debug panel is toggled via backtick

**Files:** `src/ui/menus/SettingsMenu.ts`, `src/core/UserSettings.ts`

---

## 3. Help / Keybindings Screen

**Problem:** No in-game reference for controls and features.

**Design:**
- New `HelpMenu.ts` screen accessible from Main Menu and Pause Menu
- Three sections displayed as a scrollable card layout:
  - **Movement:** WASD/arrows, Space (jump/double jump), C (crouch), Shift (sprint)
  - **Interaction:** F (interact/grab), E/Q (altitude), LMB (throw/primary)
  - **Camera & UI:** Mouse look, Scroll (zoom), Backtick (debug), Escape (pause), F1 (editor)
- Gamepad bindings shown side-by-side when a gamepad is detected
- Mobile touch controls section shown when on touch device
- Uses the same glassmorphic card style as existing menus
- Back button returns to previous menu

**Files:** New `src/ui/menus/HelpMenu.ts`, modify `MainMenu.ts`, `PauseMenu.ts`, `MenuManager.ts`

---

## 4. Editor Play-Test Mode (Start/Stop)

**Problem:** No way to test a level while editing without fully exiting the editor.

**Design:**
- Add "Play" button to editor toolbar (green triangle icon, like Unity)
- When clicked:
  1. Serialize current editor state to a temporary snapshot (in-memory, not localStorage)
  2. Exit editor mode, spawn player at SpawnBrush position (or default)
  3. Start game simulation (physics + player controller active)
  4. Show a floating "Stop" button (red square) in top-center of screen
- When "Stop" clicked:
  1. Stop game simulation
  2. Restore editor state from the temporary snapshot
  3. Re-enter editor mode with camera at the same position
- Keyboard shortcut: Ctrl+P to toggle play/stop
- Editor state snapshot includes: all EditorObject positions/rotations, camera position, selection

**Files:** `src/editor/EditorManager.ts`, `src/editor/panels/ToolbarPanel.ts`, `src/editor/LevelSerializer.ts`

---

## 5. Mobile Touch Controls

**Problem:** No touch input support. Game is completely unusable on mobile/tablet.

**Architecture:** Extendable `TouchControlsManager` with pluggable virtual control widgets.

### Component Design:

```
TouchControlsManager (orchestrator)
  ├── VirtualJoystick (left side — movement)
  ├── VirtualJoystick (right side — camera look)
  ├── TouchButton (jump — right side, large)
  ├── TouchButton (interact — right side, smaller)
  ├── TouchButton (crouch — right side, smaller)
  ├── TouchButton (sprint — left side, near joystick)
  └── TouchButton (pause — top right)
```

### VirtualJoystick
- Canvas-rendered circle with inner thumb
- Touch-based drag produces normalized (-1..1) x/y values
- Configurable: size, position, deadzone, opacity
- Follows initial touch position (dynamic origin) or fixed position
- Visual: semi-transparent with subtle glow on active

### TouchButton
- DOM-based (for accessibility and easy styling)
- Configurable: icon, size, position, shape (circle/rounded-rect)
- States: idle, pressed, disabled
- Supports hold detection (for sprint, crouch)

### Integration with InputManager
- `TouchControlsManager` implements a `TouchInputProvider` interface
- `InputManager.poll()` merges touch state with keyboard/gamepad:
  ```
  const touch = this.touchProvider?.getState() ?? nullTouch;
  const jump = (this.locked && this.keys.has('Space')) || gamepad.jump || touch.jump;
  ```
- Touch provider is registered on mobile detection (`'ontouchstart' in window`)
- Touch look deltas feed into `pollLook()` alongside mouse/gamepad

### Auto-detection
- Show touch controls when `'ontouchstart' in window && !matchMedia('(pointer: fine)').matches`
- Hide when a physical keyboard/mouse is detected (pointer lock requested)
- User can force-toggle via Settings > Controls > "Touch Controls"

### Layout (portrait + landscape)
- **Landscape (primary):** Left joystick bottom-left, right joystick bottom-right, action buttons stacked on right edge
- **Portrait:** Same layout but joysticks smaller, buttons repositioned
- All positions use viewport-relative units (vw/vh) for scaling

**Files:**
- New `src/input/TouchControlsManager.ts` (orchestrator)
- New `src/input/VirtualJoystick.ts` (canvas-rendered joystick)
- New `src/input/TouchButton.ts` (DOM button widget)
- Modify `src/input/InputManager.ts` (merge touch state)
- New `src/input/touch-controls.css` (responsive layout)
- Modify `src/ui/menus/SettingsMenu.ts` (touch controls toggle)

---

## Implementation Order

1. **Responsive settings** (smallest, unblocks testing on mobile)
2. **Debug toggle in settings** (tiny, 10 min)
3. **Help screen** (self-contained new menu)
4. **Editor play-test** (self-contained editor feature)
5. **Mobile touch controls** (largest, depends on responsive settings)

## Non-Goals

- Full mobile editor support (touch-based object placement) — future work
- Mobile-specific graphics auto-detection — use existing profiles
- Haptic feedback — future enhancement
