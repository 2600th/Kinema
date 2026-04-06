import type { EventBus } from '@core/EventBus';
import type { Disposable } from '@core/types';
import { HUD } from './components/HUD';
import { FadeScreen } from './components/FadeScreen';
import { DebugPanel } from './components/DebugPanel';
import { LoadingScreen } from './components/LoadingScreen';
import { DeathEffect } from './components/DeathEffect';

/**
 * DOM-based UI overlay manager.
 * Subscribes to EventBus events and manages UI components.
 */
export class UIManager implements Disposable {
  public readonly hud: HUD;
  public readonly fadeScreen: FadeScreen;
  public readonly debugPanel: DebugPanel;
  public readonly loadingScreen: LoadingScreen;
  private readonly deathEffect: DeathEffect;

  private unsubscribers: (() => void)[] = [];
  private overlayEl: HTMLElement | null = null;
  private hintEl: HTMLDivElement | null = null;

  constructor(private eventBus: EventBus) {
    let overlay = document.getElementById('ui-overlay');
    if (!overlay) {
      if (!document.body) {
        throw new Error('[UIManager] Missing #ui-overlay and document.body is unavailable.');
      }
      overlay = document.createElement('div');
      overlay.id = 'ui-overlay';
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.pointerEvents = 'none';
      document.body.appendChild(overlay);
      this.overlayEl = overlay;
      console.warn('[UIManager] #ui-overlay missing. Created fallback overlay element.');
    }

    this.hud = new HUD(overlay);
    this.fadeScreen = new FadeScreen(overlay);
    this.debugPanel = new DebugPanel(overlay, this.eventBus);
    this.loadingScreen = new LoadingScreen();
    this.deathEffect = new DeathEffect(this.eventBus);

    // "Click to start" hint for audio activation
    this.createInteractionHint();

    // Wire events
    this.unsubscribers.push(
      this.eventBus.on('interaction:focusChanged', ({ id, label }) => {
        if (id && label) {
          this.hud.showPrompt(label);
        } else {
          this.hud.hidePrompt();
          this.hud.setHoldProgress(null);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:holdProgress', (payload) => {
        if (!payload) {
          this.hud.setHoldProgress(null);
          return;
        }
        this.hud.setHoldProgress(payload.progress);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('interaction:blocked', ({ reason }) => {
        this.hud.showStatus(reason, 1200);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('debug:toggle', () => {
        this.debugPanel.toggle();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('objective:set', ({ text }) => {
        this.hud.setObjective(text);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('objective:completed', ({ text }) => {
        this.hud.showStatus(`Objective complete: ${text}`);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('checkpoint:activated', () => {
        this.hud.showStatus('Checkpoint activated');
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('player:dying', () => {
        this.deathEffect.play();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('player:respawned', () => {
        this.hud.showStatus('Respawned');
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('loading:progress', ({ progress }) => {
        this.loadingScreen.setProgress(progress);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('collectible:changed', ({ count }) => {
        this.hud.updateCollectibles(count);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('health:changed', ({ current, max }) => {
        this.hud.updateHealth(current, max);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('level:loaded', () => {
        this.hud.showGameHUD();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('level:unloaded', () => {
        this.hud.hideGameHUD();
      }),
    );
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.hud.dispose();
    this.fadeScreen.dispose();
    this.debugPanel.dispose();
    this.loadingScreen.dispose();
    this.deathEffect.dispose();
    this.hintEl?.remove();
    this.overlayEl?.remove();
  }

  private createInteractionHint(): void {
    if (!document.body || typeof document.addEventListener !== 'function') return;

    this.hintEl = document.createElement('div');
    const hint = this.hintEl;
    hint.textContent = 'Click to start';
    hint.className = 'kinema-ui-hint';

    document.body.appendChild(hint);

    const dismiss = (): void => {
      document.removeEventListener('pointerdown', dismiss);
      hint.style.opacity = '0';
      setTimeout(() => {
        hint.remove();
      }, 500);
    };
    document.addEventListener('pointerdown', dismiss);
  }
}
