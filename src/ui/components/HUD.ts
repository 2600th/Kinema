import type { Disposable } from '@core/types';

/**
 * HUD component — shows interaction prompts.
 */
export class HUD implements Disposable {
  private prompt: HTMLDivElement;
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
    this.objective.remove();
    this.status.remove();
  }
}
