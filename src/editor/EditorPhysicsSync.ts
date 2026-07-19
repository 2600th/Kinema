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
