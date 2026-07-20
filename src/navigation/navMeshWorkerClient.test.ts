import type { NavMesh } from "navcat";
import { describe, expect, it, vi } from "vitest";
import { type NavMeshWorkerLike, requestNavMeshGeneration } from "./navMeshWorkerClient";

function createWorkerDouble() {
  const worker: NavMeshWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  return worker;
}

describe("requestNavMeshGeneration", () => {
  it("transfers one typed copy of geometry and terminates after success", async () => {
    const worker = createWorkerDouble();
    const request = requestNavMeshGeneration(
      {
        positions: [0, 0, 0, 1, 0, 0, 0, 0, 1],
        indices: [0, 1, 2],
        seedPoint: [0, 0, 0],
      },
      () => worker,
    );
    const [message, transfer] = vi.mocked(worker.postMessage).mock.calls[0];

    expect(message.positions).toBeInstanceOf(Float32Array);
    expect(message.indices).toBeInstanceOf(Uint32Array);
    expect(transfer).toEqual([message.positions.buffer, message.indices.buffer]);

    const navMesh = { nodes: [] } as unknown as NavMesh;
    worker.onmessage?.({
      data: { ok: true, navMesh, reachableNodeRefs: [7, 9], generationMs: 12.5 },
    } as MessageEvent);

    await expect(request.promise).resolves.toEqual({ navMesh, reachableNodeRefs: [7, 9], generationMs: 12.5 });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects serialized worker failures and terminates", async () => {
    const worker = createWorkerDouble();
    const request = requestNavMeshGeneration({ positions: [], indices: [] }, () => worker);
    worker.onmessage?.({ data: { ok: false, error: "voxelization failed" } } as MessageEvent);

    await expect(request.promise).rejects.toThrow("voxelization failed");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight request without leaving a pending promise", async () => {
    const worker = createWorkerDouble();
    const request = requestNavMeshGeneration({ positions: [], indices: [] }, () => worker);
    request.cancel();

    await expect(request.promise).rejects.toThrow("Navmesh generation cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
