import * as THREE from 'three';

export class SnapGrid {
  readonly grid: THREE.GridHelper;
  enabled = true;
  positionSnap = 0.5;
  rotationSnap = THREE.MathUtils.degToRad(15);
  scaleSnap = 0.1;

  constructor(scene: THREE.Scene) {
    // Brighter colors so the grid is readable under tone mapping + post FX.
    this.grid = new THREE.GridHelper(200, 200, 0x5a5a5a, 0x343434);
    this.grid.visible = false;
    // Place slightly above y=0 to avoid z-fighting and ensure visibility across levels.
    // (Some levels use y=0 ground, while older procedural floors used y=-1.)
    this.grid.position.y = 0.01;
    this.grid.renderOrder = 10;
    const material = this.grid.material;
    const materials = Array.isArray(material) ? material : [material];
    for (const m of materials) {
      const lineMat = m as THREE.LineBasicMaterial;
      lineMat.depthTest = false;
      lineMat.depthWrite = false;
      lineMat.transparent = true;
      lineMat.opacity = 0.95;
    }
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
