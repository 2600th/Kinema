# UI Overhaul: Loading Screen, Death Effect, HUD Redesign

**Date:** 2026-03-16
**Status:** Approved
**Approach:** Pure DOM + CSS Animations (Approach 1)
**Visual Direction:** B1 — Playful Glow (deep purple, pink/purple/cyan accents, Outfit font, glow effects)

## Decisions

| Feature | Decision |
|---|---|
| Death/respawn style | Astro Bot — near-instant (~400ms), punchy particles + flash, no menu |
| Loading screen style | Stylish motion graphics — geometric shapes, particles, progress bar |
| Visual direction | Playful Glow — deep purple bg, pink→purple→cyan gradients, Outfit font, floating glow orbs |
| Collectibles UI | Placeholder design with events, no backend system yet |
| Architecture | Pure DOM + CSS animations, consistent with existing UI layer |

## Color Palette

| Role | Value | Usage |
|---|---|---|
| Primary background | `#1a1040` | Loading screen, menu backgrounds |
| Secondary background | `#2d1b69` | Gradient endpoints |
| Pink accent | `#ff6b9d` | Health hearts, gradient start |
| Purple accent | `#7b2fff` | Gradient mid, glow effects |
| Cyan accent | `#00d2ff` | Gradient end, existing accent override |
| Gold | `#FFD700` | Collectible counter |
| Text primary | `#ffffff` | Headings, values |
| Text secondary | `#ffffff66` | Labels, status text |

## Typography

- **Font family:** Outfit (replacing Inter for all game UI)
- **Weights:** 400 body, 600 labels, 700 headings, 800 title/logo
- **Requires update** to Google Fonts link in `index.html` — currently loads 600;700, must add 400 and 800

---

## Feature 1: Loading Screen

### Component

`LoadingScreen` — new class in `src/ui/components/`

### Visual Design

- Full-screen overlay with deep purple gradient background (`#1a1040` → `#2d1b69`)
- 3-4 floating glow orbs (soft radial gradients) drifting slowly via CSS `@keyframes`
- Center: "KINEMA" title in Outfit 800, white with purple `text-shadow` glow
- Below title: horizontal progress bar (`clamp(140px, 20vw, 220px)` wide, 8px tall, rounded) with `#ff6b9d` → `#7b2fff` → `#00d2ff` gradient fill
- Progress bar width animated via inline style, tied to actual asset load progress (0–1)
- Below bar: status text ("Loading World...", "Preparing Adventure...") in Outfit 12px, `#ffffff66`
- Entry: fade-in over 200ms
- Exit: scale-up + fade-out over 400ms

### Integration

- The `startGame` closure in `main.ts` calls `loadingScreen.show()` before `LevelManager.load()`
- `LevelManager` emits new `loading:progress` events with `{ progress: number }` (0–1 float) wrapping AssetLoader calls (AssetLoader has no EventBus access)
- On `level:loaded`, call `loadingScreen.hide()` which triggers exit animation, then removes from DOM
- New event `loading:progress` added to `EventMap` in `types.ts`

### DOM Structure

```html
<div class="loading-screen">
  <div class="loading-orb loading-orb-1"></div>
  <div class="loading-orb loading-orb-2"></div>
  <div class="loading-orb loading-orb-3"></div>
  <div class="loading-title">KINEMA</div>
  <div class="loading-bar-track">
    <div class="loading-bar-fill"></div>
  </div>
  <div class="loading-status">Loading World...</div>
</div>
```

---

## Feature 2: Death/Respawn Effect

### Component

`DeathEffect` — new class in `src/ui/components/`

### Visual Sequence (~400ms total)

1. **Flash** (0–100ms): Full-screen white overlay snaps to 60% opacity, then fades to 0. CSS transition.
2. **CSS Particle burst** (0–400ms): 12–16 small circles (mix of pink, purple, cyan, gold) explode outward from screen center via CSS `@keyframes`. Each particle gets random angle, distance (80–200px), and slight size variance (4–8px). Fade out as they travel.
3. **3D Particle burst** (simultaneous): `ParticleSystem` listens to `player:respawned` directly and calls its internal `GameParticles.landingImpact` at the character's last world position with colors tweaked to match palette. This avoids DeathEffect needing a reference to GameParticles.

### Behavior

