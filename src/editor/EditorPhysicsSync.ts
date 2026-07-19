import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

type WorldPoseBody = Pick<RAPIER.RigidBody, "setTranslation" | "setRotation">;

export function syncRigidBodyToObjectWorldPose(object: THREE.Object3D, body: WorldPoseBody): void {
  object.updateWorldMatrix(true, false);
  const position = object.getWorldPosition(new THREE.Vector3());
  const rotation = object.getWorldQuaternion(new THREE.Quaternion());
  body.setTranslation(new RAPIER.Vector3(position.x, position.y, position.z), true);
  body.setRotation(new RAPIER.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), true);
}
