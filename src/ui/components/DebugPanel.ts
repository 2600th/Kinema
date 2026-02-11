import Stats from 'three/addons/libs/stats.module.js';
import type { Disposable, StateId } from '@core/types';

/**
 * Toggleable three.js Stats panel (FPS graph).
 */
export class DebugPanel implements Disposable {
  private readonly stats: Stats;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.stats = new Stats();
    this.stats.showPanel(0); // 0: FPS graph
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.left = '8px';
    this.stats.dom.style.top = '8px';
    this.stats.dom.style.display = 'none';
    parent.appendChild(this.stats.dom);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.stats.dom.style.display = this.visible ? 'block' : 'none';
  }

  tick(_speed: number, _state: StateId, _grounded: boolean): void {
    if (!this.visible) return;
    this.stats.update();
  }

  dispose(): void {
    this.stats.dom.remove();
  }
}
