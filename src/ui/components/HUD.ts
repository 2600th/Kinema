import type { Disposable } from '@core/types';

/**
 * HUD component — shows interaction prompts.
 */
export class HUD implements Disposable {
  private container: HTMLElement;
  private prompt: HTMLDivElement;
  private holdWrap: HTMLDivElement;
  private holdFill: HTMLDivElement;
  private objective: HTMLDivElement;
  private status: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private collectibleEl!: HTMLDivElement;
  private healthEl!: HTMLDivElement;
  private hearts: HTMLSpanElement[] = [];

  constructor(parent: HTMLElement) {
    this.container = parent;
    this.prompt = document.createElement('div');
    this.prompt.id = 'hud-prompt';
    this.prompt.style.cssText = `
      position: absolute;
      bottom: 20%;
      left: 50%;
      transform: translateX(-50%);
      padding: clamp(10px, 2vw, 14px) clamp(18px, 4vw, 32px);
      background: rgba(15, 20, 28, 0.75);
      backdrop-filter: blur(12px) saturate(120%);
      color: white;
      font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      font-size: clamp(14px, 2.5vw, 18px);
      max-width: calc(100vw - 40px);
      box-sizing: border-box;
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
      width: clamp(140px, 40vw, 220px);
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
      top: clamp(12px, 3vw, 32px);
      left: clamp(12px, 3vw, 32px);
      max-width: min(400px, calc(100vw - 24px));
      padding: clamp(8px, 1.5vw, 12px) clamp(12px, 2vw, 20px);
      background: rgba(15, 20, 28, 0.7);
      backdrop-filter: blur(12px);
      border-left: 4px solid #00d2ff;
      color: #e0f2fe;
      font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      font-size: clamp(12px, 2vw, 15px);
      box-sizing: border-box;
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
      top: clamp(52px, 10vw, 86px);
      left: clamp(12px, 3vw, 32px);
      max-width: min(400px, calc(100vw - 24px));
      padding: clamp(7px, 1.5vw, 10px) clamp(12px, 2vw, 18px);
      background: rgba(15, 20, 28, 0.6);
      backdrop-filter: blur(8px);
      border-left: 4px solid #fca311;
      color: #fca311;
      font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      font-size: clamp(11px, 1.8vw, 14px);
      box-sizing: border-box;
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

    this.createCollectibleCounter();
    this.createHealthHearts();
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
    icon.textContent = '\u2726';

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
    this.collectibleEl.style.opacity = '1';
    this.healthEl.style.opacity = '1';
  }

  hideGameHUD(): void {
    this.collectibleEl.style.opacity = '0';
    this.healthEl.style.opacity = '0';
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
    this.collectibleEl.remove();
    this.healthEl.remove();
  }
}
