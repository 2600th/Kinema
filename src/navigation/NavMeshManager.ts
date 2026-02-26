import * as THREE from 'three';
import { generateSoloNavMesh, type SoloNavMeshResult } from 'navcat/blocks';
import { getPositionsAndIndices, createNavMeshHelper, type DebugObject } from 'navcat/three';
import { type NavMesh } from 'navcat';

export class NavMeshManager {
  private navMesh: NavMesh | null = null;
  private debugHelper: DebugObject | null = null;
  private debugVisible = false;

  generate(meshes: THREE.Mesh[]): void {
    const [positions, indices] = getPositionsAndIndices(meshes);

    const result: SoloNavMeshResult = generateSoloNavMesh(
      { positions, indices },
      {
        cellSize: 0.15,
        cellHeight: 0.15,
        walkableRadiusVoxels: 2,
        walkableRadiusWorld: 0.3,
        walkableClimbVoxels: 4,
        walkableClimbWorld: 0.6,
        walkableHeightVoxels: 10,
        walkableHeightWorld: 1.5,
        walkableSlopeAngleDegrees: 45,
        borderSize: 0,
        minRegionArea: 8,
        mergeRegionArea: 20,
        maxSimplificationError: 1.3,
        maxEdgeLength: 12,
        maxVerticesPerPoly: 5,
        detailSampleDistance: 0.9,
        detailSampleMaxError: 0.15,
      },
    );

    this.navMesh = result.navMesh;
  }

  getNavMesh(): NavMesh | null {
    return this.navMesh;
  }

  toggleDebug(scene: THREE.Scene): void {
    if (this.debugVisible && this.debugHelper) {
      scene.remove(this.debugHelper.object);
      this.debugHelper.dispose();
      this.debugHelper = null;
      this.debugVisible = false;
      return;
    }

    if (!this.navMesh) return;

    this.debugHelper = createNavMeshHelper(this.navMesh);
    scene.add(this.debugHelper.object);
    this.debugVisible = true;
  }

  dispose(scene: THREE.Scene): void {
    if (this.debugHelper) {
      scene.remove(this.debugHelper.object);
      this.debugHelper.dispose();
      this.debugHelper = null;
    }
    this.debugVisible = false;
    this.navMesh = null;
  }
}
