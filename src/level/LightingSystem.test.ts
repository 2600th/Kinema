import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { LightingSystem } from "./LightingSystem";

describe("LightingSystem shadow resource changes", () => {
  it("preserves renderer-owned sky, fog, and environment presentation", () => {
    const scene = new THREE.Scene();
    const background = new THREE.DataTexture();
    const fog = new THREE.Fog(0x8e99a6, 95, 360);
    scene.background = background;
    scene.fog = fog;
    scene.environmentIntensity = 0.42;
    scene.backgroundIntensity = 0.73;
    scene.backgroundBlurriness = 0;

    new LightingSystem(scene).addLighting();

    expect(scene.background).toBe(background);
    expect(scene.fog).toBe(fog);
    expect(scene.environmentIntensity).toBe(0.42);
    expect(scene.backgroundIntensity).toBe(0.73);
    expect(scene.backgroundBlurriness).toBe(0);
  });

  it("defers a live shadow-map resize through the GPU resource scheduler", () => {
    const scheduled = new Map<string, () => void>();
    const schedule = vi.fn((key: string, mutation: () => void) => {
      scheduled.set(key, mutation);
    });
    const scene = new THREE.Scene();
    const lighting = new LightingSystem(scene, schedule);
    lighting.addLighting();
    const directional = scene.getObjectByName("__kinema_dirlight") as THREE.DirectionalLight;
    const shadowMap = new THREE.WebGLRenderTarget(2048, 2048);
    const resizeShadowMap = vi.spyOn(shadowMap, "setSize");
    directional.shadow.map = shadowMap;

    expect(directional.shadow.mapSize.toArray()).toEqual([2048, 2048]);

    lighting.setGraphicsProfile("performance");

    expect(schedule).toHaveBeenCalledOnce();
    expect(directional.shadow.mapSize.toArray()).toEqual([2048, 2048]);
    expect(resizeShadowMap).not.toHaveBeenCalled();

    scheduled.get("directional-shadow-quality")?.();

    expect(directional.shadow.mapSize.toArray()).toEqual([1024, 1024]);
    expect(resizeShadowMap).toHaveBeenCalledWith(1024, 1024);
    expect(directional.shadow.needsUpdate).toBe(true);
  });

  it("defers a pending resize when shadows are re-enabled", () => {
    const scheduled = new Map<string, () => void>();
    const schedule = vi.fn((key: string, mutation: () => void) => {
      scheduled.set(key, mutation);
    });
    const scene = new THREE.Scene();
    const lighting = new LightingSystem(scene, schedule);
    lighting.addLighting();
    const directional = scene.getObjectByName("__kinema_dirlight") as THREE.DirectionalLight;
    const shadowMap = new THREE.WebGLRenderTarget(2048, 2048);
    const resizeShadowMap = vi.spyOn(shadowMap, "setSize");
    directional.shadow.map = shadowMap;

    lighting.setShadowsEnabled(false);
    lighting.setGraphicsProfile("performance");
    scheduled.get("directional-shadow-quality")?.();
    expect(resizeShadowMap).not.toHaveBeenCalled();

    lighting.setShadowsEnabled(true);
    expect(resizeShadowMap).not.toHaveBeenCalled();
    scheduled.get("directional-shadow-quality")?.();

    expect(resizeShadowMap).toHaveBeenCalledWith(1024, 1024);
  });
});
