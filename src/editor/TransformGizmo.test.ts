import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { TransformGizmo } from "./TransformGizmo";

describe("TransformGizmo", () => {
  it("finishes an active drag without reverting its object and is idempotent", () => {
    const domElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      style: {},
    } as unknown as HTMLElement;
    const scene = new THREE.Scene();
    const draggingChanges: boolean[] = [];
    const gizmo = new TransformGizmo(
      new THREE.PerspectiveCamera(),
      domElement,
      scene,
      (dragging) => draggingChanges.push(dragging),
      vi.fn(),
    );
    const object = new THREE.Object3D();
    scene.add(object);
    gizmo.attach(object);
    gizmo.controls.axis = "X";
    gizmo.controls.dragging = true;
    object.position.set(4, 5, 6);

    gizmo.finishDrag();
    gizmo.finishDrag();

    expect(gizmo.controls.dragging).toBe(false);
    expect(object.position.toArray()).toEqual([4, 5, 6]);
    expect(draggingChanges).toEqual([true, false]);
    gizmo.dispose(scene);
  });
});
