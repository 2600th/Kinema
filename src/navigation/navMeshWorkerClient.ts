import type { NavMesh, NodeRef } from "navcat";
import type { NavMeshWorkerRequest, NavMeshWorkerResponse } from "./navMeshWorkerProtocol";

export interface NavMeshWorkerLike {
  onmessage: ((event: MessageEvent<NavMeshWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: NavMeshWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export type NavMeshGenerationInput = {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  seedPoint?: [number, number, number];
};

export type NavMeshGenerationResult = {
  navMesh: NavMesh;
  reachableNodeRefs: NodeRef[] | null;
  generationMs: number;
};

export type NavMeshGenerationRequest = {
  promise: Promise<NavMeshGenerationResult>;
  cancel(): void;
};

type WorkerFactory = () => NavMeshWorkerLike;

function createNavMeshWorker(): NavMeshWorkerLike {
  return new Worker(new URL("./navMesh.worker.ts", import.meta.url), { type: "module" });
}

export function requestNavMeshGeneration(
  input: NavMeshGenerationInput,
  workerFactory: WorkerFactory = createNavMeshWorker,
): NavMeshGenerationRequest {
  const worker = workerFactory();
  let settled = false;
  let rejectRequest: (reason: Error) => void = () => {};

  const promise = new Promise<NavMeshGenerationResult>((resolve, reject) => {
    rejectRequest = reject;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      complete();
    };

    worker.onmessage = (event) => {
      const response = event.data;
      if (response.ok) {
        finish(() =>
          resolve({
            navMesh: response.navMesh,
            reachableNodeRefs: response.reachableNodeRefs,
            generationMs: response.generationMs,
          }),
        );
      } else {
        finish(() => reject(new Error(response.error)));
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || "Navmesh worker failed")));
    };
  });

  const positions = new Float32Array(input.positions);
  const indices = new Uint32Array(input.indices);
  const message: NavMeshWorkerRequest = { positions, indices, ...(input.seedPoint && { seedPoint: input.seedPoint }) };
  worker.postMessage(message, [positions.buffer, indices.buffer]);

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectRequest(new Error("Navmesh generation cancelled"));
    },
  };
}
