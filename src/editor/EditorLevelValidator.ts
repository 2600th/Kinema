import * as THREE from "three";
import { getBrushById } from "./brushes/index";
import type { LevelDataV2, SerializedObjectV2 } from "./LevelSerializer";

const SUPPORTED_PRIMITIVES = new Set(["group", "cube", "sphere", "cylinder", "capsule", "plane"]);
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

export function validateEditorLevelData(data: LevelDataV2): EditorLevelValidationResult {
  if (!Array.isArray(data.objects)) {
    return { ok: false, reason: "The level has no reconstructable object list." };
  }

  const objectsById = new Map<string, SerializedObjectV2>();
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
    if (entry.parentId !== null && !objectsById.has(entry.parentId)) {
      return {
        ok: false,
        reason: `Object "${entry.id}" references missing parent "${entry.parentId}".`,
      };
    }
  }

  const resolved = new Set<string>();
  for (const entry of data.objects) {
    if (resolved.has(entry.id)) continue;
    const path = new Set<string>();
    let current: SerializedObjectV2 | undefined = entry;
    while (current) {
      if (path.has(current.id)) {
        return { ok: false, reason: `The hierarchy contains a cycle at object "${current.id}".` };
      }
      if (resolved.has(current.id)) break;
      path.add(current.id);
      current = current.parentId ? objectsById.get(current.parentId) : undefined;
    }
    for (const id of path) resolved.add(id);
  }

  const worldMatrices = new Map<string, THREE.Matrix4>();
  const resolveWorldMatrix = (entry: SerializedObjectV2): THREE.Matrix4 => {
    const cached = worldMatrices.get(entry.id);
    if (cached) return cached;
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...entry.transform.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...entry.transform.rotation)),
      new THREE.Vector3(...entry.transform.scale),
    );
    const parent = entry.parentId ? objectsById.get(entry.parentId) : undefined;
    const world = parent ? resolveWorldMatrix(parent).clone().multiply(local) : local;
    worldMatrices.set(entry.id, world);
    return world;
  };

  for (const entry of data.objects) {
    const isTransformOnlyGroup = entry.source.type === "primitive" && entry.source.primitive === "group";
    if (isTransformOnlyGroup || entry.visible === false) continue;
    const world = resolveWorldMatrix(entry);
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

  return { ok: true };
}
