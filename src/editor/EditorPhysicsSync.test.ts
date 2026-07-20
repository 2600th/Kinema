import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  applyWorldPoseToObject,
  effectiveScaleChanged,
  getEditorPhysicsSyncCounters,
  getObjectColliderBounds,
  getObjectWorldPhysicsPose,
  replacePhysicsResourcesAtomically,
  resetEditorPhysicsSyncCounters,
  syncPhysicsSubtreeAtomically,
  syncRigidBodiesInSubtree,
  syncRigidBodyToObjectWorldPose,
  validateObjectPhysicsTransform,
  validatePhysicsAttachment,
  validateWorldMatrixAttachment,
} from "./EditorPhysicsSync";

type TestPhysicsResource = { id: string };
type TestPhysicsTracking = { id: string };
type TestPhysicsSnapshot = {
  body?: TestPhysicsResource;
  collider?: TestPhysicsResource;
  tracking: TestPhysicsTracking;
};

function makePhysicsReplacementHarness() {
  const current = {
    body: { id: "old-body" },
    collider: { id: "old-collider" },
    tracking: { id: "old-tracking" },
  };
  const replacementBody = { id: "replacement-body" };
  const replacementCollider = { id: "replacement-collider" };
  const replacementTracking = { id: "replacement-tracking" };
  let published: TestPhysicsSnapshot = current;
  const options = {
    createBody: vi.fn(() => replacementBody as TestPhysicsResource | undefined),
    createCollider: vi.fn(() => replacementCollider as TestPhysicsResource | undefined),
    createTracking: vi.fn(() => replacementTracking),
    publishReplacement: vi.fn((replacement: TestPhysicsSnapshot) => {
      published = replacement;
    }),
    restoreCurrent: vi.fn((snapshot: TestPhysicsSnapshot) => {
      published = snapshot;
    }),
    retireCurrent: vi.fn(),
    removeBody: vi.fn(),
    removeCollider: vi.fn(),
  };
  return {
    current,
    replacementBody,
    replacementCollider,
    replacementTracking,
    options,
    published: () => published,
  };
}

