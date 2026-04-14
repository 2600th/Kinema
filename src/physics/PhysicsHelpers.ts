import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

// Pre-allocated temp objects to avoid GC pressure in hot paths
const _tempVec3 = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();

/** Convert THREE.Vector3 → Rapier vector */
export function toRapierVec(v: THREE.Vector3): RAPIER.Vector3 {
  return new RAPIER.Vector3(v.x, v.y, v.z);
}

/** Convert Rapier vector → THREE.Vector3 (reuses temp) */
export function toThreeVec(v: RAPIER.Vector3): THREE.Vector3 {
  return _tempVec3.set(v.x, v.y, v.z);
}

/** Convert Rapier vector → new THREE.Vector3 (creates new) */
export function toThreeVecNew(v: RAPIER.Vector3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** Convert THREE.Quaternion → Rapier quaternion */
export function toRapierQuat(q: THREE.Quaternion): RAPIER.Quaternion {
  return new RAPIER.Quaternion(q.x, q.y, q.z, q.w);
}

/** Convert Rapier quaternion → THREE.Quaternion (reuses temp) */
export function toThreeQuat(q: RAPIER.Quaternion): THREE.Quaternion {
  return _tempQuat.set(q.x, q.y, q.z, q.w);
}

/** Convert Rapier quaternion → new THREE.Quaternion */
export function toThreeQuatNew(q: RAPIER.Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}
