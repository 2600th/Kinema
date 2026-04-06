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
  private collectibleEl!: HTMLDivElement;
  private healthEl!: HTMLDivElement;
  private hearts: HTMLSpanElement[] = [];
  private statusTimers = new Map<HTMLDivElement, ReturnType<typeof setTimeout>>();

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
      this.holdWrap.classList.remove('is-visible');
      this.holdFill.style.width = '0%';
      return;
    }
    const clamped = Math.max(0, Math.min(1, progress));
    this.holdWrap.classList.add('is-visible');
    this.holdFill.style.width = `${(clamped * 100).toFixed(2)}%`;
  }

  setObjective(text: string): void {
    this.objectiveText.textContent = text;
    this.showObjective();
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
      heart.className = 'hud-heart';
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
      countEl.style.transform = 'scale(1.3)';
      setTimeout(() => { countEl.style.transform = 'scale(1)'; }, 200);
    }
  }

  updateHealth(current: number, _max: number): void {
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
    this.prompt.remove();
    this.holdWrap.remove();
    this.objectiveRegion.remove();
    this.objective.remove();
    this.crosshair.remove();
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
}
