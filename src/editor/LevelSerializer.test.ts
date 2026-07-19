import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorObject } from "./EditorObject";
import { type LevelDataV1, type SerializedObjectV2, serialize, upgradeLevelData } from "./LevelSerializer";

const BRUSH_TYPES = ["block", "floor", "pillar", "stairs", "ramp", "doorframe", "spawn", "trigger"] as const;
const NOW = "2026-07-18T09:30:00.000Z";
const CREATED = "2025-01-02T03:04:05.000Z";

function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function makeEditorObject(
  id: string,
  source: EditorObject["source"],
  index: number,
  parentId: string | null,
): EditorObject {
  return {
    id,
    name: `Object ${index}`,
    mesh: new THREE.Group(),
    source,
    transform: {
      position: [index + 0.25, index + 1.5, -index - 0.75],
      rotation: [index * 0.1, index * 0.2, index * 0.3],
      scale: [index + 1, index + 1.25, index + 1.5],
    },
    parentId,
    visible: index % 2 === 0,
    locked: index % 3 === 0,
    material: {
      color: hexColor(index + 1),
      roughness: index / 10,
      metalness: index / 20,
      emissive: hexColor(index + 2),
      emissiveIntensity: index + 0.5,
      opacity: 1 - index / 20,
    },
    brushParams: source.type === "brush" ? { width: index + 1, height: index + 2, depth: index + 3 } : undefined,
    physicsType: (["static", "dynamic", "kinematic"] as const)[index % 3],
    spawnTag: source.type === "brush" && source.brush === "spawn" ? "player" : undefined,
  };
}

