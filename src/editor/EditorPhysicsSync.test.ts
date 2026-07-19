import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { syncRigidBodyToObjectWorldPose } from "./EditorPhysicsSync";

describe("syncRigidBodyToObjectWorldPose", () => {
  it("matches a parented child body to the mesh's final world pose", () => {
    const parent = new THREE.Group();
    parent.position.set(5, 2, -3);
    parent.rotation.set(0.2, Math.PI / 3, -0.1);
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    child.position.set(1.5, -0.25, 2);
    child.rotation.set(-0.3, 0.4, 0.15);
    parent.add(child);
    parent.updateWorldMatrix(true, true);

    const setTranslation = vi.fn();
    const setRotation = vi.fn();

    syncRigidBodyToObjectWorldPose(child, { setTranslation, setRotation });

    const expectedPosition = child.getWorldPosition(new THREE.Vector3());
    const expectedRotation = child.getWorldQuaternion(new THREE.Quaternion());
    expect(setTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.closeTo(expectedPosition.x, 8),
        y: expect.closeTo(expectedPosition.y, 8),
        z: expect.closeTo(expectedPosition.z, 8),
      }),
      true,
    );
    expect(setRotation).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.closeTo(expectedRotation.x, 8),
        y: expect.closeTo(expectedRotation.y, 8),
        z: expect.closeTo(expectedRotation.z, 8),
        w: expect.closeTo(expectedRotation.w, 8),
      }),
      true,
    );
  });
});
