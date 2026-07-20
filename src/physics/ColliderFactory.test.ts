import { readFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ColliderFactory } from "./ColliderFactory";
import type { PhysicsWorld } from "./PhysicsWorld";

function createHarness() {
  const createCollider = vi.fn((desc: RAPIER.ColliderDesc) => ({ desc }) as unknown as RAPIER.Collider);
  const factory = new ColliderFactory({ world: { createCollider } } as unknown as PhysicsWorld);
  return { factory, createCollider };
}

describe("ColliderFactory fixed primitives", () => {
  it("creates a rotated body-less cuboid", () => {
    const { factory, createCollider } = createHarness();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.3, 0.4));

    factory.createFixedCuboid(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 6, 8), 0.8, rotation);

    const desc = createCollider.mock.calls[0]?.[0];
    expect(desc?.shape.type).toBe(RAPIER.ShapeType.Cuboid);
    expect(desc?.translation).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(desc?.rotation).toMatchObject({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    expect(createCollider.mock.calls[0]).toHaveLength(1);
  });

  it("creates body-less ball and cylinder shapes", () => {
    const { factory, createCollider } = createHarness();

    factory.createFixedBall(new THREE.Vector3(1, 2, 3), 0.8);
    factory.createFixedCylinder(new THREE.Vector3(4, 5, 6), 0.75, 0.5);

    expect(createCollider.mock.calls.map(([desc]) => desc.shape.type)).toEqual([
      RAPIER.ShapeType.Ball,
      RAPIER.ShapeType.Cylinder,
    ]);
    expect(createCollider.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
});

describe("ColliderFactory trimesh indices", () => {
  it("converts typed indices directly and truncates an incomplete triangle", () => {
    const { factory, createCollider } = createHarness();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setIndex(new THREE.Uint16BufferAttribute([0, 1, 2, 0], 1));
    const mesh = new THREE.Mesh(geometry);
    mesh.name = "typed-index-test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    factory.createTrimesh(mesh);

    const shape = createCollider.mock.calls[0]?.[0].shape as RAPIER.TriMesh;
    expect(shape.indices).toBeInstanceOf(Uint32Array);
    expect([...shape.indices]).toEqual([0, 1, 2]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("does not box every typed index through intermediate JavaScript arrays", () => {
    const source = readFileSync(new URL("./ColliderFactory.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Array.from(index.array");
    expect(source).not.toContain(".map((value) => Number(value))");
  });
});
