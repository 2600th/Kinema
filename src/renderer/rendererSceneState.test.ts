import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyEnvironmentRotation, applyEnvironmentTarget } from "./rendererSceneState";

describe("renderer scene environment ownership", () => {
  it("changes PMREM lighting without replacing the designed background", () => {
    const scene = new THREE.Scene();
    const background = new THREE.DataTexture();
    const environment = new THREE.Texture();
    scene.background = background;

    applyEnvironmentTarget(scene, { texture: environment, dispose: () => {} }, 35);

    expect(scene.environment).toBe(environment);
    expect(scene.background).toBe(background);
  });

  it("rotates environment lighting without mutating background rotation", () => {
    const scene = new THREE.Scene();
    scene.backgroundRotation.set(0.1, 0.2, 0.3);
    const previousBackgroundRotation = scene.backgroundRotation.clone();

    applyEnvironmentRotation(scene, 90);

    expect(scene.environmentRotation.y).toBeCloseTo(Math.PI / 2);
    expect(scene.backgroundRotation.toArray()).toEqual(previousBackgroundRotation.toArray());
  });
});
