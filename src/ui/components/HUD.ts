import type { Disposable } from '@core/types';

/**
 * HUD component — shows interaction prompts.
 */
export class HUD implements Disposable {
  private prompt: HTMLDivElement;
  private holdWrap: HTMLDivElement;
  private holdFill: HTMLDivElement;
  private objective: HTMLDivElement;
  private status: HTMLDivElement;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.prompt = document.createElement('div');
    this.prompt.id = 'hud-prompt';
    this.prompt.style.cssText = `
      position: absolute;
      bottom: 20%;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 16px;
      border-radius: 8px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      user-select: none;
      z-index: 1000;
    `;
    parent.appendChild(this.prompt);

    this.holdWrap = document.createElement('div');
    this.holdWrap.id = 'hud-hold';
    this.holdWrap.style.cssText = `
      position: absolute;
      bottom: calc(20% - 26px);
      left: 50%;
      transform: translateX(-50%);
      width: 220px;
      height: 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.14);
      overflow: hidden;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 1000;
    `;
    this.holdFill = document.createElement('div');
    this.holdFill.style.cssText = `
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, rgba(79,195,247,0.9), rgba(140,220,255,0.95));
      box-shadow: 0 0 14px rgba(79,195,247,0.35);
    `;
    this.holdWrap.appendChild(this.holdFill);
    parent.appendChild(this.holdWrap);

    this.objective = document.createElement('div');
    this.objective.id = 'hud-objective';
    this.objective.style.cssText = `
      position: absolute;
      top: 24px;
      left: 24px;
      max-width: 46vw;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.55);
      color: #dff6ff;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      border-radius: 6px;
      pointer-events: none;
      user-select: none;
      z-index: 1000;
    `;
    parent.appendChild(this.objective);

    this.status = document.createElement('div');
    this.status.id = 'hud-status';
    this.status.style.cssText = `
      position: absolute;
      top: 62px;
      left: 24px;
      max-width: 46vw;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.45);
      color: #ffe8b3;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      border-radius: 6px;
      pointer-events: none;
      user-select: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 1000;
    `;
    parent.appendChild(this.status);
  }

  showPrompt(text: string): void {
    this.prompt.textContent = text;
    this.prompt.style.opacity = '1';
  }

  hidePrompt(): void {
    this.prompt.style.opacity = '0';
  }

  setHoldProgress(progress: number | null): void {
    if (progress === null) {
      this.holdWrap.style.opacity = '0';
      this.holdFill.style.width = '0%';
      return;
    }
    const clamped = Math.max(0, Math.min(1, progress));
    this.holdWrap.style.opacity = '1';
    this.holdFill.style.width = `${(clamped * 100).toFixed(2)}%`;
  }

  setObjective(text: string): void {
    this.objective.textContent = `Objective: ${text}`;
  }

  showStatus(text: string, durationMs = 1600): void {
    this.status.textContent = text;
    this.status.style.opacity = '1';
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    this.statusTimer = setTimeout(() => {
      this.status.style.opacity = '0';
      this.statusTimer = null;
    }, durationMs);
  }

  dispose(): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.prompt.remove();
    this.holdWrap.remove();
    this.objective.remove();
    this.status.remove();
  }
}
