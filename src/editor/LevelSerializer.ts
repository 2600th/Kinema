import type { EditorObject } from "./EditorObject";

/* ======================================================================
 *  V1 types (legacy - kept for migration)
 * ====================================================================== */

export interface LevelDataV1 {
  version: 1;
  name: string;
  spawnPoint: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  environment: { hdr: string; intensity: number; blur: number };
  objects: SerializedObjectV1[];
}

export interface SerializedObjectV1 {
  id: string;
  name: string;
  source: {
    type: "primitive" | "glb" | "sprite" | "brush";
    asset?: string;
    primitive?: string;
    brush?: string;
  };
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  physics?: {
    type: "static" | "dynamic" | "kinematic";
    mass?: number;
    shape: string;
  };
  userData?: Record<string, unknown>;
}

/* ======================================================================
 *  V2 types (current)
 * ====================================================================== */

export interface SpawnPointEntry {
  tag: string;
  position: [number, number, number];
  rotation?: [number, number, number];
}

export interface LevelDataV2 {
  version: 2;
  name: string;
  created: string;
  modified: string;
  /** Legacy single spawn - kept for backwards compat. */
  spawnPoint: { position: [number, number, number]; rotation?: [number, number, number] };
  /** Tagged spawn points array (preferred over spawnPoint when present). */
  spawnPoints?: SpawnPointEntry[];
  objects: SerializedObjectV2[];
}

export interface SerializedObjectV2 {
  id: string;
  name: string;
  parentId: string | null;
  visible?: boolean;
  locked?: boolean;
  spawnTag?: string;
  source: {
    type: "primitive" | "glb" | "sprite" | "brush";
    asset?: string;
    primitive?: string;
    brush?: string;
  };
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  physics: { type: "static" | "dynamic" | "kinematic" };
  material?: {
    color: string;
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
  };
  brushParams?: Record<string, number>;
}

/** Public alias - always points to the latest format. */
export type LevelData = LevelDataV2;
export type SerializedObject = SerializedObjectV2;

export type LevelDataShapeValidationResult = { ok: true } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function validateSpawnPoint(value: unknown, label: string): string | null {
  if (!isRecord(value) || !isFiniteVec3(value.position)) return `${label} must contain a finite three-number position.`;
  if (value.rotation !== undefined && !isFiniteVec3(value.rotation)) {
    return `${label} rotation must contain exactly three finite numbers.`;
  }
  return null;
}

function validateSerializedObjectShape(value: unknown, index: number): string | null {
  if (!isRecord(value)) return `Object entry ${index} must be an object.`;
  const id = typeof value.id === "string" ? value.id : `entry ${index}`;
  if (typeof value.id !== "string" || value.id.length === 0) return `Object entry ${index} has no valid id.`;
  if (typeof value.name !== "string") return `Object "${id}" has no valid name.`;
  if (value.parentId !== null && typeof value.parentId !== "string") return `Object "${id}" has an invalid parent id.`;
  if (value.visible !== undefined && typeof value.visible !== "boolean") return `Object "${id}" has invalid visibility.`;
  if (value.locked !== undefined && typeof value.locked !== "boolean") return `Object "${id}" has invalid lock state.`;
  if (value.spawnTag !== undefined && typeof value.spawnTag !== "string") return `Object "${id}" has an invalid spawn tag.`;

  if (!isRecord(value.source) || typeof value.source.type !== "string") return `Object "${id}" has a malformed source.`;
  for (const key of ["asset", "primitive", "brush"] as const) {
    if (value.source[key] !== undefined && typeof value.source[key] !== "string") {
      return `Object "${id}" has a malformed source ${key}.`;
    }
  }

  if (!isRecord(value.transform)) return `Object "${id}" has no transform.`;
  for (const key of ["position", "rotation", "scale"] as const) {
    if (!isFiniteVec3(value.transform[key])) return `Object "${id}" ${key} must contain exactly three finite numbers.`;
  }

  if (!isRecord(value.physics) || !["static", "dynamic", "kinematic"].includes(String(value.physics.type))) {
    return `Object "${id}" has an invalid physics type.`;
  }

  if (value.material !== undefined) {
    if (!isRecord(value.material)) return `Object "${id}" has malformed material data.`;
    for (const key of ["color", "emissive"] as const) {
      if (typeof value.material[key] !== "string") return `Object "${id}" has malformed material ${key}.`;
    }
    for (const key of ["roughness", "metalness", "emissiveIntensity", "opacity"] as const) {
      if (typeof value.material[key] !== "number" || !Number.isFinite(value.material[key])) {
        return `Object "${id}" has malformed material ${key}.`;
      }
    }
  }

  if (value.brushParams !== undefined) {
    if (!isRecord(value.brushParams)) return `Object "${id}" has malformed brush parameters.`;
    if (Object.values(value.brushParams).some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
      return `Object "${id}" has non-finite brush parameters.`;
    }
  }
  return null;
}

