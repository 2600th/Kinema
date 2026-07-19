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
  it.each(["group", "cube", "sphere", "cylinder", "capsule", "plane"])(
    "accepts the supported %s primitive",
    (primitive) => {
      const result = validateEditorLevelData(
        levelWith([objectWith({ type: "primitive", primitive })]),
      );

      expect(result).toEqual({ ok: true });
    },
  );

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
    const result = validateEditorLevelData(
      levelWith([objectWith(source as SerializedObjectV2["source"])]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid source data");
    expect(result.reason).toContain("object-1");
  });

  it("rejects an unknown brush id", () => {
    const result = validateEditorLevelData(
      levelWith([objectWith({ type: "brush", brush: "not-a-brush" })]),
    );

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
});
