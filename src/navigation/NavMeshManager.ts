import {
  createDefaultQueryFilter,
  createFindNearestPolyResult,
  findNearestPoly,
  type NavMesh,
  type NodeRef,
  type QueryFilter,
} from "navcat";
import { floodFillNavMesh, generateSoloNavMesh, type SoloNavMeshResult } from "navcat/blocks";
import { createNavMeshHelper, type DebugObject, getPositionsAndIndices } from "navcat/three";
import type * as THREE from "three";
import { type NavMeshGenerationRequest, requestNavMeshGeneration } from "./navMeshWorkerClient";
import { KINEMA_NAV_MESH_OPTIONS } from "./navMeshWorkerProtocol";

export class NavMeshManager {
  private navMesh: NavMesh | null = null;
  private debugHelper: DebugObject | null = null;
  private debugVisible = false;
  /** Query filter that excludes unreachable polygons (obstacle tops, etc.). */
  private reachableFilter: QueryFilter | null = null;
  private activeGeneration: NavMeshGenerationRequest | null = null;
  private lastGenerationStats: { workerGenerationMs: number; totalMs: number } | null = null;

  constructor(private readonly requestGeneration: typeof requestNavMeshGeneration = requestNavMeshGeneration) {}

  generate(meshes: THREE.Mesh[], seedPoint?: THREE.Vector3): void {
    const t0 = performance.now();

    const [positions, indices] = getPositionsAndIndices(meshes);

    const result: SoloNavMeshResult = generateSoloNavMesh({ positions, indices }, KINEMA_NAV_MESH_OPTIONS);

    this.navMesh = result.navMesh;

    // Prune disconnected walkable islands (e.g. obstacle tops) via flood fill.
    if (this.navMesh && seedPoint) {
      this.buildReachableFilter(seedPoint);
    }

    const ms = performance.now() - t0;
    console.log(`[NavMeshManager] Navmesh generated in ${ms.toFixed(1)}ms`);
    if (ms > 50) {
      console.warn(
        `[NavMeshManager] Navmesh generation took ${ms.toFixed(1)}ms — consider using generateAsync() for larger levels`,
      );
    }
  }

  /** Generate the navmesh off the browser main thread. */
  async generateAsync(meshes: THREE.Mesh[], seedPoint?: THREE.Vector3): Promise<void> {
    const startedAt = performance.now();
    const [positions, indices] = getPositionsAndIndices(meshes);
    this.activeGeneration?.cancel();
    const request = this.requestGeneration({
      positions,
      indices,
      ...(seedPoint && { seedPoint: [seedPoint.x, seedPoint.y, seedPoint.z] }),
    });
    this.activeGeneration = request;

    try {
      const result = await request.promise;
      if (this.activeGeneration !== request) return;
      this.navMesh = result.navMesh;
      if (seedPoint && result.reachableNodeRefs === null) {
        console.warn("[NavMeshManager] Could not find seed poly for flood fill — skipping prune");
      }
      this.setReachableFilter(result.reachableNodeRefs);
      this.lastGenerationStats = {
        workerGenerationMs: result.generationMs,
        totalMs: performance.now() - startedAt,
      };
      console.log(
        `[NavMeshManager] Navmesh generated off-thread in ${result.generationMs.toFixed(1)}ms (${this.lastGenerationStats.totalMs.toFixed(1)}ms total)`,
      );
    } finally {
      if (this.activeGeneration === request) this.activeGeneration = null;
    }
  }

  private setReachableFilter(reachableNodeRefs: NodeRef[] | null): void {
    if (!reachableNodeRefs) {
      this.reachableFilter = null;
      return;
    }
    const defaultFilter = createDefaultQueryFilter();
    const reachableSet = new Set<NodeRef>(reachableNodeRefs);
    this.reachableFilter = {
      passFilter(nodeRef: NodeRef) {
        return reachableSet.has(nodeRef);
      },
      getCost: defaultFilter.getCost.bind(defaultFilter),
    };
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
      console.warn("[NavMeshManager] Could not find seed poly for flood fill — skipping prune");
      return;
    }

    const { reachable } = floodFillNavMesh(this.navMesh, [nearestResult.nodeRef]);
    this.setReachableFilter(reachable);
  }

  getNavMesh(): NavMesh | null {
    return this.navMesh;
  }

  /** Returns a query filter that only accepts reachable polygons, or null if pruning was not performed. */
  getReachableFilter(): QueryFilter | null {
    return this.reachableFilter;
  }

  getLastGenerationStats(): { workerGenerationMs: number; totalMs: number } | null {
    return this.lastGenerationStats;
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
    this.activeGeneration?.cancel();
    this.activeGeneration = null;
    if (this.debugHelper) {
      scene.remove(this.debugHelper.object);
      this.debugHelper.dispose();
      this.debugHelper = null;
    }
    this.debugVisible = false;
    this.navMesh = null;
    this.reachableFilter = null;
    this.lastGenerationStats = null;
  }
}
