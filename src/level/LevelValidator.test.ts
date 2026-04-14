import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { LevelValidator } from "./LevelValidator";
import type { ParsedNode } from "./MeshParser";

describe("LevelValidator", () => {
  it("validates without throwing", () => {
    const validator = new LevelValidator();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const parsed: ParsedNode[] = [{ object: mesh, mesh, type: "spawnpoint", mass: null }];
    expect(() => validator.validate(parsed, "test")).not.toThrow();
  });

  it("warns on missing spawn point", () => {
    const validator = new LevelValidator();
    const parsed: ParsedNode[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    validator.validate(parsed, "empty");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("No spawn point found"));
    spy.mockRestore();
  });
});
