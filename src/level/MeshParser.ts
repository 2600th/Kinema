import * as THREE from 'three';

export type ParsedNodeType = 'visual' | 'collider' | 'sensor' | 'navmesh' | 'spawnpoint';

/** Parsed result for a single scene node. */
export interface ParsedNode {
  object: THREE.Object3D;
  mesh: THREE.Mesh | null;
  type: ParsedNodeType;
  mass: number | null;
}

type UserDataRecord = Record<string, unknown>;

function getTypeFromUserData(userData: UserDataRecord): ParsedNodeType | null {
  if (userData.isSpawnPoint === true || userData.spawnPoint === true || userData.type === 'spawnpoint') {
    return 'spawnpoint';
  }
  if (userData.isCollider === true || userData.type === 'collider') {
    return 'collider';
  }
  if (userData.isSensor === true || userData.type === 'sensor') {
    return 'sensor';
  }
  if (userData.isNavmesh === true || userData.type === 'navmesh') {
    return 'navmesh';
  }
  return null;
}

function getTypeFromName(name: string): ParsedNodeType | null {
  const lower = name.toLowerCase();
  if (lower.includes('spawnpoint')) return 'spawnpoint';
  if (lower.includes('_col')) return 'collider';
  if (lower.includes('_sensor')) return 'sensor';
  if (lower.includes('_nav')) return 'navmesh';
  return null;
}

function getMassFromUserData(userData: UserDataRecord): number | null {
  const rawMass = userData.mass;
  return typeof rawMass === 'number' && Number.isFinite(rawMass) ? rawMass : null;
}

/**
 * Parses scene nodes using userData metadata:
 * - `isCollider: true` -> static collider
 * - `isSensor: true` -> trigger/sensor
 * - `isNavmesh: true` -> navmesh (future)
 * - `isSpawnPoint: true` -> player spawn
 *
 * Legacy name-based tags are still accepted as a fallback.
 */
export class MeshParser {
  /** Parse a scene graph and classify each relevant node. */
  parse(root: THREE.Object3D): ParsedNode[] {
    const results: ParsedNode[] = [];
    root.traverse((child) => {
      const userData = (child.userData ?? {}) as UserDataRecord;
      const typedByUserData = getTypeFromUserData(userData);
      const typedByName = getTypeFromName(child.name);
      const resolvedType = typedByUserData ?? typedByName;
      const mass = getMassFromUserData(userData);

      if (resolvedType === 'spawnpoint') {
        results.push({
          object: child,
          mesh: child instanceof THREE.Mesh ? child : null,
          type: 'spawnpoint',
          mass,
        });
        return;
      }

      if (!(child instanceof THREE.Mesh)) return;

      results.push({
        object: child,
        mesh: child,
        type: resolvedType ?? 'visual',
        mass,
      });
    });

    return results;
  }
}