function projectSerializedObject(object: EditorObject): SerializedObjectV2 {
  return {
    id: object.id,
    name: object.name,
    parentId: object.parentId ?? null,
    visible: object.visible ?? true,
    locked: object.locked ?? false,
    spawnTag: object.spawnTag,
    source: object.source,
    transform: object.transform,
    physics: { type: object.physicsType ?? "static" },
    material: object.material,
    brushParams: object.brushParams,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LevelSerializer", () => {
  it.each([
    ["missing objects", { version: 2, name: "bad", created: NOW, modified: NOW, spawnPoint: { position: [0, 2, 0] } }],
    ["malformed object entry", { version: 2, name: "bad", created: NOW, modified: NOW, spawnPoint: { position: [0, 2, 0] }, objects: [null] }],
    ["short transform tuple", { version: 2, name: "bad", created: NOW, modified: NOW, spawnPoint: { position: [0, 2, 0] }, objects: [{ id: "bad", name: "bad", parentId: null, source: { type: "primitive", primitive: "cube" }, transform: { position: [0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, physics: { type: "static" } }] }],
    ["non-finite transform", { version: 2, name: "bad", created: NOW, modified: NOW, spawnPoint: { position: [0, 2, 0] }, objects: [{ id: "bad", name: "bad", parentId: null, source: { type: "primitive", primitive: "cube" }, transform: { position: [0, Number.POSITIVE_INFINITY, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, physics: { type: "static" } }] }],
    ["malformed source", { version: 2, name: "bad", created: NOW, modified: NOW, spawnPoint: { position: [0, 2, 0] }, objects: [{ id: "bad", name: "bad", parentId: null, source: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, physics: { type: "static" } }] }],
    ["malformed physics", { version: 2, name: "bad", created: NOW, modified: NOW, spawnPoint: { position: [0, 2, 0] }, objects: [{ id: "bad", name: "bad", parentId: null, source: { type: "primitive", primitive: "cube" }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, physics: { type: "flying" } }] }],
  ])("rejects syntactically valid V2 JSON with %s without throwing", (_label, malformed) => {
    expect(() => upgradeLevelData(malformed)).not.toThrow();
    expect(upgradeLevelData(malformed)).toBeNull();
  });

  it("round-trips a complete V2 document without dropping serialized fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const brushObjects = BRUSH_TYPES.map((brush, index) =>
      makeEditorObject(`brush-${brush}`, { type: "brush", brush }, index, index === 0 ? null : "brush-block"),
    );
    const glbObject = makeEditorObject(
      "glb-statue",
      { type: "glb", asset: "/assets/models/statue.glb" },
      BRUSH_TYPES.length,
      "brush-block",
    );
    const objects = [...brushObjects, glbObject];
    const spawn = objects.find((object) => object.source.type === "brush" && object.source.brush === "spawn");
    if (!spawn) throw new Error("Spawn fixture was not created");

    const serialized = serialize("Complete editor document", objects, CREATED);
    const expectedObjects = objects.map(projectSerializedObject);

    expect(serialized).toEqual({
      version: 2,
      name: "Complete editor document",
      created: CREATED,
      modified: NOW,
      spawnPoint: {
        position: spawn.transform.position,
        rotation: spawn.transform.rotation,
      },
      spawnPoints: [
        {
          tag: "player",
          position: spawn.transform.position,
          rotation: spawn.transform.rotation,
        },
      ],
      objects: expectedObjects,
    });

    const roundTripped = upgradeLevelData(JSON.parse(JSON.stringify(serialized)));
    expect(roundTripped).toEqual(serialized);
    expect(roundTripped?.objects.map((object) => object.source.brush).filter(Boolean)).toEqual(BRUSH_TYPES);
    expect(roundTripped?.objects.find((object) => object.source.type === "glb")?.source.asset).toBe(
      "/assets/models/statue.glb",
    );
    expect(roundTripped?.objects.filter((object) => object.parentId === "brush-block")).toHaveLength(8);
  });

  it("does not serialize runtime-only missing-asset metadata", () => {
    const object = Object.assign(
      makeEditorObject("missing-glb", { type: "glb", asset: "/assets/models/Missing.glb" }, 0, null),
      { missingAssetPath: "/assets/models/Missing.glb" },
    );

    const serialized = serialize("Missing model", [object], CREATED);

    expect(serialized.objects).toHaveLength(1);
    expect(serialized.objects[0]).not.toHaveProperty("missingAssetPath");
    expect(serialized.objects[0].source).toEqual({ type: "glb", asset: "/assets/models/Missing.glb" });
  });

  it("migrates a V1 document to the current V2 shape", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const legacy: LevelDataV1 = {
      version: 1,
      name: "Legacy level",
      spawnPoint: { position: [3, 4, 5], rotation: [0, Math.PI, 0] },
      environment: { hdr: "legacy.hdr", intensity: 1.5, blur: 0.25 },
      objects: [
        {
          id: "legacy-dynamic",
          name: "Legacy Dynamic",
          source: { type: "primitive", primitive: "box" },
          transform: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [4, 5, 6] },
          physics: { type: "dynamic", mass: 12, shape: "cuboid" },
          userData: { obsolete: true },
        },
        {
          id: "legacy-static",
          name: "Legacy Static",
          source: { type: "glb", asset: "/legacy.glb" },
          transform: { position: [-1, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      ],
    };

    expect(upgradeLevelData(legacy)).toEqual({
      version: 2,
      name: "Legacy level",
      created: NOW,
      modified: NOW,
      spawnPoint: { position: [3, 4, 5] },
      objects: [
        {
          id: "legacy-dynamic",
          name: "Legacy Dynamic",
          parentId: null,
          visible: true,
          locked: false,
          spawnTag: undefined,
          source: { type: "primitive", primitive: "box" },
          transform: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [4, 5, 6] },
          physics: { type: "dynamic" },
          material: undefined,
          brushParams: undefined,
        },
        {
          id: "legacy-static",
          name: "Legacy Static",
          parentId: null,
          visible: true,
          locked: false,
          spawnTag: undefined,
          source: { type: "glb", asset: "/legacy.glb" },
          transform: { position: [-1, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
          physics: { type: "static" },
          material: undefined,
          brushParams: undefined,
        },
      ],
    });
  });
});
