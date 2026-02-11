import type { Disposable } from '@core/types';

/**
 * HUD component — shows interaction prompts.
 */
export class HUD implements Disposable {
  private container: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'hud-prompt';
    this.container.style.cssText = `
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
    parent.appendChild(this.container);
  }

  showPrompt(text: string): void {
    this.container.textContent = text;
    this.container.style.opacity = '1';
  }

  hidePrompt(): void {
    this.container.style.opacity = '0';
  }

  dispose(): void {
    this.container.remove();
  }
}
