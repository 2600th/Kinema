import { describe, expect, it } from "vitest";
import { validateEditorLevelData } from "./EditorLevelValidator";
import type { LevelDataV2, SerializedObjectV2 } from "./LevelSerializer";

function objectWith(source: SerializedObjectV2["source"], id = "object-1"): SerializedObjectV2 {
  return {
    id,
    name: id,
    parentId: null,
    source,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    physics: { type: "static" },
  };
}

function levelWith(objects: SerializedObjectV2[]): LevelDataV2 {
  return {
    version: 2,
    name: "validator-test",
    created: "2026-07-19T00:00:00.000Z",
    modified: "2026-07-19T00:00:00.000Z",
    spawnPoint: { position: [0, 2, 0] },
    objects,
  };
}

describe("validateEditorLevelData", () => {
  it.each([
    "group",
    "cube",
    "sphere",
    "cylinder",
    "capsule",
    "plane",
  ])("accepts the supported %s primitive", (primitive) => {
    const result = validateEditorLevelData(levelWith([objectWith({ type: "primitive", primitive })]));

    expect(result).toEqual({ ok: true });
  });

  it("accepts a known brush and a GLB with a non-empty asset path", () => {
    expect(
      validateEditorLevelData(
        levelWith([
          objectWith({ type: "brush", brush: "block" }, "brush-1"),
          objectWith({ type: "glb", asset: "/assets/models/session.glb" }, "glb-1"),
        ]),
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    { label: "missing primitive", source: { type: "primitive" } },
    { label: "unknown primitive", source: { type: "primitive", primitive: "torus" } },
    { label: "missing GLB asset", source: { type: "glb", asset: "" } },
    { label: "unsupported sprite", source: { type: "sprite" } },
    { label: "unknown source type", source: { type: "future" } },
  ])("rejects $label source data", ({ source }) => {
    const result = validateEditorLevelData(levelWith([objectWith(source as SerializedObjectV2["source"])]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid source data");
    expect(result.reason).toContain("object-1");
  });

  it("rejects an unknown brush id", () => {
    const result = validateEditorLevelData(levelWith([objectWith({ type: "brush", brush: "not-a-brush" })]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected unknown brush rejection");
    expect(result.reason).toContain("not-a-brush");
  });

  it("rejects duplicate object ids", () => {
    const result = validateEditorLevelData(
      levelWith([
        objectWith({ type: "primitive", primitive: "cube" }, "duplicate"),
        objectWith({ type: "primitive", primitive: "sphere" }, "duplicate"),
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected duplicate id rejection");
    expect(result.reason).toContain("duplicate");
  });

  it("rejects a missing parent edge", () => {
    const child = objectWith({ type: "primitive", primitive: "cube" }, "child");
    child.parentId = "missing-parent";

    const result = validateEditorLevelData(levelWith([child]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing parent rejection");
    expect(result.reason).toContain("missing-parent");
  });

  it("rejects cyclic hierarchy edges", () => {
    const first = objectWith({ type: "primitive", primitive: "group" }, "first");
    const second = objectWith({ type: "primitive", primitive: "group" }, "second");
    first.parentId = second.id;
    second.parentId = first.id;

    const result = validateEditorLevelData(levelWith([first, second]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cyclic hierarchy rejection");
    expect(result.reason).toContain("cycle");
  });

  it("rejects a rotated physics child whose non-uniform inherited scale would shear its collider", () => {
    const parent = objectWith({ type: "primitive", primitive: "group" }, "scaled-parent");
    parent.transform.scale = [2, 1, 0.5];
    const child = objectWith({ type: "primitive", primitive: "cube" }, "rotated-child");
    child.parentId = parent.id;
    child.transform.rotation = [0.2, 0.7, 0.1];

    const result = validateEditorLevelData(levelWith([parent, child]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected unsupported inherited scale rejection");
    expect(result.reason).toContain("rotated-child");
    expect(result.reason).toMatch(/non-uniform inherited scale/i);
  });

  it.each([
    "dynamic",
    "kinematic",
  ] as const)("rejects an axis-aligned %s child below a non-uniformly scaled parent", (type) => {
    const parent = objectWith({ type: "primitive", primitive: "group" }, "scaled-parent");
    parent.transform.scale = [2, 1, 0.5];
    const child = objectWith({ type: "primitive", primitive: "cube" }, `${type}-child`);
    child.parentId = parent.id;
    child.physics.type = type;

    const result = validateEditorLevelData(levelWith([parent, child]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected moving-body inherited scale rejection");
    expect(result.reason).toContain(`${type}-child`);
    expect(result.reason).toMatch(/dynamic|kinematic|moving/i);
    expect(result.reason).toMatch(/non-uniform/i);
  });

  it("rejects a hidden dynamic child below non-uniform inherited scale before it can later be shown", () => {
    const parent = objectWith({ type: "primitive", primitive: "group" }, "scaled-parent");
    parent.transform.scale = [2, 1, 0.5];
    const child = objectWith({ type: "primitive", primitive: "cube" }, "hidden-dynamic");
    child.parentId = parent.id;
    child.physics.type = "dynamic";
    child.visible = false;

    expect(validateEditorLevelData(levelWith([parent, child])).ok).toBe(false);
  });

  it.each([
    ["missing objects", { version: 2, name: "bad", created: "x", modified: "x", spawnPoint: { position: [0, 2, 0] } }],
    [
      "bad parent id",
      levelWith([
        { ...objectWith({ type: "primitive", primitive: "cube" }), parentId: 42 } as unknown as SerializedObjectV2,
      ]),
    ],
    [
      "bad transform tuple",
      levelWith([
        {
          ...objectWith({ type: "primitive", primitive: "cube" }),
          transform: { position: [0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        } as unknown as SerializedObjectV2,
      ]),
    ],
    [
      "non-finite transform",
      levelWith([
        {
          ...objectWith({ type: "primitive", primitive: "cube" }),
          transform: { position: [0, 0, 0], rotation: [0, Number.NaN, 0], scale: [1, 1, 1] },
        },
      ]),
    ],
    [
      "bad physics",
      levelWith([
        {
          ...objectWith({ type: "primitive", primitive: "cube" }),
          physics: { type: "future" },
        } as unknown as SerializedObjectV2,
      ]),
    ],
  ])("totally rejects malformed V2 data: %s", (_label, malformed) => {
    expect(() => validateEditorLevelData(malformed as LevelDataV2)).not.toThrow();
    expect(validateEditorLevelData(malformed as LevelDataV2).ok).toBe(false);
  });

  it("validates a deep leaf-first acyclic hierarchy without overflowing the call stack", () => {
    const depth = 15_000;
    const objects = Array.from({ length: depth }, (_, index) => {
      const entry = objectWith(
        { type: "primitive", primitive: index === depth - 1 ? "cube" : "group" },
        `node-${index}`,
      );
      entry.parentId = index === 0 ? null : `node-${index - 1}`;
      return entry;
    }).reverse();

    expect(() => validateEditorLevelData(levelWith(objects))).not.toThrow();
    expect(validateEditorLevelData(levelWith(objects))).toEqual({ ok: true });
  });

  it("turns unexpected structural access errors into a constant validation result", () => {
    let accesses = 0;
    const source = Object.defineProperty({ primitive: "cube" }, "type", {
      get: () => {
        accesses++;
        if (accesses === 1) return "primitive";
        throw new Error("hostile getter");
      },
    }) as SerializedObjectV2["source"];
    const hostile = levelWith([objectWith(source)]);
    let result: ReturnType<typeof validateEditorLevelData> | undefined;

    expect(() => {
      result = validateEditorLevelData(hostile);
    }).not.toThrow();
    expect(result).toEqual({ ok: false, reason: "The level contains malformed semantic data." });
  });

  it.each([
    Object.defineProperty(new Error("hidden"), "message", {
      get: () => {
        throw new Error("message must not be read");
      },
    }),
    Object.defineProperty({}, "message", {
      get: () => {
        throw new Error("object message must not be read");
      },
    }),
  ])("never reads properties from a thrown value", (hostileError) => {
    let accesses = 0;
    const source = Object.defineProperty({ primitive: "cube" }, "type", {
      get: () => {
        accesses++;
        if (accesses === 1) return "primitive";
        throw hostileError;
      },
    }) as SerializedObjectV2["source"];

    expect(validateEditorLevelData(levelWith([objectWith(source)]))).toEqual({
      ok: false,
      reason: "The level contains malformed semantic data.",
    });
  });
});
