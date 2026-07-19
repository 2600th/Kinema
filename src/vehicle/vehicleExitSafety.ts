import { DEFAULT_PLAYER_CONFIG } from "@core/constants";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type * as THREE from "three";

const _exitPosition = new RAPIER.Vector3(0, 0, 0);
const _exitDirection = new RAPIER.Vector3(0, 0, 0);
const _exitRotation = new RAPIER.Quaternion(0, 0, 0, 1);
const _playerExitShape = new RAPIER.Capsule(
  DEFAULT_PLAYER_CONFIG.capsuleHalfHeight,
  DEFAULT_PLAYER_CONFIG.capsuleRadius,
);

export const PLAYER_EXIT_CAPSULE_HALF_EXTENT =
  DEFAULT_PLAYER_CONFIG.capsuleHalfHeight + DEFAULT_PLAYER_CONFIG.capsuleRadius;

export function pickFirstClearVehicleExitCandidate(
  candidates: readonly THREE.Vector3[],
  isClear: (candidate: THREE.Vector3) => boolean,
): THREE.Vector3 | null {
  for (const candidate of candidates) {
    if (isClear(candidate)) return candidate.clone();
  }
  return null;
}

export function findFirstClearVerticalExitCandidate(
  base: THREE.Vector3,
  startY: number,
  isClear: (candidate: THREE.Vector3) => boolean,
  isPathClear: (candidate: THREE.Vector3) => boolean = () => true,
  step = 0.5,
  attempts = 256,
): THREE.Vector3 {
  const candidate = base.clone();
  for (let index = 0; index < attempts; index++) {
    candidate.y = startY + index * step;
    if (isClear(candidate) && isPathClear(candidate)) return candidate.clone();
  }
  throw new Error("No capsule-clear vertical vehicle exit was found.");
}

export function isVehicleExitCandidateClear(
  physicsWorld: PhysicsWorld,
  candidate: THREE.Vector3,
  excludedBodies: readonly (RAPIER.RigidBody | null | undefined)[],
): boolean {
  _exitPosition.x = candidate.x;
  _exitPosition.y = candidate.y;
  _exitPosition.z = candidate.z;
  return !physicsWorld.intersectsShape(
    _exitPosition,
    _exitRotation,
    _playerExitShape,
    undefined,
    undefined,
    (collider) => {
      if (collider.isSensor()) return false;
      const parent = collider.parent();
      if (!parent) return true;
      return !excludedBodies.some((body) => body?.handle === parent.handle);
    },
  );
}

export function isVehicleExitPathClear(
  physicsWorld: PhysicsWorld,
  origin: THREE.Vector3,
  candidate: THREE.Vector3,
  excludedBodies: readonly (RAPIER.RigidBody | null | undefined)[],
): boolean {
  const dx = candidate.x - origin.x;
  const dy = candidate.y - origin.y;
  const dz = candidate.z - origin.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.001) return true;

  _exitPosition.x = origin.x;
  _exitPosition.y = origin.y;
  _exitPosition.z = origin.z;
  _exitDirection.x = dx / distance;
  _exitDirection.y = dy / distance;
  _exitDirection.z = dz / distance;
  const filterPredicate = (collider: RAPIER.Collider): boolean => {
    if (collider.isSensor()) return false;
    const parent = collider.parent();
    if (!parent) return true;
    return !excludedBodies.some((body) => body?.handle === parent.handle);
  };
  return !physicsWorld.castShape(
    _exitPosition,
    _exitRotation,
    _exitDirection,
    _playerExitShape,
    0,
    distance,
    undefined,
    undefined,
    undefined,
    filterPredicate,
  );
}

export function isVehicleExitGroundSupported(
  physicsWorld: PhysicsWorld,
  candidate: THREE.Vector3,
  excludedBodies: readonly (RAPIER.RigidBody | null | undefined)[],
): boolean {
  const radius = DEFAULT_PLAYER_CONFIG.capsuleRadius * 0.9;
  const offsets = [
    [0, 0],
    [-radius, 0],
    [radius, 0],
    [0, -radius],
    [0, radius],
  ] as const;
  _exitDirection.x = 0;
  _exitDirection.y = -1;
  _exitDirection.z = 0;
  for (const [offsetX, offsetZ] of offsets) {
    _exitPosition.x = candidate.x + offsetX;
    _exitPosition.y = candidate.y;
    _exitPosition.z = candidate.z + offsetZ;
    const hit = physicsWorld.castRay(
      _exitPosition,
      _exitDirection,
      PLAYER_EXIT_CAPSULE_HALF_EXTENT + 0.6,
      undefined,
      undefined,
      (collider) => {
        if (collider.isSensor()) return false;
        const parent = collider.parent();
        if (!parent) return true;
        return !excludedBodies.some((body) => body?.handle === parent.handle);
      },
    );
    if (!hit) return false;
  }
  return true;
}
