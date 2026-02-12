import type { EventBus } from '@core/EventBus';
import type { Disposable } from '@core/types';
import { HUD } from './components/HUD';
import { FadeScreen } from './components/FadeScreen';
import { DebugPanel } from './components/DebugPanel';

/**
 * DOM-based UI overlay manager.
 * Subscribes to EventBus events and manages UI components.
 */
export class UIManager implements Disposable {
  public readonly hud: HUD;
  public readonly fadeScreen: FadeScreen;
  public readonly debugPanel: DebugPanel;

  private unsubscribers: (() => void)[] = [];

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
      console.warn('[UIManager] #ui-overlay missing. Created fallback overlay element.');
    }

    this.hud = new HUD(overlay);
    this.fadeScreen = new FadeScreen(overlay);
    this.debugPanel = new DebugPanel(overlay, this.eventBus);

    // Wire events
    this.unsubscribers.push(
      this.eventBus.on('interaction:focusChanged', ({ id, label }) => {
        if (id && label) {
          this.hud.showPrompt(label);
        } else {
          this.hud.hidePrompt();
        }
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
      this.eventBus.on('player:respawned', ({ reason }) => {
        this.hud.showStatus(`Respawned (${reason})`);
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
  }
}