describe("replacePhysicsResourcesAtomically", () => {
  it("leaves current handles and tracking untouched when body allocation fails", () => {
    const harness = makePhysicsReplacementHarness();
    harness.options.createBody.mockImplementationOnce(() => {
      throw new Error("body allocation failed");
    });

    expect(replacePhysicsResourcesAtomically(harness.current, harness.options)).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/allocation/i) }),
    );
    expect(harness.published()).toBe(harness.current);
    expect(harness.options.publishReplacement).not.toHaveBeenCalled();
    expect(harness.options.retireCurrent).not.toHaveBeenCalled();
    expect(harness.options.removeBody).not.toHaveBeenCalled();
    expect(harness.options.removeCollider).not.toHaveBeenCalled();
  });

  it("removes an allocated replacement exactly once when collider creation fails", () => {
    const harness = makePhysicsReplacementHarness();
    harness.options.createCollider.mockImplementationOnce(() => {
      throw new Error("collider creation failed");
    });

    expect(replacePhysicsResourcesAtomically(harness.current, harness.options)).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/collider/i) }),
    );
    expect(harness.published()).toBe(harness.current);
    expect(harness.options.publishReplacement).not.toHaveBeenCalled();
    expect(harness.options.retireCurrent).not.toHaveBeenCalled();
    expect(harness.options.removeBody).toHaveBeenCalledOnce();
    expect(harness.options.removeBody).toHaveBeenCalledWith(harness.replacementBody);
    expect(harness.options.removeCollider).not.toHaveBeenCalled();
  });

  it("restores current handles and tracking when LevelManager publication fails", () => {
    const harness = makePhysicsReplacementHarness();
    const publishReplacement = harness.options.publishReplacement.getMockImplementation();
    harness.options.publishReplacement.mockImplementationOnce((replacement) => {
      publishReplacement?.(replacement);
      throw new Error("LevelManager publication failed");
    });

    expect(replacePhysicsResourcesAtomically(harness.current, harness.options)).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/publication/i) }),
    );
    expect(harness.published()).toBe(harness.current);
    expect(harness.options.restoreCurrent).toHaveBeenCalledWith(harness.current);
    expect(harness.options.retireCurrent).not.toHaveBeenCalled();
    expect(harness.options.removeBody).toHaveBeenCalledOnce();
    expect(harness.options.removeBody).toHaveBeenCalledWith(harness.replacementBody);
    expect(harness.options.removeCollider).not.toHaveBeenCalled();
  });

  it("restores current publication and removes the replacement once when old retirement fails", () => {
    const harness = makePhysicsReplacementHarness();
    harness.options.retireCurrent.mockImplementationOnce(() => {
      throw new Error("old retirement failed");
    });

    expect(replacePhysicsResourcesAtomically(harness.current, harness.options)).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/retirement/i) }),
    );
    expect(harness.published()).toBe(harness.current);
    expect(harness.options.publishReplacement).toHaveBeenCalledWith({
      body: harness.replacementBody,
      collider: harness.replacementCollider,
      tracking: harness.replacementTracking,
    });
    expect(harness.options.restoreCurrent).toHaveBeenCalledWith(harness.current);
    expect(harness.options.removeBody).toHaveBeenCalledOnce();
    expect(harness.options.removeBody).toHaveBeenCalledWith(harness.replacementBody);
    expect(harness.options.removeCollider).not.toHaveBeenCalled();
  });
});

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

  it.each([
    "dynamic",
    "kinematic",
  ] as const)("rejects an axis-aligned %s body under non-uniform inherited parent scale", (type) => {
    const parent = new THREE.Group();
    parent.scale.set(2, 1, 0.5);
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    parent.add(child);

    expect(validateObjectPhysicsTransform(child, type)).toEqual(expect.objectContaining({ ok: false }));
  });

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

    expect(validatePhysicsAttachment(child, parent, "dynamic")).toEqual(expect.objectContaining({ ok: false }));
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

    expect(validateWorldMatrixAttachment(rotatedChild.matrixWorld, prospectiveGroupWorld, "static")).toEqual(
      expect.objectContaining({ ok: false }),
    );
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

  it.each<{
    label: string;
    mutate(root: THREE.Object3D): void;
    expected: { poseSyncs: number; colliderDescriptorBuilds: number; colliderReplacements: number };
  }>([
    {
      label: "translation",
      mutate: (root) => root.position.set(5, 6, 7),
      expected: { poseSyncs: 2, colliderDescriptorBuilds: 0, colliderReplacements: 0 },
    },
    {
      label: "rotation",
      mutate: (root) => root.rotation.set(0.2, 0.3, 0.4),
      expected: { poseSyncs: 2, colliderDescriptorBuilds: 0, colliderReplacements: 0 },
    },
    {
      label: "scale",
      mutate: (root) => root.scale.set(2, 3, 4),
      expected: { poseSyncs: 2, colliderDescriptorBuilds: 2, colliderReplacements: 2 },
    },
  ])("pose-syncs every entry and selectively rebuilds colliders for a committed $label", ({ mutate, expected }) => {
    const root = new THREE.Group();
    const child = new THREE.Mesh(new THREE.BoxGeometry());
    root.add(child);
    const beforeScales = new Map<THREE.Object3D, THREE.Vector3>([
      [root, getObjectWorldPhysicsPose(root).scale.clone()],
      [child, getObjectWorldPhysicsPose(child).scale.clone()],
    ]);
    const makeBody = () => ({ setTranslation: vi.fn(), setRotation: vi.fn() });
    const entries = [
      { mesh: root, body: makeBody(), collider: { id: "root-old" } },
      { mesh: child, body: makeBody(), collider: { id: "child-old" } },
    ];
    mutate(root);
    resetEditorPhysicsSyncCounters();

    const result = syncPhysicsSubtreeAtomically(root, entries, {
      shouldRebuildCollider: (entry, nextPose) =>
        effectiveScaleChanged(beforeScales.get(entry.mesh) as THREE.Vector3, nextPose.scale),
      buildColliderDesc: (entry) => ({ mesh: entry.mesh }),
      createCollider: (_desc, _body) => ({ id: "replacement" }),
      removeCollider: vi.fn(),
      commitCollider: (entry, replacement) => {
        entry.collider = replacement;
      },
    });

    expect(result).toEqual({ ok: true });
    expect(getEditorPhysicsSyncCounters()).toEqual(expected);
  });

  it("treats a negative effective-scale sign flip as a collider shape change", () => {
    expect(effectiveScaleChanged(new THREE.Vector3(1, 2, 3), new THREE.Vector3(-1, 2, 3))).toBe(true);
    expect(effectiveScaleChanged(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1 + 0.5e-6, 2, 3))).toBe(false);
    expect(effectiveScaleChanged(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1 + 2e-6, 2, 3))).toBe(true);
  });

  it("pose-syncs collider-less objects without building or replacing a collider", () => {
    const root = new THREE.Group();
    const body = { setTranslation: vi.fn(), setRotation: vi.fn() };
    const buildColliderDesc = vi.fn(() => ({}));
    const createCollider = vi.fn(() => ({ id: "replacement" }));
    resetEditorPhysicsSyncCounters();

    const result = syncPhysicsSubtreeAtomically(root, [{ mesh: root, body }], {
      shouldRebuildCollider: () => true,
      buildColliderDesc,
      createCollider,
      removeCollider: vi.fn(),
      commitCollider: vi.fn(),
    });

    expect(result).toEqual({ ok: true });
    expect(body.setTranslation).toHaveBeenCalledOnce();
    expect(body.setRotation).toHaveBeenCalledOnce();
    expect(buildColliderDesc).not.toHaveBeenCalled();
    expect(createCollider).not.toHaveBeenCalled();
    expect(getEditorPhysicsSyncCounters()).toEqual({
      poseSyncs: 1,
      colliderDescriptorBuilds: 0,
      colliderReplacements: 0,
    });
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
        shouldRebuildCollider: () => true,
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

  it("rolls back body poses, collider tracking, and replacements when commit tracking throws", () => {
    const root = new THREE.Group();
    const firstMesh = new THREE.Mesh(new THREE.BoxGeometry());
    const secondMesh = new THREE.Mesh(new THREE.BoxGeometry());
    root.add(firstMesh, secondMesh);
    root.position.set(8, 0, 0);
    const makeBody = (x: number) => {
      const state = { position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
      return {
        state,
        translation: () => ({ ...state.position }),
        rotation: () => ({ ...state.rotation }),
        setTranslation: vi.fn((value: { x: number; y: number; z: number }) => {
          state.position = { ...value };
        }),
        setRotation: vi.fn((value: { x: number; y: number; z: number; w: number }) => {
          state.rotation = { ...value };
        }),
      };
    };
    const firstBody = makeBody(1);
    const secondBody = makeBody(2);
    const firstOld = { id: "first-old" };
    const secondOld = { id: "second-old" };
    const firstEntry = { mesh: firstMesh, body: firstBody, collider: firstOld };
    const secondEntry = { mesh: secondMesh, body: secondBody, collider: secondOld };
    const firstReplacement = { id: "first-new" };
    const secondReplacement = { id: "second-new" };
    const removeCollider = vi.fn();
    const commitCollider = vi.fn((entry: typeof firstEntry, collider: typeof firstOld) => {
      if (entry === secondEntry && collider === secondReplacement) throw new Error("tracking failed");
      entry.collider = collider;
    });

    resetEditorPhysicsSyncCounters();
    const result = syncPhysicsSubtreeAtomically(root, [firstEntry, secondEntry], {
      shouldRebuildCollider: () => true,
      buildColliderDesc: (entry) => ({ mesh: entry.mesh }),
      createCollider: vi.fn().mockReturnValueOnce(firstReplacement).mockReturnValueOnce(secondReplacement),
      removeCollider,
      commitCollider,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(firstBody.state.position).toEqual({ x: 1, y: 0, z: 0 });
    expect(secondBody.state.position).toEqual({ x: 2, y: 0, z: 0 });
    expect(firstEntry.collider).toBe(firstOld);
    expect(secondEntry.collider).toBe(secondOld);
    expect(removeCollider).toHaveBeenCalledWith(firstReplacement);
    expect(removeCollider).toHaveBeenCalledWith(secondReplacement);
    expect(removeCollider).not.toHaveBeenCalledWith(firstOld);
    expect(removeCollider).not.toHaveBeenCalledWith(secondOld);
    expect(getEditorPhysicsSyncCounters()).toEqual({
      poseSyncs: 4,
      colliderDescriptorBuilds: 2,
      colliderReplacements: 1,
    });
  });

  it("restores already-retired old colliders when a later retirement throws", () => {
    const root = new THREE.Group();
    const firstMesh = new THREE.Mesh(new THREE.BoxGeometry());
    const secondMesh = new THREE.Mesh(new THREE.BoxGeometry());
    root.add(firstMesh, secondMesh);
    const body = () => ({
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
    });
    const firstOld = { id: "first-old" };
    const secondOld = { id: "second-old" };
    const firstEntry = { mesh: firstMesh, body: body(), collider: firstOld };
    const secondEntry = { mesh: secondMesh, body: body(), collider: secondOld };
    const firstNew = { id: "first-new" };
    const secondNew = { id: "second-new" };
    const restoredFirst = { id: "first-restored" };
    const commitCollider = vi.fn((entry: typeof firstEntry, collider: typeof firstOld) => {
      entry.collider = collider;
    });
    const removeCollider = vi.fn((collider: typeof firstOld) => {
      if (collider === secondOld) throw new Error("second retirement failed");
    });
    const restoreFirst = vi.fn(() => restoredFirst);
    const restoreSecond = vi.fn(() => secondOld);
    const restoreCollider = vi.fn((entry: typeof firstEntry, old: typeof firstOld) => {
      if (entry === firstEntry) {
        expect(old).toBe(firstOld);
        return restoreFirst;
      }
      expect(old).toBe(secondOld);
      return restoreSecond;
    });

    const result = syncPhysicsSubtreeAtomically(root, [firstEntry, secondEntry], {
      shouldRebuildCollider: () => true,
      buildColliderDesc: () => ({}),
      createCollider: vi.fn().mockReturnValueOnce(firstNew).mockReturnValueOnce(secondNew),
      removeCollider,
      prepareColliderRestore: restoreCollider,
      commitCollider,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(restoreCollider).toHaveBeenCalledTimes(2);
    expect(restoreFirst).toHaveBeenCalledOnce();
    expect(restoreSecond).not.toHaveBeenCalled();
    expect(firstEntry.collider).toBe(restoredFirst);
    expect(secondEntry.collider).toBe(secondOld);
    expect(removeCollider).toHaveBeenCalledWith(firstNew);
    expect(removeCollider).toHaveBeenCalledWith(secondNew);
  });
});
