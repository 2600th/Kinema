import * as THREE from 'three';
import { generateSoloNavMesh, floodFillNavMesh, type SoloNavMeshResult } from 'navcat/blocks';
import { getPositionsAndIndices, createNavMeshHelper, type DebugObject } from 'navcat/three';
import {
  type NavMesh,
  type NodeRef,
  type QueryFilter,
  findNearestPoly,
  createFindNearestPolyResult,
  createDefaultQueryFilter,
} from 'navcat';

export class NavMeshManager {
  private navMesh: NavMesh | null = null;
  private debugHelper: DebugObject | null = null;
  private debugVisible = false;
  /** Query filter that excludes unreachable polygons (obstacle tops, etc.). */
  private reachableFilter: QueryFilter | null = null;

  generate(meshes: THREE.Mesh[], seedPoint?: THREE.Vector3): void {
    const t0 = performance.now();

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

    // Prune disconnected walkable islands (e.g. obstacle tops) via flood fill.
    if (this.navMesh && seedPoint) {
      this.buildReachableFilter(seedPoint);
    }

    const ms = performance.now() - t0;
    console.log(`[NavMeshManager] Navmesh generated in ${ms.toFixed(1)}ms`);
    if (ms > 50) {
      console.warn(`[NavMeshManager] Navmesh generation took ${ms.toFixed(1)}ms — consider using generateAsync() for larger levels`);
    }
  }

  /**
   * Yields to the main thread before/after generation to avoid blocking UI.
   * For true off-thread generation, migrate to a Web Worker.
   */
  async generateAsync(meshes: THREE.Mesh[], seedPoint?: THREE.Vector3): Promise<void> {
    // Yield to the main thread before heavy work
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    this.generate(meshes, seedPoint);

    // Yield to the main thread after heavy work
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Flood-fill from a seed point on the main walkable surface.
   * Produces a QueryFilter that rejects unreachable polygons so agents
   * can never spawn or pathfind onto disconnected islands.
   */
  private buildReachableFilter(seed: THREE.Vector3): void {
    if (!this.navMesh) return;

    const defaultFilter = createDefaultQueryFilter();
    const nearestResult = createFindNearestPolyResult();
    findNearestPoly(nearestResult, this.navMesh, [seed.x, seed.y, seed.z], [2, 4, 2], defaultFilter);

    if (!nearestResult.success) {
      console.warn('[NavMeshManager] Could not find seed poly for flood fill — skipping prune');
      return;
    }

    const { reachable } = floodFillNavMesh(this.navMesh, [nearestResult.nodeRef]);
    const reachableSet = new Set<NodeRef>(reachable);

    this.reachableFilter = {
      passFilter(nodeRef: NodeRef) {
        return reachableSet.has(nodeRef);
      },
      getCost: defaultFilter.getCost.bind(defaultFilter),
    };
  }

  getNavMesh(): NavMesh | null {
    return this.navMesh;
  }

  /** Returns a query filter that only accepts reachable polygons, or null if pruning was not performed. */
  getReachableFilter(): QueryFilter | null {
    return this.reachableFilter;
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
    this.reachableFilter = null;
  }
}
