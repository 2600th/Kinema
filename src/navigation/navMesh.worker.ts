import { createDefaultQueryFilter, createFindNearestPolyResult, findNearestPoly, type NodeRef } from "navcat";
import { floodFillNavMesh, generateSoloNavMesh } from "navcat/blocks";
import {
  KINEMA_NAV_MESH_OPTIONS,
  type NavMeshWorkerRequest,
  type NavMeshWorkerResponse,
} from "./navMeshWorkerProtocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<NavMeshWorkerRequest>) => void) | null;
  postMessage(message: NavMeshWorkerResponse): void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  try {
    const startedAt = performance.now();
    const { positions, indices, seedPoint } = event.data;
    const result = generateSoloNavMesh({ positions, indices }, KINEMA_NAV_MESH_OPTIONS);
    let reachableNodeRefs: NodeRef[] | null = null;

    if (seedPoint) {
      const filter = createDefaultQueryFilter();
      const nearest = createFindNearestPolyResult();
      findNearestPoly(nearest, result.navMesh, seedPoint, [2, 4, 2], filter);
      if (nearest.success) {
        reachableNodeRefs = floodFillNavMesh(result.navMesh, [nearest.nodeRef]).reachable;
      }
    }

    workerScope.postMessage({
      ok: true,
      navMesh: result.navMesh,
      reachableNodeRefs,
      generationMs: performance.now() - startedAt,
    });
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
