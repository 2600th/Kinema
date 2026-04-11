import './hud.css';
import type { Disposable } from '@core/types';

/**
 * HUD component — shows interaction prompts.
 */
export class HUD implements Disposable {
  private container: HTMLElement;
  private prompt: HTMLDivElement;
  private holdWrap: HTMLDivElement;
  private holdFill: HTMLDivElement;
  private objectiveRegion: HTMLDivElement;
  private objective: HTMLDivElement;
  private objectiveText: HTMLDivElement;
  private statusLane: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private damageOverlay: HTMLDivElement;
  private collectibleEl!: HTMLDivElement;
  private healthEl!: HTMLDivElement;
  private hearts: HTMLSpanElement[] = [];
  private previousObjectiveText: string | null = null;
  private previousCollectibleCount = 0;
  private previousHealth: number | null = null;
  private statusTimers = new Map<HTMLDivElement, ReturnType<typeof setTimeout>>();
  private heartTimers = new Map<HTMLSpanElement, ReturnType<typeof setTimeout>>();
  private elementTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private healthHitTimer: ReturnType<typeof setTimeout> | null = null;
  private holdResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.container = parent;
    this.prompt = document.createElement('div');
    this.prompt.id = 'hud-prompt';
    this.prompt.className = 'hud-glass-card hud-prompt';
    parent.appendChild(this.prompt);

    this.holdWrap = document.createElement('div');
    this.holdWrap.id = 'hud-hold';
    this.holdWrap.className = 'hud-hold-track';
    this.holdFill = document.createElement('div');
    this.holdFill.className = 'hud-hold-fill';
    const holdKey = document.createElement('div');
    holdKey.className = 'hud-hold-key';
    holdKey.textContent = 'F';
    const holdCaption = document.createElement('div');
    holdCaption.className = 'hud-hold-caption';
    holdCaption.textContent = 'Hold';
    this.holdFill.appendChild(holdKey);
    this.holdFill.appendChild(holdCaption);
    this.holdWrap.appendChild(this.holdFill);
    parent.appendChild(this.holdWrap);

    this.objectiveRegion = document.createElement('div');
    this.objectiveRegion.className = 'hud-objective-region';
    parent.appendChild(this.objectiveRegion);

    this.objective = document.createElement('div');
    this.objective.id = 'hud-objective';
    this.objective.className = 'hud-glass-card hud-objective-card';
    const objectiveEyebrow = document.createElement('div');
    objectiveEyebrow.className = 'hud-card-eyebrow';
    objectiveEyebrow.textContent = 'Objective';
    this.objectiveText = document.createElement('div');
    this.objectiveText.className = 'hud-objective-text';
    this.objective.appendChild(objectiveEyebrow);
    this.objective.appendChild(this.objectiveText);
    this.objectiveRegion.appendChild(this.objective);

    this.statusLane = document.createElement('div');
    this.statusLane.id = 'hud-status-lane';
    this.statusLane.className = 'hud-status-lane';
    this.objectiveRegion.appendChild(this.statusLane);

    this.crosshair = document.createElement('div');
    this.crosshair.className = 'hud-crosshair';
    parent.appendChild(this.crosshair);

    this.damageOverlay = document.createElement('div');
    this.damageOverlay.className = 'hud-damage-overlay';
    parent.appendChild(this.damageOverlay);

