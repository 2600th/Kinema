import * as THREE from 'three';
import type { NavMeshManager } from './NavMeshManager';

export class NavDebugOverlay {
  private visible = false;

  constructor(
    private scene: THREE.Scene,
    private navMeshManager: NavMeshManager,
  ) {}

  toggle(): void {
    this.visible = !this.visible;
    this.navMeshManager.toggleDebug(this.scene);
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    if (this.visible) {
      this.navMeshManager.toggleDebug(this.scene);
    }
  }
}
