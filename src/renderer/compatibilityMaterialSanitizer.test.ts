import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sanitizeSceneForCompatibility } from "./compatibilityMaterialSanitizer";

function createNodeLikeMaterial(type: string, options: THREE.MeshStandardMaterialParameters = {}): THREE.Material {
  const material = new THREE.MeshStandardMaterial(options) as THREE.MeshStandardMaterial & {
    isNodeMaterial?: boolean;
  };
  material.type = type;
  material.isNodeMaterial = true;
  return material;
}

describe("sanitizeSceneForCompatibility", () => {
  it("replaces node materials with standard-material fallbacks", () => {
    const scene = new THREE.Scene();
    const source = createNodeLikeMaterial("MeshStandardNodeMaterial", {
      color: 0x336699,
      roughness: 0.42,
      metalness: 0.18,
      transparent: true,
      opacity: 0.7,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source);
    scene.add(mesh);

    const result = sanitizeSceneForCompatibility(scene);
    const sanitized = mesh.material as THREE.MeshStandardMaterial;

    expect(result).toEqual({
      replaced: 1,
      replacedTypes: ["MeshStandardNodeMaterial"],
    });
    expect(sanitized).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(sanitized.type).toBe("MeshStandardMaterial");
    expect(sanitized.color.getHex()).toBe(0x336699);
    expect(sanitized.roughness).toBeCloseTo(0.42);
    expect(sanitized.metalness).toBeCloseTo(0.18);
    expect(sanitized.transparent).toBe(true);
    expect(sanitized.opacity).toBeCloseTo(0.7);
    expect(sanitized.userData.__kinemaCompatibilityFallbackFrom).toBe("MeshStandardNodeMaterial");
  });

  it("uses a basic-material fallback for basic node materials", () => {
    const scene = new THREE.Scene();
    const source = createNodeLikeMaterial("MeshBasicNodeMaterial", {
      color: 0xff8844,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), source);
    scene.add(mesh);

    const result = sanitizeSceneForCompatibility(scene);

    expect(result.replaced).toBe(1);
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff8844);
  });

  it("leaves standard WebGL-safe materials untouched", () => {
    const scene = new THREE.Scene();
    const source = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source);
    scene.add(mesh);

    const result = sanitizeSceneForCompatibility(scene);

    expect(result).toEqual({
      replaced: 0,
      replacedTypes: [],
    });
    expect(mesh.material).toBe(source);
  });
});
