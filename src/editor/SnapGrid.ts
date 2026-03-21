import * as THREE from 'three';

export class SnapGrid {
  /** Minor grid (1-unit spacing) */
  readonly grid: THREE.GridHelper;
  /** Major grid (10-unit spacing, bolder lines) */
  private readonly majorGrid: THREE.GridHelper;

  enabled = true;
  positionSnap = 0.5;
  rotationSnap = THREE.MathUtils.degToRad(15);
  scaleSnap = 0.1;

  constructor(scene: THREE.Scene) {
    // Minor grid — subtle, 1-unit spacing, 200×200 area
    this.grid = new THREE.GridHelper(200, 200, 0x3a3a4a, 0x2a2a38);
    this.grid.visible = false;
    this.grid.position.y = 0.01;
    const minorMaterials = Array.isArray(this.grid.material)
      ? this.grid.material
      : [this.grid.material];
    for (const m of minorMaterials) {
      const mat = m as THREE.LineBasicMaterial;
      mat.depthTest = true;
      mat.depthWrite = false;
      mat.transparent = true;
      mat.opacity = 0.35;
    }
    scene.add(this.grid);

    // Major grid — bolder, 10-unit spacing, same 200×200 area
    this.majorGrid = new THREE.GridHelper(200, 20, 0x5a5a6a, 0x4a4a5a);
    this.majorGrid.visible = false;
    this.majorGrid.position.y = 0.015; // Slightly above minor to prevent z-fighting
    const majorMaterials = Array.isArray(this.majorGrid.material)
      ? this.majorGrid.material
      : [this.majorGrid.material];
    for (const m of majorMaterials) {
      const mat = m as THREE.LineBasicMaterial;
      mat.depthTest = true;
      mat.depthWrite = false;
      mat.transparent = true;
      mat.opacity = 0.55;
    }
    scene.add(this.majorGrid);
  }

  setVisible(visible: boolean): void {
    this.grid.visible = visible;
    this.majorGrid.visible = visible;
  }

  isVisible(): boolean {
    return this.grid.visible;
  }

  toggleGrid(): void {
    const next = !this.grid.visible;
    this.grid.visible = next;
    this.majorGrid.visible = next;
  }

  toggleSnap(): void {
    this.enabled = !this.enabled;
  }

  /** Update both grids' Y position (called by EditorManager.updateGridHeight) */
  setHeight(y: number): void {
    this.grid.position.y = y + 0.01;
    this.majorGrid.position.y = y + 0.015;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.grid);
    this.grid.geometry.dispose();
    const minorMat = this.grid.material;
    if (Array.isArray(minorMat)) minorMat.forEach(m => m.dispose());
    else minorMat.dispose();

    scene.remove(this.majorGrid);
    this.majorGrid.geometry.dispose();
    const majorMat = this.majorGrid.material;
    if (Array.isArray(majorMat)) majorMat.forEach(m => m.dispose());
    else majorMat.dispose();
  }
}
