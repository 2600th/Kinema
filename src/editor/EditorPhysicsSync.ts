import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

type WorldPoseBody = Pick<RAPIER.RigidBody, "setTranslation" | "setRotation">;

export type ObjectWorldPhysicsPose = Readonly<{
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
}>;

export type ObjectColliderBounds = Readonly<{
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;
}>;

const MATRIX_EPSILON = 1e-6;

export type PhysicsTransformValidationResult = { ok: true } | { ok: false; reason: string };

export function matrixHasNonUniformScale(matrix: THREE.Matrix4): boolean {
  const elements = matrix.elements;
  const sx = Math.hypot(elements[0], elements[1], elements[2]);
  const sy = Math.hypot(elements[4], elements[5], elements[6]);
  const sz = Math.hypot(elements[8], elements[9], elements[10]);
  const largest = Math.max(1, sx, sy, sz);
  return Math.abs(sx - sy) > MATRIX_EPSILON * largest || Math.abs(sx - sz) > MATRIX_EPSILON * largest;
}

export function matrixCanDecomposeExactly(matrix: THREE.Matrix4): boolean {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  const recomposed = new THREE.Matrix4().compose(position, rotation, scale);
  return matrix.elements.every((value, index) => Math.abs(value - recomposed.elements[index]) <= MATRIX_EPSILON);
}

/** Validate exact world-pose preservation under a prospective parent matrix. */
export function validateWorldMatrixAttachment(
  objectWorld: THREE.Matrix4,
  targetParentWorld: THREE.Matrix4,
  physicsType: "static" | "dynamic" | "kinematic",
): PhysicsTransformValidationResult {
  try {
    const prospectiveLocal = targetParentWorld.clone().invert().multiply(objectWorld);
    if (!matrixCanDecomposeExactly(prospectiveLocal)) {
      return { ok: false, reason: "This hierarchy edit would create a sheared local transform that cannot be preserved exactly." };
    }
    if (
      (physicsType === "dynamic" || physicsType === "kinematic") &&
      matrixHasNonUniformScale(targetParentWorld)
    ) {
      return {
        ok: false,
        reason: `Moving ${physicsType} physics cannot be parented below non-uniform inherited scale.`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The hierarchy transform is not representable." };
  }
}

export function validateObjectPhysicsTransform(
  object: THREE.Object3D,
  physicsType: "static" | "dynamic" | "kinematic",
): PhysicsTransformValidationResult {
  try {
    object.updateWorldMatrix(true, true);
    getObjectWorldPhysicsPose(object);
    if (
      (physicsType === "dynamic" || physicsType === "kinematic") &&
      object.parent &&
      matrixHasNonUniformScale(object.parent.matrixWorld)
    ) {
      return {
        ok: false,
        reason: `Moving ${physicsType} physics cannot be parented below non-uniform inherited scale.`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The physics transform is not representable." };
  }
}

/** Validate a prospective attach without mutating the scene graph. */
export function validatePhysicsAttachment(
  object: THREE.Object3D,
  newParent: THREE.Object3D,
  physicsType: "static" | "dynamic" | "kinematic",
): PhysicsTransformValidationResult {
  object.updateWorldMatrix(true, true);
  newParent.updateWorldMatrix(true, false);
  return validateWorldMatrixAttachment(object.matrixWorld, newParent.matrixWorld, physicsType);
}

export function getObjectWorldPhysicsPose(object: THREE.Object3D): ObjectWorldPhysicsPose {
  object.updateWorldMatrix(true, true);
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  object.matrixWorld.decompose(position, rotation, scale);

  // Rapier bodies have translation, rotation, and scale baked into collider
  // shapes, but no shear. A rotated child below non-uniform inherited scale
  // produces shear and therefore has no exact Rapier representation.
  const recomposed = new THREE.Matrix4().compose(position, rotation, scale);
  if (object.matrixWorld.elements.some((value, index) => Math.abs(value - recomposed.elements[index]) > MATRIX_EPSILON)) {
    throw new Error("Physics does not support a rotated child under non-uniform inherited scale.");
  }
  return { position, rotation, scale };
}

export function getObjectColliderBounds(object: THREE.Object3D): ObjectColliderBounds {
  const { scale } = getObjectWorldPhysicsPose(object);
  const localBounds = new THREE.Box3();
  const childBounds = new THREE.Box3();
  const inverseRoot = object.matrixWorld.clone().invert();
  const childLocalMatrix = new THREE.Matrix4();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;
    child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) return;
    childBounds.copy(child.geometry.boundingBox);
    childLocalMatrix.multiplyMatrices(inverseRoot, child.matrixWorld);
    childBounds.applyMatrix4(childLocalMatrix);
    localBounds.union(childBounds);
  });
  if (localBounds.isEmpty()) {
    localBounds.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  }

  const center = localBounds.getCenter(new THREE.Vector3()).multiply(scale);
  const halfExtents = localBounds
    .getSize(new THREE.Vector3())
    .multiply(new THREE.Vector3(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)))
    .multiplyScalar(0.5);
  return { center, halfExtents };
}

