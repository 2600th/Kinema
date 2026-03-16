# UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a loading screen, death/respawn effect, redesigned HUD with collectible/health placeholders, audio feedback, menu restyling, and touch control restyling — all following the "Playful Glow" visual direction.

**Architecture:** Pure DOM + CSS animations for all visual UI. New components (LoadingScreen, DeathEffect) follow the existing FadeScreen pattern — class with DOM element, show/hide methods, wired via UIManager. Audio uses existing Tone.js SFXEngine. Touch controls get CSS + canvas color updates.

**Tech Stack:** TypeScript, DOM/CSS, Tone.js, Three.js (particles only), Rapier (no changes)

**Spec:** `docs/superpowers/specs/2026-03-16-ui-overhaul-design.md`

---

## Chunk 1: Foundation + Loading Screen

### Task 1: Add new events to EventMap

**Files:**
- Modify: `src/core/types.ts` (EventMap interface, around line 188)

- [ ] **Step 1: Add new event types to EventMap**

In `src/core/types.ts`, add these entries to the `EventMap` interface after the existing `'level:unloaded'` entry (~line 189):

```typescript
'loading:progress': { progress: number };
'collectible:changed': { count: number };
'health:changed': { current: number; max: number };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (new events are additive)

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(core): add loading:progress, collectible:changed, health:changed events to EventMap"
```

---

### Task 2: Update Google Fonts in index.html

**Files:**
- Modify: `index.html` (line 9)

- [ ] **Step 1: Update Outfit font weights**

In `index.html` line 9, change the Google Fonts URL from:
```
family=Outfit:wght@600;700
```
to:
```
family=Outfit:wght@400;600;700;800
```

- [ ] **Step 2: Verify page loads**

Run: `npx vite --open` and confirm fonts load in Network tab (no 400 errors on fonts.googleapis.com).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(ui): add Outfit 400 and 800 font weights"
```

---

### Task 3: Create LoadingScreen component

**Files:**
- Create: `src/ui/components/LoadingScreen.ts`

- [ ] **Step 1: Create LoadingScreen class**

Create `src/ui/components/LoadingScreen.ts`. Follow the FadeScreen pattern (class with container element, show/hide returning Promises). The class:

- Creates a `<div class="loading-screen">` with inline styles (no separate CSS file — keeps it self-contained like FadeScreen).
- Contains: 3 floating glow orbs, "KINEMA" title, progress bar track+fill, status text.
- `show()`: appends to `#ui-overlay`, triggers fade-in (200ms). Returns Promise.
- `hide()`: triggers scale-up + fade-out (400ms), removes element after animation. Returns Promise.
- `setProgress(value: number)`: updates bar fill width (0–1) and status text.
- `dispose()`: removes element if still in DOM.

