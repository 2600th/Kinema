import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { SparkleParticles } from "./SparkleParticles";

function makeSparkles(): SparkleParticles {
  return new SparkleParticles({
    count: 10,
    areaWidth: 20,
    areaHeight: 8,
    areaDepth: 400,
    position: new THREE.Vector3(0, 4, -100),
    regionCount: 4,
    visibilityDistance: 60,
  });
}

function regionPoints(sparkles: SparkleParticles): THREE.Points[] {
  return sparkles.root.children as THREE.Points[];
}

describe("SparkleParticles regional culling", () => {
  it("distributes the exact configured total across four frustum-culled regions", () => {
    const sparkles = makeSparkles();
    const regions = regionPoints(sparkles);

    expect(regions).toHaveLength(4);
    expect(regions.map((region) => (region.geometry.getAttribute("position") as THREE.BufferAttribute).count)).toEqual([
      3, 3, 2, 2,
    ]);
    expect(regions.every((region) => region.frustumCulled)).toBe(true);
    expect(sparkles.getDebugState()).toMatchObject({ configuredCount: 10, regionCount: 4 });
  });

  it("shows and updates only regions within the explicit world-Z distance", () => {
    const sparkles = makeSparkles();
    const regions = regionPoints(sparkles);
    const firstPositions = (regions[0].geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    const secondPositions = (regions[1].geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    const firstBefore = [...firstPositions];
    const secondBefore = [...secondPositions];

    sparkles.update(0.25, -250);

    expect(regions.map(({ visible }) => visible)).toEqual([true, false, false, false]);
    expect([...firstPositions]).not.toEqual(firstBefore);
    expect([...secondPositions]).toEqual(secondBefore);
    expect(sparkles.getDebugState()).toMatchObject({ visibleRegionCount: 1, visibleCount: 3 });
  });

  it("honors global visibility without discarding distance state", () => {
    const sparkles = makeSparkles();
    sparkles.update(0, -250);

    sparkles.setVisible(false);
    expect(regionPoints(sparkles).every(({ visible }) => !visible)).toBe(true);
    expect(sparkles.getDebugState().visibleCount).toBe(0);

    sparkles.setVisible(true);
    expect(regionPoints(sparkles).map(({ visible }) => visible)).toEqual([true, false, false, false]);
  });

  it("disposes every region geometry and material exactly once", () => {
    const sparkles = makeSparkles();
    const regions = regionPoints(sparkles);
    const geometrySpies = regions.map(({ geometry }) => vi.spyOn(geometry, "dispose"));
    const materialSpies = regions.map(({ material }) => vi.spyOn(material as THREE.PointsMaterial, "dispose"));

    sparkles.dispose();
    sparkles.dispose();

    expect(geometrySpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(materialSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(sparkles.root.parent).toBeNull();
  });
});
