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
    void flash.offsetHeight;
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 150);
  }

  private burstParticles(): void {
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
    document.getElementById('death-particle-style')?.remove();
  }
}
