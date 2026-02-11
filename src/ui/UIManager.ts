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
    const overlay = document.getElementById('ui-overlay')!;

    this.hud = new HUD(overlay);
    this.fadeScreen = new FadeScreen(overlay);
    this.debugPanel = new DebugPanel(overlay);

    // Wire events
    this.unsubscribers.push(
      this.eventBus.on('interaction:focusChanged', ({ id, label }) => {
        if (id && label) {
          this.hud.showPrompt(`Press E to ${label}`);
        } else {
          this.hud.hidePrompt();
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('debug:toggle', () => {
        this.debugPanel.toggle();
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
