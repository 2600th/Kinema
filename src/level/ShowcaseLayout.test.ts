import { describe, expect, it } from "vitest";
import {
  getShowcaseStationZ,
  PROCEDURAL_REVIEW_SPAWN_ORDER,
  resolveProceduralReviewSpawn,
  SHOWCASE_ENTRANCE_START_Z,
  SHOWCASE_LAYOUT,
} from "./ShowcaseLayout";

describe("resolveProceduralReviewSpawn", () => {
  it("resolves station review spawns with world-space offsets", () => {
    const spawn = resolveProceduralReviewSpawn("throw");
    expect(spawn).not.toBeNull();
    expect(spawn?.spawn.position.z).toBeCloseTo(getShowcaseStationZ("throw") + 8.9);
    expect(spawn?.cameraYaw).toBeCloseTo(0);
  });

  it("exposes the review spawn order for screenshot automation", () => {
    expect(PROCEDURAL_REVIEW_SPAWN_ORDER[0]).toBe("entrance");
    expect(PROCEDURAL_REVIEW_SPAWN_ORDER).toContain("platformsPhysics");
    expect(PROCEDURAL_REVIEW_SPAWN_ORDER.at(-1)).toBe("overviewEnd");
  });

  it("keeps the entrance review spawn aligned with the trimmed corridor start", () => {
    const spawn = resolveProceduralReviewSpawn("entrance");
    expect(spawn).not.toBeNull();
    expect(spawn?.spawn.position.z).toBeCloseTo(SHOWCASE_ENTRANCE_START_Z);
  });

  it("keeps the default corridor start close to the steps bay with limited dead space behind it", () => {
    const hallStartZ = SHOWCASE_LAYOUT.hall.length * 0.5;
    const stepsStationZ = getShowcaseStationZ("steps");

    expect(SHOWCASE_ENTRANCE_START_Z - stepsStationZ).toBeGreaterThan(10);
    expect(SHOWCASE_ENTRANCE_START_Z - stepsStationZ).toBeLessThan(20);
    expect(hallStartZ - SHOWCASE_ENTRANCE_START_Z).toBeLessThan(35);
  });

  it("returns null for unknown review spawn ids", () => {
    expect(resolveProceduralReviewSpawn("missing")).toBeNull();
  });
});
