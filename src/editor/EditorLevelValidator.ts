import * as THREE from "three";
import { getBrushById } from "./brushes/index";
import { type LevelDataV2, type SerializedObjectV2, validateLevelDataV2Shape } from "./LevelSerializer";

const SUPPORTED_PRIMITIVES = new Set(["group", "box", "cube", "sphere", "cylinder", "capsule", "plane"]);
const MATRIX_EPSILON = 1e-6;

export type EditorLevelValidationResult = { ok: true } | { ok: false; reason: string };

function validateSource(entry: SerializedObjectV2): string | null {
  const source = entry.source as SerializedObjectV2["source"] | undefined;
  if (!source || typeof source.type !== "string") {
    return `Object "${entry.id}" has no reconstructable source.`;
  }

  if (source.type === "primitive") {
    if (!source.primitive || !SUPPORTED_PRIMITIVES.has(source.primitive)) {
      return `Object "${entry.id}" uses unsupported primitive "${source.primitive ?? "missing"}".`;
    }
    return null;
  }

  if (source.type === "brush") {
    if (!source.brush || !getBrushById(source.brush)) {
      return `Object "${entry.id}" uses unknown brush "${source.brush ?? "missing"}".`;
    }
    return null;
  }

  if (source.type === "glb") {
    if (typeof source.asset !== "string" || source.asset.trim().length === 0) {
      return `Object "${entry.id}" has no reconstructable GLB asset path.`;
    }
    return null;
  }

  return `Object "${entry.id}" uses unsupported source type "${source.type}".`;
}

function matrixHasNonUniformScale(matrix: THREE.Matrix4): boolean {
  const elements = matrix.elements;
  const sx = Math.hypot(elements[0], elements[1], elements[2]);
  const sy = Math.hypot(elements[4], elements[5], elements[6]);
  const sz = Math.hypot(elements[8], elements[9], elements[10]);
  const largest = Math.max(1, sx, sy, sz);
  return Math.abs(sx - sy) > MATRIX_EPSILON * largest || Math.abs(sx - sz) > MATRIX_EPSILON * largest;
}

export function validateEditorLevelData(untrustedData: unknown): EditorLevelValidationResult {
  try {
    const shape = validateLevelDataV2Shape(untrustedData);
    if (!shape.ok) return shape;
    const data = untrustedData as LevelDataV2;

    const objectsById = new Map<string, SerializedObjectV2>();
    const childrenByParent = new Map<string, SerializedObjectV2[]>();
    const roots: SerializedObjectV2[] = [];
    for (const entry of data.objects) {
      if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
        return { ok: false, reason: "The level contains an object with no id." };
      }
      if (objectsById.has(entry.id)) {
        return { ok: false, reason: `The level contains duplicate object id "${entry.id}".` };
      }
      const sourceError = validateSource(entry);
      if (sourceError) return { ok: false, reason: sourceError };
      objectsById.set(entry.id, entry);
    }

    for (const entry of data.objects) {
      if (entry.parentId === null) {
        roots.push(entry);
        continue;
      }
      if (!objectsById.has(entry.parentId)) {
        return {
          ok: false,
          reason: `Object "${entry.id}" references missing parent "${entry.parentId}".`,
        };
      }
      const children = childrenByParent.get(entry.parentId) ?? [];
      children.push(entry);
      childrenByParent.set(entry.parentId, children);
    }

    const worldMatrices = new Map<string, THREE.Matrix4>();
    const queue = [...roots];
    let cursor = 0;
    while (cursor < queue.length) {
      const entry = queue[cursor++];
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(...entry.transform.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...entry.transform.rotation)),
        new THREE.Vector3(...entry.transform.scale),
      );
      const parentWorld = entry.parentId ? worldMatrices.get(entry.parentId) : undefined;
      const world = parentWorld ? parentWorld.clone().multiply(local) : local;
      worldMatrices.set(entry.id, world);

      const isTransformOnlyGroup = entry.source.type === "primitive" && entry.source.primitive === "group";
      if (!isTransformOnlyGroup) {
        if (
          parentWorld &&
          (entry.physics.type === "dynamic" || entry.physics.type === "kinematic") &&
          matrixHasNonUniformScale(parentWorld)
        ) {
          return {
            ok: false,
            reason: `Object "${entry.id}" is a moving ${entry.physics.type} body below non-uniform inherited scale, which physics cannot represent exactly.`,
          };
        }
        if (entry.visible !== false) {
          const position = new THREE.Vector3();
          const rotation = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          world.decompose(position, rotation, scale);
          const recomposed = new THREE.Matrix4().compose(position, rotation, scale);
          if (world.elements.some((value, index) => Math.abs(value - recomposed.elements[index]) > MATRIX_EPSILON)) {
            return {
              ok: false,
              reason: `Object "${entry.id}" has a rotated child transform under non-uniform inherited scale, which physics cannot represent exactly.`,
            };
          }
        }
      }

      for (const child of childrenByParent.get(entry.id) ?? []) queue.push(child);
    }

    if (worldMatrices.size !== data.objects.length) {
      const cyclic = data.objects.find((entry) => !worldMatrices.has(entry.id));
      return { ok: false, reason: `The hierarchy contains a cycle at object "${cyclic?.id ?? "unknown"}".` };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: "The level contains malformed semantic data.",
    };
  }
}
