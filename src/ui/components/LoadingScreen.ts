import type { Disposable } from '@core/types';

/**
 * Loading screen with compositor-friendly animations.
 *
 * All animations use only `transform` and `opacity` so they run on the
 * browser's compositor thread and stay alive even when the main thread
 * is blocked by heavy synchronous work (mesh/physics creation).
 *
 * The progress bar uses `transform: scaleX()` (compositor) instead of
 * `width` (main thread layout). A shimmer overlay adds visible motion
 * via pure CSS @keyframes on `transform: translateX()`.
 */
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
      transition: 'opacity 0.2s ease',
      pointerEvents: 'all',
      // Force GPU layer for the entire loading screen
      willChange: 'opacity',
    });

    // All keyframes use ONLY transform/opacity — compositor-thread safe
    const style = document.createElement('style');
    style.id = 'loading-screen-style';
    style.textContent = `
      @keyframes loadingOrbDrift1 {
        0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.8; }
        33% { transform: translate(30px, -20px) scale(1.1); opacity: 1; }
        66% { transform: translate(-20px, 15px) scale(0.9); opacity: 0.6; }
      }
      @keyframes loadingOrbDrift2 {
        0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.7; }
        33% { transform: translate(-25px, 25px) scale(1.15); opacity: 1; }
        66% { transform: translate(20px, -10px) scale(0.85); opacity: 0.5; }
      }
      @keyframes loadingOrbDrift3 {
        0%, 100% { transform: translate(0, 0) scale(1.05); opacity: 0.6; }
        50% { transform: translate(15px, 20px) scale(0.95); opacity: 0.9; }
      }
      @keyframes loadingShimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
      }
      @keyframes loadingPulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
      }
      @keyframes loadingTitleGlow {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.85; transform: scale(1.01); }
      }
    `;
    document.head.appendChild(style);

    // Floating glow orbs — transform-only animation (compositor safe)
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
        willChange: 'transform, opacity',
      });
      this.container.appendChild(orb);
    }

    // Title — gentle pulse animation (opacity + transform only)
    const title = document.createElement('div');
    Object.assign(title.style, {
      fontFamily: "'Outfit', sans-serif",
      fontWeight: '800',
      fontSize: 'clamp(28px, 5vw, 42px)',
      color: '#ffffff',
      letterSpacing: '3px',
      textShadow: '0 4px 16px #7b2fff88, 0 0 40px #7b2fff33',
      zIndex: '1',
      animation: 'loadingTitleGlow 3s ease-in-out infinite',
      willChange: 'transform, opacity',
    });
    title.textContent = 'KINEMA';
    this.container.appendChild(title);

    // Progress bar track
    const track = document.createElement('div');
    Object.assign(track.style, {
      width: 'clamp(140px, 20vw, 220px)',
      height: '8px',
      background: '#ffffff18',
      borderRadius: '8px',
      overflow: 'hidden',
      zIndex: '1',
      position: 'relative',
    });

    // Progress bar fill — uses transform:scaleX (compositor thread)
    this.barFill = document.createElement('div');
    Object.assign(this.barFill.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%', // Full width, scaled down via scaleX
      height: '100%',
      background: 'linear-gradient(90deg, #ff6b9d, #7b2fff, #00d2ff)',
      borderRadius: '8px',
      boxShadow: '0 0 14px #7b2fff88',
      transformOrigin: 'left center',
      transform: 'scaleX(0)',
      transition: 'transform 0.4s ease',
      willChange: 'transform',
    });
    track.appendChild(this.barFill);

    // Shimmer overlay — pure CSS animation on transform:translateX (compositor)
    const shimmer = document.createElement('div');
    Object.assign(shimmer.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '50%',
      height: '100%',
      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
      borderRadius: '8px',
      animation: 'loadingShimmer 1.5s ease-in-out infinite',
      willChange: 'transform',
      pointerEvents: 'none',
    });
    track.appendChild(shimmer);

    this.container.appendChild(track);

    // Status text — pulses via opacity animation (compositor safe)
    this.statusText = document.createElement('div');
    Object.assign(this.statusText.style, {
      fontFamily: "'Outfit', sans-serif",
      fontSize: '12px',
      color: '#ffffff66',
      letterSpacing: '1.5px',
      zIndex: '1',
      animation: 'loadingPulse 2s ease-in-out infinite',
      willChange: 'opacity',
    });
    this.statusText.textContent = 'Loading World...';
    this.container.appendChild(this.statusText);
  }

  show(): Promise<void> {
    document.body.appendChild(this.container);
    void this.container.offsetHeight;
    this.container.style.opacity = '1';
    return new Promise(resolve => setTimeout(resolve, 250));
  }

  hide(): Promise<void> {
    this.container.style.opacity = '0';
    return new Promise(resolve => {
      setTimeout(() => {
        this.container.remove();
        resolve();
      }, 400);
    });
  }

  setProgress(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    // scaleX is compositor-friendly — doesn't need main thread for animation
    this.barFill.style.transform = `scaleX(${clamped})`;
  }

  dispose(): void {
    this.container.remove();
    document.getElementById('loading-screen-style')?.remove();
  }
}