- No screen wipe, no fade-to-black, no menu
- Effect plays over live gameplay — purely cosmetic
- Player regains control immediately on respawn
- Brief camera snap: disable interpolation for 1 frame to avoid lerp from death position to respawn position

### Integration

- Listen to `player:respawned` on EventBus
- On event: create flash overlay + spawn CSS particle elements + trigger 3D particle burst
- CSS particles are appended to `#ui-overlay`, removed after animation completes (400ms)
- Camera snap: `OrbitFollowCamera` listens to `player:respawned` and calls its existing `snapToTarget()` method to instantly reposition without lerp

---

## Feature 3: HUD & UI Overhaul

### HUD Redesign (`src/ui/components/HUD.ts`)

**New elements:**
- **Top-left — Collectible counter:** Gold circle icon (gradient `#FFD700` → `#FFA500`) + count in Outfit 700. Scale-bounce animation on value change. Listens to `collectible:changed` event.
- **Top-right — Health hearts:** 3 pink heart icons (`#ff6b9d`), filled/empty states with glow `drop-shadow`. Listens to `health:changed` event. Scale-bounce on change.

**Existing elements restyled:**
- Interaction prompts: new palette, rounded corners, glow accents, Outfit font
- Objectives: same position (top area), restyled with new colors
- Status messages: new font and colors

### Menu Restyling (`src/ui/menus/menus.css`)

CSS-only changes — no structural/logic modifications:
- `--menu-accent`: `#00d2ff` → pink-purple gradient
- `--menu-bg`: updated to deep purple tones
- Button backgrounds: gradient with glow on hover
- Consistent Outfit font throughout

### New Placeholder Events

Added to `EventMap` in `src/core/types.ts`:

```typescript
'collectible:changed': { count: number };
'health:changed': { current: number; max: number };
```

These events are listened to by the HUD but not emitted by any system yet — ready for future gameplay wiring.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/ui/components/LoadingScreen.ts` | Loading screen overlay with progress |
| `src/ui/components/DeathEffect.ts` | Death flash + CSS particle burst |

## Files to Modify

| File | Changes |
|---|---|
| `src/core/types.ts` | Add `loading:progress`, `collectible:changed`, `health:changed` to EventMap |
| `src/ui/components/HUD.ts` | Add collectible counter, health hearts, restyle existing elements |
| `src/ui/UIManager.ts` | Wire LoadingScreen and DeathEffect into the UI system |
| `src/ui/menus/menus.css` | Update palette, fonts, button styles |
| `src/main.ts` | Call loadingScreen.show/hide in the `startGame` closure |
| `src/level/LevelManager.ts` | Emit `loading:progress` events wrapping AssetLoader calls |
| `src/camera/OrbitFollowCamera.ts` | Listen to `player:respawned` and call `snapToTarget()` |
| `src/systems/ParticleSystem.ts` | Listen to `player:respawned` and emit death burst via GameParticles |
| `index.html` | Add Outfit weights 400 and 800 to Google Fonts link |

### Z-Index Layering

| Element | Z-Index |
|---|---|
| Game canvas | 0 |
| `#ui-overlay` (HUD) | 10 |
| Menu overlay | 1200 |
| Loading screen | 1300 |
| Death flash | 1100 |

---

## Feature 4: Sound Effects / Audio Feedback

The project already has a comprehensive Tone.js procedural audio system (`src/audio/`). `AudioManager` listens to EventBus events and delegates to `SFXEngine` (procedural synths) and `MusicEngine` (generative ambient). The system already handles: jump, airJump, land, footsteps, grab, throw, interact, checkpoint, objectiveComplete, respawn, menuOpen/Close, uiClick/uiHover.

### New Audio for Loading Screen

- **Ambient hum**: Low-frequency pad (sine, ~80Hz) with slow LFO modulation. Fades in with loading screen, fades out on exit.
- **Progress tick**: Subtle sparkle tone on each ~10% progress increment. Reuse `SFXEngine.sparkleSynth` with pitch scaling (higher pitch as progress increases).
- **Exit whoosh**: Quick noise sweep (high→low, 200ms) when loading screen dismisses. Signals transition to gameplay.

### New Audio for Death/Respawn

- **Death pop**: Short percussive burst — white noise (50ms) + sine drop (400→80Hz, 80ms). Punchy, not dramatic.
- **Respawn chime**: Quick ascending two-note tone (C5→E5, 60ms each) to signal "you're back." Bright and brief.

### Integration