export function applyWorldPoseToObject(
  object: THREE.Object3D,
  worldPosition: THREE.Vector3,
  worldRotation: THREE.Quaternion,
): void {
  const parent = object.parent;
  if (!parent) {
    object.position.copy(worldPosition);
    object.quaternion.copy(worldRotation);
    return;
  }
  parent.updateWorldMatrix(true, false);
  object.position.copy(worldPosition);
  parent.worldToLocal(object.position);
  parent.getWorldQuaternion(object.quaternion);
  object.quaternion.invert().multiply(worldRotation);
}

export function syncRigidBodyToObjectWorldPose(object: THREE.Object3D, body: WorldPoseBody): void {
  const { position, rotation } = getObjectWorldPhysicsPose(object);
  body.setTranslation(new RAPIER.Vector3(position.x, position.y, position.z), true);
  body.setRotation(new RAPIER.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), true);
}

export function syncRigidBodiesInSubtree(
  root: THREE.Object3D,
  entries: readonly { mesh: THREE.Object3D; body?: WorldPoseBody }[],
): void {
  const nodes = new Set<THREE.Object3D>();
  root.traverse((node) => nodes.add(node));
  for (const entry of entries) {
    if (entry.body && nodes.has(entry.mesh)) syncRigidBodyToObjectWorldPose(entry.mesh, entry.body);
  }
}

export type AtomicPhysicsSyncEntry<TCollider> = {
  mesh: THREE.Object3D;
  body?: WorldPoseBody;
  collider?: TCollider;
};

export type AtomicPhysicsSyncOptions<TEntry, TCollider, TColliderDesc> = {
  rebuildColliders: boolean;
  buildColliderDesc(entry: TEntry): TColliderDesc;
  createCollider(desc: TColliderDesc, body: WorldPoseBody): TCollider;
  removeCollider(collider: TCollider): void;
  commitCollider(entry: TEntry, replacement: TCollider): void;
};

/**
 * Prepares every pose/descriptor and creates every replacement collider before
 * mutating a body or removing an old collider. A failed preparation therefore
 * leaves the previous physics subtree intact.
 */
export function syncPhysicsSubtreeAtomically<
  TCollider,
  TColliderDesc,
  TEntry extends AtomicPhysicsSyncEntry<TCollider>,
>(
  root: THREE.Object3D,
  entries: readonly TEntry[],
  options: AtomicPhysicsSyncOptions<TEntry, TCollider, TColliderDesc>,
): PhysicsTransformValidationResult {
  const nodes = new Set<THREE.Object3D>();
  root.traverse((node) => nodes.add(node));
  const prepared: Array<{
    entry: TEntry;
    body: WorldPoseBody;
    pose: ObjectWorldPhysicsPose;
    colliderDesc?: TColliderDesc;
  }> = [];

  try {
    for (const entry of entries) {
      if (!entry.body || !nodes.has(entry.mesh)) continue;
      prepared.push({
        entry,
        body: entry.body,
        pose: getObjectWorldPhysicsPose(entry.mesh),
        ...(options.rebuildColliders && entry.collider
          ? { colliderDesc: options.buildColliderDesc(entry) }
          : {}),
      });
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Physics preparation failed." };
  }

  const replacements: Array<{ entry: TEntry; collider: TCollider }> = [];
  try {
    for (const item of prepared) {
      if (item.colliderDesc === undefined) continue;
      replacements.push({
        entry: item.entry,
        collider: options.createCollider(item.colliderDesc, item.body),
      });
    }
  } catch (error) {
    for (const replacement of replacements) options.removeCollider(replacement.collider);
    return { ok: false, reason: error instanceof Error ? error.message : "Collider replacement failed." };
  }

  for (const item of prepared) {
    item.body.setTranslation(new RAPIER.Vector3(item.pose.position.x, item.pose.position.y, item.pose.position.z), true);
    item.body.setRotation(
      new RAPIER.Quaternion(item.pose.rotation.x, item.pose.rotation.y, item.pose.rotation.z, item.pose.rotation.w),
      true,
    );
  }
  for (const replacement of replacements) {
    const oldCollider = replacement.entry.collider;
    if (oldCollider) options.removeCollider(oldCollider);
    options.commitCollider(replacement.entry, replacement.collider);
  }
  return { ok: true };
}
