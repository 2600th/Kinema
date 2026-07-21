import { DEFAULT_CAMERA_CONFIG } from "@core/constants";
import { describe, expect, it } from "vitest";
import {
  getShowcaseStationZ,
  PROCEDURAL_REVIEW_SPAWN_ORDER,
  resolveProceduralReviewSpawn,
  SHOWCASE_BOUNDARY_HEIGHT,
  SHOWCASE_ENTRANCE_START_Z,
  SHOWCASE_GROUNDED_SPAWN_Y,
  SHOWCASE_ISOLATED_FLOOR_LENGTH,
  SHOWCASE_LAYOUT,
  STATION_SPAWN_OVERRIDES,
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

  it("exports the grounded procedural spawn and safe perimeter heights", () => {
    expect(SHOWCASE_GROUNDED_SPAWN_Y).toBeCloseTo(-0.35);
    expect(SHOWCASE_BOUNDARY_HEIGHT).toBe(1.25);
  });

  it("keeps station spawn overrides relative to the shared grounded base", () => {
    expect(STATION_SPAWN_OVERRIDES.platformsMoving?.offset?.[1]).toBe(0);
    expect(STATION_SPAWN_OVERRIDES.platformsPhysics?.offset?.[1]).toBe(0);
  });

  it("keeps every isolated spawn and camera boom inside the entrance perimeter", () => {
    const furthestSpawnOffset = Math.max(
      ...Object.values(STATION_SPAWN_OVERRIDES).map(({ offset }) => 10 + (offset?.[2] ?? 0)),
    );
    const entranceInnerFace = SHOWCASE_ISOLATED_FLOOR_LENGTH * 0.5 - 0.5;
    const requiredCameraClearance = DEFAULT_CAMERA_CONFIG.zoomMaxDistance + DEFAULT_CAMERA_CONFIG.collisionOffset;

    expect(entranceInnerFace - furthestSpawnOffset).toBeGreaterThan(requiredCameraClearance);
  });
});
