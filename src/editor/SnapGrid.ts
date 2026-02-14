import * as THREE from 'three';

export class SnapGrid {
  readonly grid: THREE.GridHelper;
  enabled = true;
  positionSnap = 0.5;
  rotationSnap = THREE.MathUtils.degToRad(15);
  scaleSnap = 0.1;

  constructor(scene: THREE.Scene) {
    this.grid = new THREE.GridHelper(200, 200, 0x3a3a3a, 0x2a2a2a);
    this.grid.visible = false;
    this.grid.position.y = -1;
    scene.add(this.grid);
  }

  setVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  isVisible(): boolean {
    return this.grid.visible;
  }

  toggleGrid(): void {
    this.grid.visible = !this.grid.visible;
  }

  toggleSnap(): void {
    this.enabled = !this.enabled;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
  }
}
