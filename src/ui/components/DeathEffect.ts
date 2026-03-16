import type { Disposable } from '@core/types';
import type { EventBus } from '@core/EventBus';

const IRIS_CLOSE_MS = 400;
const IRIS_HOLD_MS = 500;
const IRIS_OPEN_MS = 400;
const PARTICLE_COLORS = ['#ff6b9d', '#7b2fff', '#00d2ff', '#FFD700'];
const PARTICLE_COUNT = 14;

/**
 * Astro Bot-style iris wipe death transition using clip-path: circle().
 * 1) Black overlay with circle clip shrinks to center
 * 2) Holds on black with toonish icon while respawn happens
 * 3) Circle expands back open + particle burst
 */
export class DeathEffect implements Disposable {
  private overlay: HTMLDivElement;
  private playing = false;

  constructor(private eventBus: EventBus) {
    this.overlay = document.getElementById('ui-overlay') as HTMLDivElement;
    this.injectStyles();
  }

  /** Full iris wipe sequence. Returns when fully open again. */
  async play(): Promise<void> {
    if (this.playing) return;
    this.playing = true;

    const container = this.createContainer();
    this.overlay.appendChild(container);

    const mask = container.querySelector('.iris-mask') as HTMLDivElement;
    const icon = container.querySelector('.iris-icon') as HTMLDivElement;

    // Force layout so the initial clip-path is applied
    void container.offsetHeight;

    // Phase 1: iris close — shrink circle from full screen to zero
    mask.style.clipPath = 'circle(0% at 50% 50%)';

    await this.wait(IRIS_CLOSE_MS);

    // Show icon at center during hold
    icon.style.opacity = '1';
    icon.style.transform = 'translate(-50%, -50%) scale(1)';

    // Signal that screen is black — Game.ts does respawn now
    this.eventBus.emit('player:deathMidpoint', undefined);

    await this.wait(IRIS_HOLD_MS);

    // Phase 2: iris open — expand circle back to full
    icon.style.opacity = '0';
    icon.style.transform = 'translate(-50%, -50%) scale(0.5)';

    // Switch to open transition timing
    mask.style.transition = `clip-path ${IRIS_OPEN_MS}ms cubic-bezier(0, 0, 0.2, 1)`;
    void mask.offsetHeight;
    mask.style.clipPath = 'circle(150% at 50% 50%)';

    // Burst particles as iris opens
    this.burstParticles();

    await this.wait(IRIS_OPEN_MS);

    container.remove();
    this.playing = false;
  }

  dispose(): void {
    document.getElementById('iris-wipe-style')?.remove();
  }

  private wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private injectStyles(): void {
    if (document.getElementById('iris-wipe-style')) return;
    const style = document.createElement('style');
    style.id = 'iris-wipe-style';
    style.textContent = `
      .iris-container {
        position: fixed;
        inset: 0;
        z-index: 1100;
        pointer-events: none;
      }
      .iris-mask {
        position: absolute;
        inset: 0;
        background: #0c0524;
        clip-path: circle(150% at 50% 50%);
        transition: clip-path ${IRIS_CLOSE_MS}ms cubic-bezier(0.4, 0, 0.8, 1);
      }
      .iris-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        opacity: 0;
        transition: opacity 200ms ease, transform 200ms ease;
        font-size: 48px;
        z-index: 1;
        filter: drop-shadow(0 0 12px #7b2fff88);
      }
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

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'iris-container';

    const mask = document.createElement('div');
    mask.className = 'iris-mask';
    container.appendChild(mask);

    const icon = document.createElement('div');
    icon.className = 'iris-icon';
    icon.textContent = '💫';
    container.appendChild(icon);

    return container;
  }

  private burstParticles(): void {
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
        zIndex: '1101',
        pointerEvents: 'none',
        animation: 'deathParticleBurst 400ms ease-out forwards',
      });
      particle.style.setProperty('--dx', `${dx}px`);
      particle.style.setProperty('--dy', `${dy}px`);

      this.overlay.appendChild(particle);
      setTimeout(() => particle.remove(), 400);
    }
  }
}
