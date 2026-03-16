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

## Out of Scope

- Collectible gameplay system (pickup logic, scoring)
- Health/damage gameplay system
- Sound effects / audio feedback
- Touch control restyling (separate effort)
- Post-processing effects