- `AudioManager` already listens to `player:respawned` — extend the existing `respawn` SFX or replace with the new chime.
- Add new methods to `SFXEngine`: `deathPop()`, `respawnChime()`, `loadingTick()`, `loadingAmbient(start/stop)`, `loadingWhoosh()`
- `AudioManager` subscribes to `loading:progress` for tick/ambient, triggers whoosh on `level:loaded`

---

## Feature 5: Touch Control Restyling

Current touch controls use plain white-bordered circles with functional colors (green jump, blue interact, orange crouch, purple sprint). They need to match the new Playful Glow visual direction.

### Visual Changes

**Joysticks** (`VirtualJoystick.ts` — changes to `draw()` method):
- Outer ring: change `this.baseColor` to `#7b2fff44` (purple, semi-transparent) instead of current white
- Inner fill: change hardcoded `'rgba(0, 0, 0, 0.2)'` literal (line 222) to `'rgba(26, 16, 64, 0.53)'` (deep purple)
- Thumb: replace flat `ctx.fillStyle = this.thumbColor` with `ctx.createRadialGradient()` from `#ff6b9d` (center) → `#7b2fff` (edge). This is a rendering logic change, not just a color swap.
- Active glow: when joystick is active, set `ctx.shadowBlur = 12` and `ctx.shadowColor = '#7b2fff88'` before drawing the outer ring arc, then reset shadow after

**Action buttons** (`touch-controls.css`):
- Base: `background: rgba(26, 16, 64, 0.5)` (deep purple), `border: 2px solid #7b2fff44`
- Jump: gradient border glow `#ff6b9d` → `#7b2fff`, keep larger size (64px)
- Interact: cyan glow border `#00d2ff44`
- Crouch: gold glow border `#FFD70044`
- Sprint: pink glow border `#ff6b9d44`
- Active state: brighter border (full opacity), subtle scale pulse, `box-shadow: 0 0 12px <color>44`
- Font/icons: Outfit font where text labels are used

**Container**: No layout changes — positions, responsive breakpoints, and z-index remain the same.

### Files to Modify

| File | Changes |
|---|---|
| `src/input/touch-controls.css` | Restyle all button variants, backgrounds, borders, active states |
| `src/input/VirtualJoystick.ts` | Update canvas colors for rings, fill, and thumb |

---

## Files to Create (Updated)

| File | Purpose |
|---|---|
| `src/ui/components/LoadingScreen.ts` | Loading screen overlay with progress |
| `src/ui/components/DeathEffect.ts` | Death flash + CSS particle burst |

## Files to Modify (Updated)

| File | Changes |
|---|---|
| `src/core/types.ts` | Add `loading:progress`, `collectible:changed`, `health:changed` to EventMap |
| `src/ui/components/HUD.ts` | Add collectible counter, health hearts, restyle existing elements |
| `src/ui/UIManager.ts` | Wire LoadingScreen and DeathEffect into the UI system |
| `src/ui/menus/menus.css` | Update palette, fonts, button styles |
| `src/main.ts` | Call loadingScreen.show/hide in the `startGame` closure |
| `src/level/LevelManager.ts` | Emit `loading:progress` events wrapping AssetLoader calls |
| `src/camera/OrbitFollowCamera.ts` | Listen to `player:respawned` and call `snapToTarget()` |
| `src/systems/ParticleSystem.ts` | Listen to `player:respawned` and emit death burst via GameParticles |
| `src/audio/SFXEngine.ts` | Add `deathPop()`, `respawnChime()`, `loadingTick()`, `loadingAmbient()`, `loadingWhoosh()` |
| `src/audio/AudioManager.ts` | Subscribe to `loading:progress` and `level:loaded` for new audio cues, update respawn SFX |
| `src/input/touch-controls.css` | Restyle buttons to match Playful Glow palette |
| `src/input/VirtualJoystick.ts` | Update canvas colors for joystick rendering |
| `index.html` | Add Outfit weights 400 and 800 to Google Fonts link |

### Z-Index Layering

| Element | Z-Index |
|---|---|
| Game canvas | 0 |
| `#ui-overlay` (HUD) | 10 |
| Touch controls | 1000 |
| Death flash | 1100 |
| Menu overlay | 1200 |
| Loading screen | 1300 |

## Out of Scope

- Collectible gameplay system (pickup logic, scoring)
- Health/damage gameplay system
- Post-processing effects