    this.createCollectibleCounter();
    this.createHealthHearts();
  }

  showPrompt(text: string): void {
    this.prompt.textContent = text;
    this.prompt.classList.add('is-visible');
  }

  hidePrompt(): void {
    this.prompt.classList.remove('is-visible');
  }

  setHoldProgress(progress: number | null): void {
    if (progress === null) {
      if (this.holdWrap.classList.contains('is-complete')) {
        if (this.holdResetTimer) {
          clearTimeout(this.holdResetTimer);
        }
        this.holdResetTimer = setTimeout(() => {
          this.resetHoldProgressVisuals();
          this.holdResetTimer = null;
        }, 180);
        return;
      }
      this.resetHoldProgressVisuals();
      return;
    }
    if (this.holdResetTimer) {
      clearTimeout(this.holdResetTimer);
      this.holdResetTimer = null;
    }
    const clamped = Math.max(0, Math.min(1, progress));
    this.holdWrap.classList.add('is-visible');
    this.holdWrap.classList.toggle('is-complete', clamped >= 1);
    this.holdWrap.style.setProperty('--hold-progress', clamped.toFixed(3));
    this.holdWrap.style.setProperty('--hold-progress-angle', `${(clamped * 360).toFixed(1)}deg`);
  }

  setObjective(text: string): void {
    const changed = text !== this.previousObjectiveText;
    this.objectiveText.textContent = text;
    this.showObjective();
    if (changed) {
      this.triggerPulse(this.objective, 'is-updated', 480);
      this.previousObjectiveText = text;
    }
  }

  hideObjective(): void {
    this.objective.classList.remove('is-visible');
  }

  showObjective(): void {
    this.objective.classList.add('is-visible');
  }

  showStatus(text: string, durationMs = 1600): void {
    const status = document.createElement('div');
    status.className = 'hud-glass-card hud-status-card';
    status.textContent = text;
    this.statusLane.appendChild(status);
    void status.offsetHeight;
    status.classList.add('is-visible');

    while (this.statusLane.children.length > 3) {
      const oldest = this.statusLane.firstElementChild as HTMLDivElement | null;
      if (!oldest) break;
      this.clearStatus(oldest, true);
    }

    const timer = setTimeout(() => {
      this.clearStatus(status, false);
    }, durationMs);
    this.statusTimers.set(status, timer);
  }

  private createCollectibleCounter(): void {
    this.collectibleEl = document.createElement('div');
    this.collectibleEl.className = 'hud-stat-chip hud-collectible-chip';

    const icon = document.createElement('div');
    icon.className = 'hud-stat-icon hud-collectible-icon';
    icon.textContent = '\u2726';

    const count = document.createElement('span');
    count.className = 'collectible-count';
    count.textContent = '0';

    this.collectibleEl.appendChild(icon);
    this.collectibleEl.appendChild(count);
    this.container.appendChild(this.collectibleEl);
  }

  private createHealthHearts(): void {
    this.healthEl = document.createElement('div');
    this.healthEl.className = 'hud-stat-chip hud-health-chip';

    for (let i = 0; i < 3; i++) {
      const heart = document.createElement('span');
      heart.className = 'hud-heart is-filled';
      heart.textContent = '\u2764';
      this.hearts.push(heart);
      this.healthEl.appendChild(heart);
    }

    this.container.appendChild(this.healthEl);
  }

  updateCollectibles(count: number): void {
    const countEl = this.collectibleEl.querySelector('.collectible-count') as HTMLSpanElement;
    if (countEl) {
      countEl.textContent = String(count);
      if (count !== this.previousCollectibleCount) {
        this.triggerPulse(this.collectibleEl, 'is-boosted', 440);
        countEl.style.transform = 'scale(1.3)';
        setTimeout(() => { countEl.style.transform = 'scale(1)'; }, 200);
      }
    }
    this.previousCollectibleCount = count;
  }

  updateHealth(current: number, _max: number): void {
    if (this.previousHealth !== null && current < this.previousHealth) {
      this.healthEl.classList.remove('is-hit');
      void this.healthEl.offsetWidth;
      this.healthEl.classList.add('is-hit');
      if (this.healthHitTimer) {
        clearTimeout(this.healthHitTimer);
      }
      this.healthHitTimer = setTimeout(() => {
        this.healthEl.classList.remove('is-hit');
        this.healthHitTimer = null;
      }, 420);

      for (let index = current; index < this.previousHealth; index++) {
        const heart = this.hearts[index];
        if (!heart) continue;
        const existing = this.heartTimers.get(heart);
        if (existing) {
          clearTimeout(existing);
        }
        heart.classList.remove('is-lost');
        void heart.offsetWidth;
        heart.classList.add('is-lost');
        const timer = setTimeout(() => {
          heart.classList.remove('is-lost');
          this.heartTimers.delete(heart);
        }, 420);
        this.heartTimers.set(heart, timer);
      }
    } else if (this.previousHealth !== null && current > this.previousHealth) {
      this.triggerPulse(this.healthEl, 'is-restored', 460);
      for (let index = this.previousHealth; index < current; index++) {
        const heart = this.hearts[index];
        if (!heart) continue;
        this.triggerPulse(heart, 'is-refilled', 420);
      }
    }

    this.hearts.forEach((heart, i) => {
      const filled = i < current;
      heart.classList.toggle('is-filled', filled);
      heart.classList.toggle('is-empty', !filled);
    });
    this.previousHealth = current;
  }

  celebrateCollectible(value: number): void {
    this.triggerPulse(this.collectibleEl, 'is-celebrating', 520);
    this.spawnFloatingDelta(this.collectibleEl, `+${value}`, 'hud-floating-delta collectible');
  }

  flashObjectiveComplete(text: string): void {
    this.triggerPulse(this.objective, 'is-complete', 620);
    this.spawnFloatingDelta(this.objective, 'Complete', 'hud-floating-delta objective');
    this.objectiveText.textContent = text;
  }

  flashDamage(reason: 'spike' | 'fall'): void {
    this.damageOverlay.classList.toggle('is-fall', reason === 'fall');
    this.triggerPulse(this.damageOverlay, 'is-hit', reason === 'fall' ? 420 : 2500);
  }

  showGameHUD(): void {
    this.collectibleEl.classList.add('is-visible');
    this.healthEl.classList.add('is-visible');
  }

  hideGameHUD(): void {
    this.collectibleEl.classList.remove('is-visible');
    this.healthEl.classList.remove('is-visible');
  }

  dispose(): void {
    for (const timer of this.statusTimers.values()) {
      clearTimeout(timer);
    }
    this.statusTimers.clear();
    for (const timer of this.heartTimers.values()) {
      clearTimeout(timer);
    }
    this.heartTimers.clear();
    for (const timer of this.elementTimers.values()) {
      clearTimeout(timer);
    }
    this.elementTimers.clear();
    if (this.healthHitTimer) {
      clearTimeout(this.healthHitTimer);
      this.healthHitTimer = null;
    }
    if (this.holdResetTimer) {
      clearTimeout(this.holdResetTimer);
      this.holdResetTimer = null;
    }
    this.prompt.remove();
    this.holdWrap.remove();
    this.objectiveRegion.remove();
    this.objective.remove();
    this.crosshair.remove();
    this.damageOverlay.remove();
    this.collectibleEl.remove();
    this.healthEl.remove();
  }

  private clearStatus(status: HTMLDivElement, immediate: boolean): void {
    const timer = this.statusTimers.get(status);
    if (timer) {
      clearTimeout(timer);
      this.statusTimers.delete(status);
    }

    if (immediate) {
      status.remove();
      return;
    }

    status.classList.remove('is-visible');
    window.setTimeout(() => status.remove(), 180);
  }

  private resetHoldProgressVisuals(): void {
    this.holdWrap.classList.remove('is-visible', 'is-complete');
    this.holdWrap.style.setProperty('--hold-progress', '0');
    this.holdWrap.style.setProperty('--hold-progress-angle', '0deg');
  }

  private triggerPulse(element: HTMLElement, className: string, durationMs: number): void {
    const existing = this.elementTimers.get(element);
    if (existing) {
      clearTimeout(existing);
    }
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    const timer = setTimeout(() => {
      element.classList.remove(className);
      this.elementTimers.delete(element);
    }, durationMs);
    this.elementTimers.set(element, timer);
  }

  private spawnFloatingDelta(parent: HTMLElement, text: string, className: string): void {
    const delta = document.createElement('div');
    delta.className = className;
    delta.textContent = text;
    parent.appendChild(delta);
    void delta.offsetWidth;
    delta.classList.add('is-visible');
    window.setTimeout(() => {
      delta.classList.remove('is-visible');
      window.setTimeout(() => delta.remove(), 220);
    }, 320);
  }
}