```typescript
import type { Disposable } from '@core/types';

export class LoadingScreen implements Disposable {
  private container: HTMLDivElement;
  private barFill: HTMLDivElement;
  private statusText: HTMLDivElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'loading-screen';
    Object.assign(this.container.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1300',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      background: 'linear-gradient(135deg, #1a1040 0%, #2d1b69 50%, #1a1040 100%)',
      opacity: '0',
      transition: 'opacity 0.2s ease, transform 0.4s ease',
      transform: 'scale(1)',
      pointerEvents: 'all',
    });

    // Inject keyframes for orb animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes loadingOrbDrift1 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(30px, -20px) scale(1.1); }
        66% { transform: translate(-20px, 15px) scale(0.9); }
      }
      @keyframes loadingOrbDrift2 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(-25px, 25px) scale(1.15); }
        66% { transform: translate(20px, -10px) scale(0.85); }
      }
      @keyframes loadingOrbDrift3 {
        0%, 100% { transform: translate(0, 0) scale(1.05); }
        50% { transform: translate(15px, 20px) scale(0.95); }
      }
    `;
    this.container.appendChild(style);

    // Floating glow orbs
    const orbConfigs = [
      { color: '#7b2fff', size: 180, top: '15%', left: '20%', anim: 'loadingOrbDrift1 8s ease-in-out infinite' },
      { color: '#ff6b9d', size: 140, top: '60%', right: '15%', anim: 'loadingOrbDrift2 10s ease-in-out infinite' },
      { color: '#00d2ff', size: 100, top: '40%', left: '55%', anim: 'loadingOrbDrift3 12s ease-in-out infinite' },
    ];

    for (const cfg of orbConfigs) {
      const orb = document.createElement('div');
      Object.assign(orb.style, {
        position: 'absolute',
        width: `${cfg.size}px`,
        height: `${cfg.size}px`,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${cfg.color}33, transparent)`,
        filter: 'blur(40px)',
        top: cfg.top ?? '',
        left: cfg.left ?? '',
        right: cfg.right ?? '',
        animation: cfg.anim,
        pointerEvents: 'none',
      });
      this.container.appendChild(orb);
    }

    // Title
    const title = document.createElement('div');
    Object.assign(title.style, {
      fontFamily: "'Outfit', sans-serif",
      fontWeight: '800',
      fontSize: 'clamp(28px, 5vw, 42px)',
      color: '#ffffff',
      letterSpacing: '3px',
      textShadow: '0 4px 16px #7b2fff88, 0 0 40px #7b2fff33',
      zIndex: '1',
    });
    title.textContent = 'KINEMA';
    this.container.appendChild(title);

    // Progress bar
    const track = document.createElement('div');
    Object.assign(track.style, {
      width: 'clamp(140px, 20vw, 220px)',
      height: '8px',
      background: '#ffffff18',
      borderRadius: '8px',
      overflow: 'hidden',
      zIndex: '1',
    });

    this.barFill = document.createElement('div');
    Object.assign(this.barFill.style, {
      width: '0%',
      height: '100%',
      background: 'linear-gradient(90deg, #ff6b9d, #7b2fff, #00d2ff)',
      borderRadius: '8px',
      boxShadow: '0 0 14px #7b2fff88',
      transition: 'width 0.3s ease',
    });
    track.appendChild(this.barFill);
    this.container.appendChild(track);

    // Status text
    this.statusText = document.createElement('div');
    Object.assign(this.statusText.style, {
      fontFamily: "'Outfit', sans-serif",
      fontSize: '12px',
      color: '#ffffff66',
      letterSpacing: '1.5px',
      zIndex: '1',
    });
    this.statusText.textContent = 'Loading World...';
    this.container.appendChild(this.statusText);
  }

  show(): Promise<void> {
    const overlay = document.getElementById('ui-overlay');
    if (overlay) overlay.appendChild(this.container);
    // Force reflow then fade in
    void this.container.offsetHeight;
    this.container.style.opacity = '1';
    return new Promise(resolve => setTimeout(resolve, 200));
  }

  hide(): Promise<void> {
    this.container.style.opacity = '0';
    this.container.style.transform = 'scale(1.05)';
    return new Promise(resolve => {
      setTimeout(() => {
        this.container.remove();
        this.container.style.transform = 'scale(1)';
        resolve();
      }, 400);
    });
  }

  setProgress(value: number): void {
    const pct = Math.max(0, Math.min(1, value)) * 100;
    this.barFill.style.width = `${pct}%`;
    if (value < 0.3) this.statusText.textContent = 'Loading World...';
    else if (value < 0.7) this.statusText.textContent = 'Preparing Adventure...';
    else this.statusText.textContent = 'Almost Ready...';
  }

  dispose(): void {
    this.container.remove();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/LoadingScreen.ts
git commit -m "feat(ui): add LoadingScreen component with progress bar and glow orbs"
```

---

### Task 4: Wire LoadingScreen into UIManager

**Files:**
- Modify: `src/ui/UIManager.ts` (import + instantiation around line 37)

- [ ] **Step 1: Add LoadingScreen to UIManager**

In `src/ui/UIManager.ts`:

1. Add import at top:
```typescript
import { LoadingScreen } from './components/LoadingScreen';
```

2. Add property to the class (after existing hud/fadeScreen/debugPanel):
```typescript
readonly loadingScreen: LoadingScreen;
```

3. In constructor, after the DebugPanel instantiation (~line 39), add:
```typescript
this.loadingScreen = new LoadingScreen();
```

4. In the `dispose()` method, add:
```typescript
this.loadingScreen.dispose();
```

5. Subscribe to `loading:progress` in the constructor (after existing event bindings):
```typescript
this.eventBus.on('loading:progress', ({ progress }) => {
  this.loadingScreen.setProgress(progress);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/ui/UIManager.ts
git commit -m "feat(ui): wire LoadingScreen into UIManager with progress event"
```

---

### Task 5: Emit loading:progress from LevelManager and wire into main.ts

**Files:**
- Modify: `src/level/LevelManager.ts` (~line 182, load method)
- Modify: `src/main.ts` (~line 148, startGame closure)

- [ ] **Step 1: Add progress emission to LevelManager.load()**

In `src/level/LevelManager.ts`, inside the `load(name)` method (line 182), emit progress events at key stages. Before the `'level:loaded'` emit (~line 201), add progress emissions:

```typescript
// At start of load():
this.eventBus.emit('loading:progress', { progress: 0.1 });

// After buildProcedural() or GLTF load completes:
this.eventBus.emit('loading:progress', { progress: 0.5 });

// After addLighting():
this.eventBus.emit('loading:progress', { progress: 0.8 });

// Just before 'level:loaded':
this.eventBus.emit('loading:progress', { progress: 1.0 });
```

Also add similar progress emissions to `loadFromJSON()` (~line 227) and `loadStation()` (~line 206) at appropriate stages.

- [ ] **Step 2: Wire loading screen show/hide into main.ts startGame closure**

In `src/main.ts`, modify the `startGame` closure (~line 148). Access the loading screen from uiManager:

Before `levelManager.load('procedural')`:
```typescript
await uiManager.loadingScreen.show();
```

After `game.setupLevel()` completes:
```typescript
await uiManager.loadingScreen.hide();
```

Apply the same pattern to `startSavedLevel()` (~line 169) and `startStation()` (~line 233).

- [ ] **Step 3: Verify dev server runs and loading screen appears**

Run: `npx vite` and navigate to the app. Click Play — loading screen should appear with animated orbs and progress bar, then dismiss.

- [ ] **Step 4: Commit**

```bash
git add src/level/LevelManager.ts src/main.ts
git commit -m "feat(ui): wire loading screen into level loading flow with progress events"
```

---

## Chunk 2: Death/Respawn Effect

### Task 6: Create DeathEffect component

**Files:**
- Create: `src/ui/components/DeathEffect.ts`

- [ ] **Step 1: Create DeathEffect class**

Create `src/ui/components/DeathEffect.ts`. This is a fire-and-forget visual effect — no show/hide state, just a `trigger()` method.

```typescript
import type { Disposable } from '@core/types';

const PARTICLE_COLORS = ['#ff6b9d', '#7b2fff', '#00d2ff', '#FFD700'];
const PARTICLE_COUNT = 14;
const EFFECT_DURATION = 400;

export class DeathEffect implements Disposable {
  private overlay: HTMLDivElement;

  constructor() {
    this.overlay = document.getElementById('ui-overlay') as HTMLDivElement;
  }

  trigger(): void {
    this.flashScreen();
    this.burstParticles();
  }

  private flashScreen(): void {
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1100',
      background: '#ffffff',
      opacity: '0.6',
      pointerEvents: 'none',
      transition: 'opacity 100ms ease-out',
    });
    this.overlay.appendChild(flash);
    // Force reflow
    void flash.offsetHeight;
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 150);
  }

  private burstParticles(): void {
    // Inject keyframes if not already present
    if (!document.getElementById('death-particle-style')) {
      const style = document.createElement('style');
      style.id = 'death-particle-style';
      style.textContent = `
        @keyframes deathParticleBurst {
          0% {
            transform: translate(-50%, -50%) translate(0, 0) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) translate(var(--dx), var(--dy)) scale(0.3);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.5;
      const dist = 80 + Math.random() * 120;
      const size = 4 + Math.random() * 4;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;

      const particle = document.createElement('div');
      Object.assign(particle.style, {
        position: 'fixed',
        left: '50%',
        top: '50%',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        boxShadow: `0 0 6px ${PARTICLE_COLORS[i % PARTICLE_COLORS.length]}88`,
        zIndex: '1100',
        pointerEvents: 'none',
        animation: `deathParticleBurst ${EFFECT_DURATION}ms ease-out forwards`,
      });
      // CSS custom properties must use setProperty (Object.assign doesn't work for them)
      particle.style.setProperty('--dx', `${dx}px`);
      particle.style.setProperty('--dy', `${dy}px`);

      this.overlay.appendChild(particle);
      setTimeout(() => particle.remove(), EFFECT_DURATION);
    }
  }

  dispose(): void {
    // Clean up injected style
    document.getElementById('death-particle-style')?.remove();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/DeathEffect.ts
git commit -m "feat(ui): add DeathEffect component with flash and CSS particle burst"
```

---

### Task 7: Wire DeathEffect into UIManager + Camera snap + 3D particles

**Files:**
- Modify: `src/ui/UIManager.ts`
- Modify: `src/camera/OrbitFollowCamera.ts` (~line 83, constructor event bindings)
- Modify: `src/systems/ParticleSystem.ts` (~line 21, constructor event bindings)

- [ ] **Step 1: Wire DeathEffect in UIManager**

In `src/ui/UIManager.ts`:

1. Import:
```typescript
import { DeathEffect } from './components/DeathEffect';
```

2. Add property:
```typescript
private readonly deathEffect: DeathEffect;
```

3. In constructor:
```typescript
this.deathEffect = new DeathEffect();
```

4. In the existing `'player:respawned'` subscription (~line 90), add:
```typescript
this.deathEffect.trigger();
```

5. In `dispose()`:
```typescript
this.deathEffect.dispose();
```

- [ ] **Step 2: Add camera snap on respawn**

In `src/camera/OrbitFollowCamera.ts`, in the constructor (after the `'player:landed'` subscription ~line 83), add:

```typescript
this.eventBus.on('player:respawned', () => {
  this.snapToTarget();
});
```

- [ ] **Step 3: Add 3D death burst in ParticleSystem**

In `src/systems/ParticleSystem.ts`, in the constructor (after the landed subscription ~line 37), add:

The `player:respawned` event payload is `{ reason: string }` — it has no `position`. ParticleSystem already has a reference to the player's rigid body position. Use the player's current position (which is already the respawn point by the time this event fires):

```typescript
this.eventBus.on('player:respawned', () => {
  if (this.gameParticles) {
    // Player is already at respawn position when this fires
    const pos = this.player.translation();
    this.gameParticles.landingImpact({ x: pos.x, y: pos.y, z: pos.z }, 8);
  }
});
```

Note: `this.player` is the player's `RigidBody` reference that ParticleSystem already holds for footstep positioning. Verify the exact property name — it may be `this.playerBody` or accessed via `this.playerController.body`. Check the constructor to confirm.

- [ ] **Step 4: Test in dev server**

Run the game, fall off the world (Y < -25). Expect: white flash, CSS particle burst from center, 3D particle burst at character position, camera snaps to respawn point.

- [ ] **Step 5: Commit**

```bash
git add src/ui/UIManager.ts src/camera/OrbitFollowCamera.ts src/systems/ParticleSystem.ts
git commit -m "feat(ui): wire death effect, camera snap, and 3D particles on respawn"
```

---

## Chunk 3: HUD Redesign

### Task 8: Add collectible counter and health hearts to HUD

**Files:**
- Modify: `src/ui/components/HUD.ts`

- [ ] **Step 1: Add collectible counter element**

In `src/ui/components/HUD.ts`, add a new private method and element. After the existing crosshair creation (~line 123), add a collectible counter in the top-left:

```typescript
private collectibleEl!: HTMLDivElement;
private collectibleCount = 0;

private createCollectibleCounter(): void {
  this.collectibleEl = document.createElement('div');
  Object.assign(this.collectibleEl.style, {
    position: 'absolute',
    top: 'clamp(12px, 2vh, 20px)',
    left: 'clamp(12px, 2vw, 20px)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    opacity: '0',
    transition: 'opacity 0.3s ease',
    pointerEvents: 'none',
  });

  const icon = document.createElement('div');
  Object.assign(icon.style, {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #FFD700, #FFA500)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    boxShadow: '0 0 10px #FFD70044',
  });
  icon.textContent = '✦';

  const count = document.createElement('span');
  count.className = 'collectible-count';
  Object.assign(count.style, {
    fontFamily: "'Outfit', sans-serif",
    fontWeight: '700',
    fontSize: '18px',
    color: '#FFD700',
    textShadow: '0 0 8px #FFD70044',
    transition: 'transform 0.2s ease',
  });
  count.textContent = '0';

  this.collectibleEl.appendChild(icon);
  this.collectibleEl.appendChild(count);
  this.container.appendChild(this.collectibleEl);
}
```

Call `this.createCollectibleCounter()` in the constructor.

- [ ] **Step 2: Add health hearts element**

Add a health hearts display in the top-right:

```typescript
private healthEl!: HTMLDivElement;
private hearts: HTMLSpanElement[] = [];

private createHealthHearts(): void {
  this.healthEl = document.createElement('div');
  Object.assign(this.healthEl.style, {
    position: 'absolute',
    top: 'clamp(12px, 2vh, 20px)',
    right: 'clamp(12px, 2vw, 20px)',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    opacity: '0',
    transition: 'opacity 0.3s ease',
    pointerEvents: 'none',
  });

  for (let i = 0; i < 3; i++) {
    const heart = document.createElement('span');
    Object.assign(heart.style, {
      color: '#ff6b9d',
      fontSize: '22px',
      filter: 'drop-shadow(0 0 6px #ff6b9d88)',
      transition: 'transform 0.2s ease, opacity 0.2s ease',
    });
    heart.textContent = '❤';
    this.hearts.push(heart);
    this.healthEl.appendChild(heart);
  }

  this.container.appendChild(this.healthEl);
}
```

Call `this.createHealthHearts()` in the constructor.

- [ ] **Step 3: Add public methods and event subscriptions**

Add methods to update these elements. The HUD doesn't currently subscribe to events directly (UIManager does). Add these public methods:

```typescript
updateCollectibles(count: number): void {
  this.collectibleCount = count;
  const countEl = this.collectibleEl.querySelector('.collectible-count') as HTMLSpanElement;
  if (countEl) {
    countEl.textContent = String(count);
    countEl.style.transform = 'scale(1.3)';
    setTimeout(() => { countEl.style.transform = 'scale(1)'; }, 200);
  }
}

updateHealth(current: number, max: number): void {
  this.hearts.forEach((heart, i) => {
    const filled = i < current;
    heart.style.opacity = filled ? '1' : '0.2';
    heart.style.filter = filled ? 'drop-shadow(0 0 6px #ff6b9d88)' : 'none';
    if (filled) {
      heart.style.transform = 'scale(1.2)';
      setTimeout(() => { heart.style.transform = 'scale(1)'; }, 200);
    }
  });
}

showGameHUD(): void {
  this.collectibleEl.style.opacity = '1';
  this.healthEl.style.opacity = '1';
}

hideGameHUD(): void {
  this.collectibleEl.style.opacity = '0';
  this.healthEl.style.opacity = '0';
}
```

- [ ] **Step 4: Wire events in UIManager**

In `src/ui/UIManager.ts`, add event subscriptions:

```typescript
this.eventBus.on('collectible:changed', ({ count }) => {
  this.hud.updateCollectibles(count);
});

this.eventBus.on('health:changed', ({ current, max }) => {
  this.hud.updateHealth(current, max);
});

this.eventBus.on('level:loaded', () => {
  this.hud.showGameHUD();
});

this.eventBus.on('level:unloaded', () => {
  this.hud.hideGameHUD();
});
```

- [ ] **Step 5: Verify TypeScript compiles and test visually**

Run: `npx tsc --noEmit`
Then run dev server and verify HUD elements appear (initially hidden, shown on level load).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/HUD.ts src/ui/UIManager.ts
git commit -m "feat(ui): add collectible counter and health hearts to HUD with placeholder events"
```

---

### Task 9: Restyle existing HUD elements

**Files:**
- Modify: `src/ui/components/HUD.ts` (inline styles throughout)

- [ ] **Step 1: Update existing HUD element styles**

In `src/ui/components/HUD.ts`, update the inline styles of existing elements to use the Playful Glow palette:

**Prompt element** (~line 15): Change font to Outfit, border color to `#7b2fff`, background to `rgba(26, 16, 64, 0.85)`, text color stays white, add `boxShadow: '0 0 20px #7b2fff33'`.

**Hold progress bar** (~line 44): Change gradient to `linear-gradient(90deg, #ff6b9d, #7b2fff, #00d2ff)`, track background to `#ffffff18`.

**Objective element** (~line 72): Change left border to `#7b2fff`, background to `rgba(26, 16, 64, 0.85)`, font to Outfit, add purple glow shadow.

**Status element** (~line 98): Change left border to `#ff6b9d`, background to `rgba(26, 16, 64, 0.85)`, text color to `#ff6b9d`, font to Outfit.

**Crosshair** (~line 123): Change background to `#00d2ff`, add `boxShadow: '0 0 8px #00d2ff88'`.

- [ ] **Step 2: Verify visual appearance**

Run dev server, trigger interactions and objectives to see restyled elements.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/HUD.ts
git commit -m "feat(ui): restyle HUD elements with Playful Glow palette"
```

---

## Chunk 4: Menu Restyling

### Task 10: Update menu CSS

**Files:**
- Modify: `src/ui/menus/menus.css`

- [ ] **Step 1: Update CSS variables and core styles**

In `src/ui/menus/menus.css`, update the CSS variables at the top (~line 1-8):

Update the existing CSS variables (keep existing names `--font-body`, `--font-heading` — don't rename them):

```css
:root {
  --menu-bg: rgba(26, 16, 64, 0.92);
  --menu-accent: #7b2fff;
  --menu-accent-hover: #ff6b9d;
  --menu-text: #ffffff;
  --font-body: 'Outfit', system-ui, sans-serif;
  --font-heading: 'Outfit', system-ui, sans-serif;
}
```

Note: Both `--font-body` and `--font-heading` now use Outfit (previously `--font-body` was Inter). Keep using `var(--font-body)` and `var(--font-heading)` throughout — do NOT introduce new variable names like `--menu-font`.

Update `.menu-overlay` background to use the purple palette:
```css
background: radial-gradient(ellipse at center, rgba(45, 27, 105, 0.85), rgba(26, 16, 64, 0.95));
```

Update `.menu-button` styles:
```css
.menu-button {
  background: linear-gradient(135deg, rgba(123, 47, 255, 0.3), rgba(255, 107, 157, 0.15));
  border: 1px solid #7b2fff44;
  font-family: var(--font-body);
  /* ... keep existing layout properties ... */
}

.menu-button:hover {
  background: linear-gradient(135deg, rgba(123, 47, 255, 0.5), rgba(255, 107, 157, 0.3));
  border-color: #7b2fff88;
  box-shadow: 0 0 20px #7b2fff33;
  transform: translateY(-2px);
}
```

Update `.menu-screen` background:
```css
background: var(--menu-bg);
border: 1px solid #7b2fff22;
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 60px #7b2fff11;
```

Update any hardcoded `font-family: 'Inter'` references to `var(--font-body)`. References already using `var(--font-body)` or `var(--font-heading)` are fine — the variable values themselves now point to Outfit.

Update accent colors: replace `#00d2ff` with `var(--menu-accent)` for borders, highlights, and active states. Replace hover accent with `var(--menu-accent-hover)`.

Update range input thumb and checkbox accent to use `#7b2fff`.

- [ ] **Step 2: Verify menus visually**

Run dev server, open main menu, pause menu, settings, level select, help. Verify consistent purple/pink theme, readable text, working hover states.

- [ ] **Step 3: Commit**

```bash
git add src/ui/menus/menus.css
git commit -m "feat(ui): restyle menus with Playful Glow palette"
```

---

## Chunk 5: Audio Feedback

### Task 11: Add new SFX methods to SFXEngine

**Files:**
- Modify: `src/audio/SFXEngine.ts`

- [ ] **Step 1: Add loading and death sound methods**

In `src/audio/SFXEngine.ts`, add these methods after the existing SFX methods:

```typescript
/** Short percussive death burst */
deathPop(): void {
  if (Tone.getContext().state !== 'running') return;
  const now = Tone.now();
  this.noiseSynth.triggerAttackRelease('16n', now);
  this.toneSynth.triggerAttackRelease('C3', '16n', now);
  this.toneSynth.frequency.setValueAtTime(400, now);
  this.toneSynth.frequency.exponentialRampToValueAtTime(80, now + 0.08);
}

/** Quick ascending respawn chime */
respawnChime(): void {
  if (Tone.getContext().state !== 'running') return;
  const now = Tone.now();
  this.sparkleSynth.triggerAttackRelease('C5', '32n', now);
  this.sparkleSynth.triggerAttackRelease('E5', '32n', now + 0.06);
}

/** Subtle sparkle tick for loading progress */
loadingTick(progress: number): void {
  if (Tone.getContext().state !== 'running') return;
  // Higher pitch as progress increases
  const freq = 800 + progress * 600;
  const now = Tone.now();
  this.sparkleSynth.triggerAttackRelease(freq, '64n', now, 0.15);
}

private loadingOsc: Tone.Oscillator | null = null;

/** Start/stop ambient loading hum */
loadingAmbientStart(): void {
  if (Tone.getContext().state !== 'running' || this.loadingOsc) return;
  this.loadingOsc = new Tone.Oscillator({ frequency: 80, type: 'sine' });
  const lfo = new Tone.LFO({ frequency: 0.3, min: 60, max: 100 });
  lfo.connect(this.loadingOsc.frequency);
  lfo.start();
  this.loadingOsc.connect(this.effectsBus);
  this.loadingOsc.volume.value = -30;
  this.loadingOsc.start();
  this.loadingOsc.volume.rampTo(-20, 1);
}

loadingAmbientStop(): void {
  if (!this.loadingOsc) return;
  this.loadingOsc.volume.rampTo(-60, 0.3);
  const osc = this.loadingOsc;
  this.loadingOsc = null;
  setTimeout(() => { osc.stop(); osc.dispose(); }, 400);
}

/** Quick noise sweep for loading exit */
loadingWhoosh(): void {
  if (Tone.getContext().state !== 'running') return;
  const now = Tone.now();
  this.noiseSynth.triggerAttackRelease('8n', now);
}
```

Note: SFXEngine has no `ready` property — use `Tone.getContext().state !== 'running'` as the guard (matching the existing UI SFX methods pattern). Adapt synth references to match the actual private property names. The `this.effectsBus` reference exists as a private property. `Tone.Oscillator` and `Tone.LFO` are available via the existing `import * as Tone from 'tone'`. Declare `loadingOsc` with the other private properties at the top of the class, not between methods.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/audio/SFXEngine.ts
git commit -m "feat(audio): add death pop, respawn chime, loading ambient/tick/whoosh SFX"
```

---

### Task 12: Wire audio events in AudioManager

**Files:**
- Modify: `src/audio/AudioManager.ts` (~line 172, bindEvents method)

- [ ] **Step 1: Add loading and death audio subscriptions**

In `src/audio/AudioManager.ts`, in the `bindEvents()` method:

1. Replace or extend the existing `'player:respawned'` handler to add death pop before respawn chime:
```typescript
this.eventBus.on('player:respawned', () => {
  this.sfxEngine.deathPop();
  // Brief delay before chime so sounds don't overlap
  setTimeout(() => this.sfxEngine.respawnChime(), 100);
});
```

2. Add loading screen audio subscriptions:
```typescript
let lastTickThreshold = 0;

this.eventBus.on('loading:progress', ({ progress }) => {
  // Start ambient on first progress event
  if (progress <= 0.15) {
    this.sfxEngine.loadingAmbientStart();
    lastTickThreshold = 0;
  }
  // Tick every ~10%
  const threshold = Math.floor(progress * 10);
  if (threshold > lastTickThreshold) {
    lastTickThreshold = threshold;
    this.sfxEngine.loadingTick(progress);
  }
});

this.eventBus.on('level:loaded', () => {
  this.sfxEngine.loadingAmbientStop();
  this.sfxEngine.loadingWhoosh();
});
```

- [ ] **Step 2: Test audio in dev server**

Run the game. Verify: loading screen plays ambient hum + sparkle ticks. Level load triggers whoosh. Falling off the world plays death pop + respawn chime.

- [ ] **Step 3: Commit**

```bash
git add src/audio/AudioManager.ts
git commit -m "feat(audio): wire loading and death audio events in AudioManager"
```

---

## Chunk 6: Touch Control Restyling

### Task 13: Restyle touch control CSS

**Files:**
- Modify: `src/input/touch-controls.css`

- [ ] **Step 1: Update button base and variant styles**

In `src/input/touch-controls.css`, update the `.touch-btn` base style (~line 54):

```css
.touch-btn {
  /* Keep existing layout: border-radius, display, etc. */
  background: rgba(26, 16, 64, 0.5);
  border: 2px solid rgba(123, 47, 255, 0.27);
  color: #ffffff;
  font-family: 'Outfit', sans-serif;
  /* keep existing size, position, transition properties */
}
```

Update variants:
```css
.touch-btn--jump {
  background: rgba(123, 47, 255, 0.35);
  border-color: rgba(255, 107, 157, 0.5);
  box-shadow: 0 0 10px rgba(255, 107, 157, 0.15);
  /* keep size: 64px */
}

.touch-btn--interact {
  border-color: rgba(0, 210, 255, 0.27);
  box-shadow: 0 0 8px rgba(0, 210, 255, 0.1);
}

.touch-btn--crouch {
  border-color: rgba(255, 215, 0, 0.27);
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.1);
}

.touch-btn--sprint {
  border-color: rgba(255, 107, 157, 0.27);
  box-shadow: 0 0 8px rgba(255, 107, 157, 0.1);
}
```

Update active state:
```css
.touch-btn--active {
  transform: scale(0.92);
  opacity: 0.85;
  border-color: rgba(123, 47, 255, 0.8);
  box-shadow: 0 0 12px rgba(123, 47, 255, 0.27);
  background: rgba(123, 47, 255, 0.4);
}
```

- [ ] **Step 2: Verify on mobile or responsive mode**

Open dev tools, toggle device toolbar, verify buttons render with new colors. Touch states should glow purple.

- [ ] **Step 3: Commit**

```bash
git add src/input/touch-controls.css
git commit -m "feat(ui): restyle touch buttons with Playful Glow palette"
```

---

### Task 14: Update VirtualJoystick canvas colors

**Files:**
- Modify: `src/input/VirtualJoystick.ts` (~line 207, draw method)

- [ ] **Step 1: Update draw() method colors and add gradient thumb**

In `src/input/VirtualJoystick.ts`, modify the `draw()` method (~line 207):

1. Update the outer ring stroke color (~line 216):
```typescript
ctx.strokeStyle = this.active ? 'rgba(123, 47, 255, 0.5)' : 'rgba(123, 47, 255, 0.27)';
```

2. Add active glow before the outer ring arc draw:
```typescript
if (this.active) {
  ctx.shadowBlur = 12;
  ctx.shadowColor = 'rgba(123, 47, 255, 0.53)';
}
```

3. Reset shadow after outer ring:
```typescript
ctx.shadowBlur = 0;
ctx.shadowColor = 'transparent';
```

4. Update base fill color (~line 222):
```typescript
ctx.fillStyle = 'rgba(26, 16, 64, 0.53)';
```

5. Replace thumb flat fill (~line 228) with radial gradient:
```typescript
const grad = ctx.createRadialGradient(thumbX, thumbY, 0, thumbX, thumbY, thumbR);
grad.addColorStop(0, '#ff6b9d');
grad.addColorStop(1, '#7b2fff');
ctx.fillStyle = grad;
```

Where `thumbX`, `thumbY`, `thumbR` are the thumb center coordinates and radius already computed in the draw method.

Also update the constructor default colors for `baseColor` and `thumbColor` options to match the new palette as fallbacks.

- [ ] **Step 2: Verify on mobile or responsive mode**

Open dev tools device toolbar, verify joystick renders with purple ring, deep purple fill, and pink-to-purple gradient thumb. Active state should show glow.

- [ ] **Step 3: Commit**

```bash
git add src/input/VirtualJoystick.ts
git commit -m "feat(ui): restyle virtual joystick with Playful Glow palette and gradient thumb"
```

---

## Chunk 7: Final Verification

### Task 15: End-to-end verification

- [ ] **Step 1: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run Vite build**

Run: `npx vite build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Manual testing checklist**

Run: `npx vite` and test each feature:

1. **Loading screen**: Click Play → loading screen appears with purple gradient, floating orbs, progress bar fills, "KINEMA" title glows, dismisses with scale-up animation.
2. **Death effect**: Fall off world → white flash, colored particles burst from center, 3D particles at character, camera snaps to respawn. Total time ~400ms, immediate control.
3. **HUD**: Collectible counter (top-left) and health hearts (top-right) visible during gameplay. Styled with gold/pink colors.
4. **Menus**: Main menu, pause menu, settings all show purple/pink theme. Buttons glow on hover.
5. **Audio**: Loading hum + ticks during load. Whoosh on level enter. Death pop + respawn chime on death.
6. **Touch controls**: (Test in device toolbar) Buttons show purple theme. Joystick has gradient thumb. Active states glow.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "fix(ui): post-integration cleanup"
```
