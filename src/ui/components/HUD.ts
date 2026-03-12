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
  private crosshair: HTMLDivElement;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.prompt = document.createElement('div');
    this.prompt.id = 'hud-prompt';
    this.prompt.style.cssText = `
      position: absolute;
      bottom: 20%;
      left: 50%;
      transform: translateX(-50%);
      padding: 14px 32px;
      background: rgba(15, 20, 28, 0.75);
      backdrop-filter: blur(12px) saturate(120%);
      color: white;
      font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.5px;
      border: 1px solid rgba(0, 210, 255, 0.3);
      box-shadow: 0 8px 32px rgba(0, 210, 255, 0.15);
      border-radius: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
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
      top: 32px;
      left: 32px;
      max-width: 400px;
      padding: 12px 20px;
      background: rgba(15, 20, 28, 0.7);
      backdrop-filter: blur(12px);
      border-left: 4px solid #00d2ff;
      color: #e0f2fe;
      font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      font-size: 15px;
      font-weight: 500;
      letter-spacing: 0.5px;
      border-radius: 4px;
      pointer-events: none;
      user-select: none;
      opacity: 1;
      transition: opacity 0.2s ease;
      z-index: 1000;
    `;
    parent.appendChild(this.objective);

    this.status = document.createElement('div');
    this.status.id = 'hud-status';
    this.status.style.cssText = `
      position: absolute;
      top: 86px;
      left: 32px;
      max-width: 400px;
      padding: 10px 18px;
      background: rgba(15, 20, 28, 0.6);
      backdrop-filter: blur(8px);
      border-left: 4px solid #fca311;
      color: #fca311;
      font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 500;
      border-radius: 4px;
      pointer-events: none;
      user-select: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 1000;
    `;
    parent.appendChild(this.status);

    this.crosshair = document.createElement('div');
    this.crosshair.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.7);
      box-shadow: 0 0 4px rgba(0,0,0,0.5);
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 1000;
    `;
    parent.appendChild(this.crosshair);
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
    this.showObjective();
  }

  hideObjective(): void {
    this.objective.style.opacity = '0';
  }

  showObjective(): void {
    this.objective.style.opacity = '1';
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
    this.crosshair.remove();
  }
}
