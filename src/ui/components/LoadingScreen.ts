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
    // Append to document.body (not #ui-overlay) so the loading screen
    // sits above the menu overlay (z-index 1200) in the root stacking context.
    // #ui-overlay has z-index:10 which creates a stacking context — children
    // can never escape above siblings with higher z-index.
    document.body.appendChild(this.container);
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
