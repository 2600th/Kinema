import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

type WorldPoseBody = Pick<RAPIER.RigidBody, "setTranslation" | "setRotation"> &
  Partial<Pick<RAPIER.RigidBody, "translation" | "rotation">>;

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

const editorPhysicsSyncCounters = {
  poseSyncs: 0,
  colliderDescriptorBuilds: 0,
  colliderReplacements: 0,
};

export type EditorPhysicsSyncCounters = Readonly<typeof editorPhysicsSyncCounters>;

export function getEditorPhysicsSyncCounters(): EditorPhysicsSyncCounters {
  return { ...editorPhysicsSyncCounters };
}

export function resetEditorPhysicsSyncCounters(): void {
  editorPhysicsSyncCounters.poseSyncs = 0;
  editorPhysicsSyncCounters.colliderDescriptorBuilds = 0;
  editorPhysicsSyncCounters.colliderReplacements = 0;
}

export function effectiveScaleChanged(before: THREE.Vector3, after: THREE.Vector3, epsilon = 1e-6): boolean {
  return (
    Math.abs(before.x - after.x) > epsilon ||
    Math.abs(before.y - after.y) > epsilon ||
    Math.abs(before.z - after.z) > epsilon
  );
}

export type PhysicsTransformValidationResult = { ok: true } | { ok: false; reason: string };

export type AtomicPhysicsResourceSnapshot<TBody, TCollider, TTracking> = Readonly<{
  body?: TBody;
  collider?: TCollider;
  tracking: TTracking;
}>;

export type AtomicPhysicsReplacementOptions<TBody, TCollider, TTracking> = {
  createBody(): TBody | undefined;
  createCollider(body: TBody | undefined): TCollider | undefined;
  createTracking(body: TBody | undefined, collider: TCollider | undefined): TTracking;
  publishReplacement(replacement: AtomicPhysicsResourceSnapshot<TBody, TCollider, TTracking>): void;
  restoreCurrent(current: AtomicPhysicsResourceSnapshot<TBody, TCollider, TTracking>): void;
  retireCurrent(current: AtomicPhysicsResourceSnapshot<TBody, TCollider, TTracking>): void;
  removeBody(body: TBody): void;
  removeCollider(collider: TCollider): void;
  isCurrentLive?(current: AtomicPhysicsResourceSnapshot<TBody, TCollider, TTracking>): boolean;
  recreateCurrent?(): AtomicPhysicsResourceSnapshot<TBody, TCollider, TTracking>;
};

function physicsReplacementFailure(phase: string, error: unknown): { ok: false; reason: string } {
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, reason: `Physics ${phase} failed. ${detail}` };
}

export function replacePhysicsResourcesAtomically<TBody, TCollider, TTracking>(
  current: AtomicPhysicsResourceSnapshot<TBody, TCollider, TTracking>,
  options: AtomicPhysicsReplacementOptions<TBody, TCollider, TTracking>,
): PhysicsTransformValidationResult {
  let body: TBody | undefined;
  let collider: TCollider | undefined;
  let removed = false;
  const removeReplacement = (): unknown => {
    if (removed) return undefined;
    removed = true;
    try {
      if (body !== undefined) options.removeBody(body);
      else if (collider !== undefined) options.removeCollider(collider);
      return undefined;
    } catch (error) {
      return error;
    }
  };
  const failWithRollback = (
    phase: string,
    error: unknown,
    restorePublishedCurrent: boolean,
  ): PhysicsTransformValidationResult => {
    const rollbackFailures: string[] = [];
    if (restorePublishedCurrent) {
      let rollbackCurrent = current;
      if (options.isCurrentLive && !options.isCurrentLive(current)) {
        if (!options.recreateCurrent) {
          rollbackFailures.push("current resources were destroyed and no recreation recipe was available");
        } else {
          try {
            rollbackCurrent = options.recreateCurrent();
          } catch (recreationError) {
            rollbackFailures.push(`resource recreation failed: ${describePhysicsFailure(recreationError)}`);
          }
        }
      }
      if (rollbackFailures.length === 0) {
        try {
          options.restoreCurrent(rollbackCurrent);
        } catch (restorationError) {
          rollbackFailures.push(`restoration failed: ${describePhysicsFailure(restorationError)}`);
        }
      }
    }
    const cleanupError = removeReplacement();
    if (cleanupError !== undefined) {
      rollbackFailures.push(`cleanup failed: ${describePhysicsFailure(cleanupError)}`);
    }
    const primary = physicsReplacementFailure(phase, error);
    if (rollbackFailures.length === 0) return primary;
    return { ok: false, reason: `${primary.reason} Rollback ${rollbackFailures.join("; ")}.` };
  };

  try {
    body = options.createBody();
  } catch (error) {
    return physicsReplacementFailure("body allocation", error);
  }
  try {
    collider = options.createCollider(body);
  } catch (error) {
    return failWithRollback("collider creation", error, false);
  }

  let tracking: TTracking;
  try {
    tracking = options.createTracking(body, collider);
  } catch (error) {
    return failWithRollback("tracking preparation", error, false);
  }
  const replacement = Object.freeze({ body, collider, tracking });
  try {
    options.publishReplacement(replacement);
  } catch (error) {
    return failWithRollback("publication", error, true);
  }
  try {
    options.retireCurrent(current);
  } catch (error) {
    return failWithRollback("old-resource retirement", error, true);
  }
  return { ok: true };
}

function describePhysicsFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
      return {
        ok: false,
        reason: "This hierarchy edit would create a sheared local transform that cannot be preserved exactly.",
      };
    }
    if ((physicsType === "dynamic" || physicsType === "kinematic") && matrixHasNonUniformScale(targetParentWorld)) {
      return {
        ok: false,
        reason: `Moving ${physicsType} physics cannot be parented below non-uniform inherited scale.`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The hierarchy transform is not representable.",
    };
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
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The physics transform is not representable.",
    };
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
  if (
    object.matrixWorld.elements.some((value, index) => Math.abs(value - recomposed.elements[index]) > MATRIX_EPSILON)
  ) {
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
  shouldRebuildCollider(entry: TEntry, nextPose: ObjectWorldPhysicsPose): boolean;
  buildColliderDesc(entry: TEntry): TColliderDesc;
  createCollider(desc: TColliderDesc, body: WorldPoseBody): TCollider;
  removeCollider(collider: TCollider): void;
  prepareColliderRestore?(entry: TEntry, collider: TCollider): () => TCollider;
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
    previousPose?: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number; w: number };
    };
  }> = [];

  const retired = new Set<TCollider>();
  try {
    for (const entry of entries) {
      if (!entry.body || !nodes.has(entry.mesh)) continue;
      const pose = getObjectWorldPhysicsPose(entry.mesh);
      let colliderDesc: TColliderDesc | undefined;
      if (entry.collider && options.shouldRebuildCollider(entry, pose)) {
        colliderDesc = options.buildColliderDesc(entry);
        if (import.meta.env.DEV) editorPhysicsSyncCounters.colliderDescriptorBuilds++;
      }
      prepared.push({
        entry,
        body: entry.body,
        pose,
        ...(entry.body.translation && entry.body.rotation
          ? {
              previousPose: {
                position: { ...entry.body.translation() },
                rotation: { ...entry.body.rotation() },
              },
            }
          : {}),
        ...(colliderDesc === undefined ? {} : { colliderDesc }),
      });
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Physics preparation failed." };
  }

  const replacements: Array<{
    entry: TEntry;
    collider: TCollider;
    oldCollider: TCollider;
    restore?: () => TCollider;
  }> = [];
  try {
    for (const item of prepared) {
      if (item.colliderDesc === undefined) continue;
      replacements.push({
        entry: item.entry,
        collider: options.createCollider(item.colliderDesc, item.body),
        oldCollider: item.entry.collider as TCollider,
      });
    }
  } catch (error) {
    for (const replacement of replacements) options.removeCollider(replacement.collider);
    return { ok: false, reason: error instanceof Error ? error.message : "Collider replacement failed." };
  }
  try {
    for (const replacement of replacements) {
      replacement.restore = options.prepareColliderRestore?.(replacement.entry, replacement.oldCollider);
    }
  } catch (error) {
    for (const replacement of replacements) options.removeCollider(replacement.collider);
    return { ok: false, reason: error instanceof Error ? error.message : "Collider rollback preparation failed." };
  }

  try {
    for (const item of prepared) {
      item.body.setTranslation(
        new RAPIER.Vector3(item.pose.position.x, item.pose.position.y, item.pose.position.z),
        true,
      );
      item.body.setRotation(
        new RAPIER.Quaternion(item.pose.rotation.x, item.pose.rotation.y, item.pose.rotation.z, item.pose.rotation.w),
        true,
      );
      if (import.meta.env.DEV) editorPhysicsSyncCounters.poseSyncs++;
    }
    // Publish tracking only after all poses and replacement colliders exist.
    // Old colliders stay live until every tracking update has succeeded.
    for (const replacement of replacements) {
      options.commitCollider(replacement.entry, replacement.collider);
      if (import.meta.env.DEV) editorPhysicsSyncCounters.colliderReplacements++;
    }
    for (const replacement of replacements) {
      options.removeCollider(replacement.oldCollider);
      retired.add(replacement.oldCollider);
    }
    return { ok: true };
  } catch {
    for (const item of prepared) {
      if (!item.previousPose) continue;
      try {
        item.body.setTranslation(item.previousPose.position as RAPIER.Vector, true);
        item.body.setRotation(item.previousPose.rotation as RAPIER.Rotation, true);
        if (import.meta.env.DEV) editorPhysicsSyncCounters.poseSyncs++;
      } catch {
        // Continue rolling back the remaining independently owned resources.
      }
    }
    for (const replacement of replacements) {
      try {
        const rollbackCollider = retired.has(replacement.oldCollider)
          ? replacement.restore?.()
          : replacement.oldCollider;
        if (rollbackCollider) options.commitCollider(replacement.entry, rollbackCollider);
      } catch {
        // Best effort for an external tracking callback that is itself failing.
      }
      try {
        options.removeCollider(replacement.collider);
      } catch {
        // Continue rolling back the remaining replacements.
      }
    }
    return { ok: false, reason: "Physics commit failed; the previous state was restored." };
  }
}