/** Total structural validation for untrusted V2 data. Never throws. */
export function validateLevelDataV2Shape(data: unknown): LevelDataShapeValidationResult {
  try {
    if (!isRecord(data) || data.version !== 2) return { ok: false, reason: "The level is not V2 data." };
    if (typeof data.name !== "string") return { ok: false, reason: "The level has no valid name." };
    if (typeof data.created !== "string" || typeof data.modified !== "string") {
      return { ok: false, reason: "The level has invalid timestamps." };
    }
    const spawnError = validateSpawnPoint(data.spawnPoint, "The level spawn point");
    if (spawnError) return { ok: false, reason: spawnError };
    if (data.spawnPoints !== undefined) {
      if (!Array.isArray(data.spawnPoints)) return { ok: false, reason: "The level spawn-point list is malformed." };
      for (const [index, spawn] of data.spawnPoints.entries()) {
        if (!isRecord(spawn) || typeof spawn.tag !== "string") {
          return { ok: false, reason: `Spawn point ${index} has no valid tag.` };
        }
        const error = validateSpawnPoint(spawn, `Spawn point ${index}`);
        if (error) return { ok: false, reason: error };
      }
    }
    if (!Array.isArray(data.objects)) return { ok: false, reason: "The level has no reconstructable object list." };
    for (const [index, entry] of data.objects.entries()) {
      const error = validateSerializedObjectShape(entry, index);
      if (error) return { ok: false, reason: error };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "The level contains malformed V2 data." };
  }
}

/* ======================================================================
 *  Serializer
 * ====================================================================== */

/* ------------------------------------------------------------------ */
/*  Serialize editor state to v2 JSON                                 */
/* ------------------------------------------------------------------ */

export function serialize(name: string, objects: EditorObject[], existingCreated?: string): LevelDataV2 {
  const now = new Date().toISOString();

  const spawnObjects = objects.filter((obj) => obj.source.type === "brush" && obj.source.brush === "spawn");
  const spawnPoints: SpawnPointEntry[] = spawnObjects.map((obj) => ({
    tag: obj.spawnTag ?? "player",
    position: [...obj.transform.position],
    ...(obj.transform.rotation.some((value) => value !== 0) && {
      rotation: [...obj.transform.rotation] as [number, number, number],
    }),
  }));

  const playerSpawns = spawnPoints.filter((spawn) => spawn.tag === "player");
  if (playerSpawns.length > 1) {
    console.warn(
      `[LevelSerializer] ${playerSpawns.length} player spawn points found - only the first will be used as the player spawn.`,
    );
  }

  const primarySpawn = playerSpawns[0] ?? spawnPoints[0];
  const spawnPosition: [number, number, number] = primarySpawn?.position ?? [0, 2, 0];
  const spawnRotation = primarySpawn?.rotation;

  return {
    version: 2,
    name,
    created: existingCreated ?? now,
    modified: now,
    spawnPoint: { position: spawnPosition, ...(spawnRotation ? { rotation: spawnRotation } : {}) },
    spawnPoints: spawnPoints.length > 0 ? spawnPoints : undefined,
    objects: objects.map((obj) => ({
      id: obj.id,
      name: obj.name,
      parentId: obj.parentId ?? null,
      visible: obj.visible ?? true,
      locked: obj.locked ?? false,
      spawnTag: obj.spawnTag,
      source: obj.source,
      transform: obj.transform,
      physics: {
        type: obj.physicsType ?? (obj.body?.isDynamic() ? "dynamic" : obj.body?.isKinematic() ? "kinematic" : "static"),
      },
      material: obj.material,
      brushParams: obj.brushParams,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Download                                                          */
/* ------------------------------------------------------------------ */

export function download(data: LevelDataV2): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${data.name || "level"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Load from file - always returns v2                                */
/* ------------------------------------------------------------------ */

export function loadFromFile(file: File): Promise<LevelDataV2 | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        resolve(upgradeLevelData(parsed));
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}

/* ------------------------------------------------------------------ */
/*  v1 to v2 migration                                                */
/* ------------------------------------------------------------------ */

export function upgradeLevelData(data: unknown): LevelDataV2 | null {
  try {
    if (!isRecord(data)) return null;
    if (data.version === 2) return validateLevelDataV2Shape(data).ok ? (data as unknown as LevelDataV2) : null;

    if (data.version === 1) {
      const v1 = data as unknown as LevelDataV1;
      if (
        typeof v1.name !== "string" ||
        !isRecord(v1.spawnPoint) ||
        !isFiniteVec3(v1.spawnPoint.position) ||
        !Array.isArray(v1.objects)
      ) {
        return null;
      }
      const now = new Date().toISOString();
      const upgraded: LevelDataV2 = {
        version: 2,
        name: v1.name,
        created: now,
        modified: now,
        spawnPoint: { position: v1.spawnPoint.position },
        objects: v1.objects.map((obj) => ({
          id: obj.id,
          name: obj.name,
          parentId: null,
          visible: true,
          locked: false,
          spawnTag: undefined,
          source: obj.source,
          transform: obj.transform,
          physics: { type: obj.physics?.type ?? "static" },
          material: undefined,
          brushParams: undefined,
        })),
      };
      return validateLevelDataV2Shape(upgraded).ok ? upgraded : null;
    }

    return null;
  } catch {
    return null;
  }
}

export const LevelSerializer = {
  serialize,
  download,
  loadFromFile,
  upgradeLevelData,
} as const;
