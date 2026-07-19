import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  applyWorldPoseToObject,
  getObjectColliderBounds,
  getObjectWorldPhysicsPose,
  syncPhysicsSubtreeAtomically,
  syncRigidBodiesInSubtree,
  syncRigidBodyToObjectWorldPose,
  validateObjectPhysicsTransform,
  validatePhysicsAttachment,
  validateWorldMatrixAttachment,
} from "./EditorPhysicsSync";

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

  it("derives body pose, collider dimensions, and pivot offset after uniform inherited scale", () => {
    const parent = new THREE.Group();
    parent.position.set(4, 2, -6);
    parent.rotation.set(0.1, Math.PI / 3, -0.2);
    parent.scale.setScalar(2);
    const geometry = new THREE.BoxGeometry(2, 4, 6).translate(0.5, -0.25, 1);
    const child = new THREE.Mesh(geometry);
    child.position.set(1, 2, 3);
    child.rotation.set(-0.2, 0.4, 0.1);
    child.scale.set(1, 1.5, 0.5);
    parent.add(child);
    parent.updateWorldMatrix(true, true);

    const pose = getObjectWorldPhysicsPose(child);
    const bounds = getObjectColliderBounds(child);

    expect(pose.position.distanceTo(child.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-8);
    expect(pose.rotation.angleTo(child.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-8);
    expect(pose.scale.x).toBeCloseTo(2, 8);
    expect(pose.scale.y).toBeCloseTo(3, 8);
    expect(pose.scale.z).toBeCloseTo(1, 8);
    expect(bounds.halfExtents.x).toBeCloseTo(2, 8);
    expect(bounds.halfExtents.y).toBeCloseTo(6, 8);
    expect(bounds.halfExtents.z).toBeCloseTo(3, 8);
    expect(bounds.center.x).toBeCloseTo(1, 8);
    expect(bounds.center.y).toBeCloseTo(-0.75, 8);
    expect(bounds.center.z).toBeCloseTo(1, 8);
  });

  it("converts an interpolated Rapier world pose into the mesh parent local frame", () => {
    const parent = new THREE.Group();
    parent.position.set(7, -3, 2);
    parent.rotation.set(0.2, -0.8, 0.15);
    parent.scale.setScalar(1.5);
    const child = new THREE.Object3D();
    parent.add(child);
    parent.updateWorldMatrix(true, true);
    const worldPosition = new THREE.Vector3(-2, 4, 9);
    const worldRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.3, 0.2));

    applyWorldPoseToObject(child, worldPosition, worldRotation);
    child.updateWorldMatrix(true, false);

    expect(child.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition)).toBeLessThan(1e-8);
    expect(child.getWorldQuaternion(new THREE.Quaternion()).angleTo(worldRotation)).toBeLessThan(1e-6);
  });

  it("rejects sheared physics caused by a rotated child under non-uniform inherited scale", () => {
    const parent = new THREE.Group();
    parent.scale.set(2, 1, 0.5);
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    child.rotation.set(0.2, 0.7, 0.1);
    parent.add(child);
    parent.updateWorldMatrix(true, true);

    expect(() => getObjectWorldPhysicsPose(child)).toThrow(/non-uniform inherited scale/i);
  });

  it.each(["dynamic", "kinematic"] as const)(
    "rejects an axis-aligned %s body under non-uniform inherited parent scale",
    (type) => {
      const parent = new THREE.Group();
      parent.scale.set(2, 1, 0.5);
      const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      parent.add(child);

      expect(validateObjectPhysicsTransform(child, type)).toEqual(
        expect.objectContaining({ ok: false }),
      );
    },
  );

  it("allows an exact static axis-aligned collider under non-uniform inherited scale", () => {
    const parent = new THREE.Group();
    parent.scale.set(2, 1, 0.5);
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    parent.add(child);

    expect(validateObjectPhysicsTransform(child, "static")).toEqual({ ok: true });
  });

  it("rejects attachment that would place a moving object below non-uniform world scale", () => {
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    parent.scale.set(2, 1, 0.5);
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    scene.add(parent, child);
    scene.updateWorldMatrix(true, true);

    expect(validatePhysicsAttachment(child, parent, "dynamic")).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(child.parent).toBe(scene);
  });

  it("syncs descendant bodies after a transformed parent commits", () => {
    const parent = new THREE.Group();
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    child.position.set(1, 2, 3);
    parent.add(child);
    const setTranslation = vi.fn();
    const setRotation = vi.fn();
    parent.position.set(4, -1, 6);
    parent.rotation.set(0.2, 0.5, -0.1);
    parent.scale.setScalar(1.5);

    syncRigidBodiesInSubtree(parent, [{ mesh: child, body: { setTranslation, setRotation } }]);

    const expected = child.getWorldPosition(new THREE.Vector3());
    expect(setTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.closeTo(expected.x, 8),
        y: expect.closeTo(expected.y, 8),
        z: expect.closeTo(expected.z, 8),
      }),
      true,
    );
  });

  it("rejects a prospective group attachment that would decompose a sheared world matrix", () => {
    const scaledParent = new THREE.Group();
    scaledParent.scale.set(2, 1, 0.5);
    const rotatedChild = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    rotatedChild.rotation.set(0.2, 0.7, 0.1);
    scaledParent.add(rotatedChild);
    scaledParent.updateWorldMatrix(true, true);

    const prospectiveGroupWorld = new THREE.Matrix4().makeTranslation(3, 0, 0);

    expect(
      validateWorldMatrixAttachment(rotatedChild.matrixWorld, prospectiveGroupWorld, "static"),
    ).toEqual(expect.objectContaining({ ok: false }));
    expect(rotatedChild.parent).toBe(scaledParent);
  });

  it("accepts a prospective group attachment when the world transform is exact TRS", () => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    object.position.set(4, 2, -3);
    object.rotation.set(0.2, 0.7, 0.1);
    object.scale.set(2, 1, 0.5);
    object.updateWorldMatrix(true, false);

    const prospectiveGroupWorld = new THREE.Matrix4().makeTranslation(3, 0, 0);

    expect(validateWorldMatrixAttachment(object.matrixWorld, prospectiveGroupWorld, "static")).toEqual({ ok: true });
  });

  it("keeps old colliders and body poses when the second replacement collider fails", () => {
    const root = new THREE.Group();
    const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const secondMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    root.add(firstMesh, secondMesh);
    root.position.set(5, 0, 0);

    const firstBody = { setTranslation: vi.fn(), setRotation: vi.fn() };
    const secondBody = { setTranslation: vi.fn(), setRotation: vi.fn() };
    const firstOldCollider = { id: "first-old" };
    const secondOldCollider = { id: "second-old" };
    const replacement = { id: "replacement" };
    const removeCollider = vi.fn();
    const commitCollider = vi.fn();
    const createCollider = vi
      .fn()
      .mockReturnValueOnce(replacement)
      .mockImplementationOnce(() => {
        throw new Error("second collider failed");
      });

    const result = syncPhysicsSubtreeAtomically(
      root,
      [
        { mesh: firstMesh, body: firstBody, collider: firstOldCollider },
        { mesh: secondMesh, body: secondBody, collider: secondOldCollider },
      ],
      {
        rebuildColliders: true,
        buildColliderDesc: (entry) => ({ mesh: entry.mesh }),
        createCollider,
        removeCollider,
        commitCollider,
      },
    );

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(createCollider).toHaveBeenCalledTimes(2);
    expect(removeCollider).toHaveBeenCalledOnce();
    expect(removeCollider).toHaveBeenCalledWith(replacement);
    expect(removeCollider).not.toHaveBeenCalledWith(firstOldCollider);
    expect(removeCollider).not.toHaveBeenCalledWith(secondOldCollider);
    expect(firstBody.setTranslation).not.toHaveBeenCalled();
    expect(secondBody.setTranslation).not.toHaveBeenCalled();
    expect(commitCollider).not.toHaveBeenCalled();
  });
});
