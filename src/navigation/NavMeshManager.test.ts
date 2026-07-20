import type { NavMesh } from "navcat";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { NavMeshManager } from "./NavMeshManager";
import type { NavMeshGenerationInput, NavMeshGenerationRequest, NavMeshGenerationResult } from "./navMeshWorkerClient";

function deferredGeneration() {
  let resolve!: (value: NavMeshGenerationResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<NavMeshGenerationResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject, cancel: vi.fn() };
}

describe("NavMeshManager async generation", () => {
  it("adopts worker output and builds the reachable-only filter", async () => {
    const deferred = deferredGeneration();
    const request = vi.fn((_input: NavMeshGenerationInput) => deferred as NavMeshGenerationRequest);
    const manager = new NavMeshManager(request);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2));
    const navMesh = { nodes: [] } as unknown as NavMesh;

    const generation = manager.generateAsync([mesh], new THREE.Vector3(1, 2, 3));
    expect(request).toHaveBeenCalledOnce();
    const input = request.mock.calls[0]?.[0];
    expect(input?.positions.length).toBeGreaterThan(0);
    expect(input?.indices.length).toBeGreaterThan(0);
    expect(input?.seedPoint).toEqual([1, 2, 3]);

    deferred.resolve({ navMesh, reachableNodeRefs: [5, 8], generationMs: 14 });
    await generation;

    expect(manager.getNavMesh()).toBe(navMesh);
    expect(manager.getReachableFilter()?.passFilter(5, navMesh)).toBe(true);
    expect(manager.getReachableFilter()?.passFilter(7, navMesh)).toBe(false);
    expect(manager.getLastGenerationStats()).toEqual({ workerGenerationMs: 14, totalMs: expect.any(Number) });
  });

  it("cancels an in-flight worker when disposed", () => {
    const deferred = deferredGeneration();
    const manager = new NavMeshManager(() => deferred as NavMeshGenerationRequest);
    void manager.generateAsync([new THREE.Mesh(new THREE.BoxGeometry())]);

    manager.dispose(new THREE.Scene());

    expect(deferred.cancel).toHaveBeenCalledOnce();
  });
});
