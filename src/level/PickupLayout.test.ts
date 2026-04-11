import { describe, expect, it } from "vitest";
import { getProceduralCoinPlacements } from "./CoinLayout";
import { getProceduralSpikePlacements } from "./SpikeLayout";

interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

function inflate(footprint: Footprint, padding: number): Footprint {
  return {
    x: footprint.x,
    z: footprint.z,
    width: footprint.width + padding * 2,
    depth: footprint.depth + padding * 2,
  };
}

function overlaps(a: Footprint, b: Footprint): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width
    && Math.abs(a.z - b.z) * 2 < a.depth + b.depth
  );
}

interface Volume {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

function overlapsVolume(volume: Volume, x: number, y: number, z: number, radius: number): boolean {
  return (
    Math.abs(volume.x - x) < volume.width * 0.5 + radius
    && Math.abs(volume.y - y) < volume.height * 0.5 + radius
    && Math.abs(volume.z - z) < volume.depth * 0.5 + radius
  );
}

const COIN_VISUAL_RADIUS = 0.57;

describe("procedural pickup layouts", () => {
  it("keeps spike hazards out of the authored platform footprints in the overlap-prone bays", () => {
    const safetyPadding = 0.35;
    const movingPlatforms: Footprint[] = [
      { x: -12, z: 3, width: 5, depth: 5 },
      { x: 0, z: 3, width: 5, depth: 5 },
      { x: 12, z: 3, width: 5, depth: 5 },
    ].map((platform) => inflate(platform, safetyPadding));
    const physicsPlatforms: Footprint[] = [
      { x: -11, z: 2.25, width: 5.2, depth: 5.2 },
      { x: 0, z: 2.1, width: 3.1, depth: 9.5 },
      // Full moving boost-pad travel from x=6.5 to x=14.5, including platform width.
      { x: 10.5, z: -2.75, width: 12.2, depth: 4.2 },
    ].map((platform) => inflate(platform, safetyPadding));

    const movingHazards = getProceduralSpikePlacements("platformsMoving").map((hazard) => ({
      x: hazard.position.x,
      z: hazard.position.z + 80,
      width: hazard.size.x,
      depth: hazard.size.z,
    }));
    const physicsHazards = getProceduralSpikePlacements("platformsPhysics").map((hazard) => ({
      x: hazard.position.x,
      z: hazard.position.z + 120,
      width: hazard.size.x,
      depth: hazard.size.z,
    }));

    movingHazards.forEach((hazard) => {
      movingPlatforms.forEach((platform) => {
        expect(overlaps(hazard, platform)).toBe(false);
      });
    });

    physicsHazards.forEach((hazard) => {
      physicsPlatforms.forEach((platform) => {
        expect(overlaps(hazard, platform)).toBe(false);
      });
    });
  });

  it("anchors coins to the authored traversal beats instead of generic corridor edges", () => {
    const steps = getProceduralCoinPlacements("steps");
    expect(steps.slice(0, 3).every((coin) => coin.position.x === -8)).toBe(true);
    expect(steps.slice(3).every((coin) => coin.position.x === 8)).toBe(true);

    const doubleJump = getProceduralCoinPlacements("doubleJump");
    const jumpXs = doubleJump.map((coin) => coin.position.x);
    expect(jumpXs).toEqual([-6, -2.8, 0.3, 4.2, 8.1]);
    for (let index = 1; index < doubleJump.length; index += 1) {
      expect(doubleJump[index].position.y).toBeGreaterThan(doubleJump[index - 1].position.y);
    }

    const materials = getProceduralCoinPlacements("materials");
    expect(materials.map((coin) => coin.position.x)).toEqual([-16.8, -8.4, 0, 8.4, 16.8]);
  });

  it("keeps movement and materials coins out of the ladder, crouch roof, and sample volumes", () => {
    const movementCoins = getProceduralCoinPlacements("movement");
    const materialsCoins = getProceduralCoinPlacements("materials");

    const crouchRoof: Volume = {
      x: 0,
      y: 0.615,
      z: 0,
      width: 2.8,
      height: 0.14,
      depth: 9.6,
    };
    const ladderLane: Volume = {
      x: 14,
      y: 1.425,
      z: 0,
      width: 1.4,
      height: 4.2,
      depth: 1.0,
    };

    movementCoins.forEach((coin) => {
      expect(overlapsVolume(crouchRoof, coin.position.x, coin.position.y, coin.position.z - 110, COIN_VISUAL_RADIUS)).toBe(false);
      expect(overlapsVolume(ladderLane, coin.position.x, coin.position.y, coin.position.z - 110, COIN_VISUAL_RADIUS)).toBe(false);
    });

    const materialSampleCenters = [
      { x: -16.8, z: 3 },
      { x: -8.4, z: 3 },
      { x: 0, z: 3 },
      { x: 8.4, z: 3 },
      { x: 16.8, z: 3 },
      { x: -16.8, z: -2 },
      { x: -8.4, z: -2 },
      { x: 0, z: -2 },
      { x: 8.4, z: -2 },
      { x: 16.8, z: -2 },
    ];

    materialSampleCenters.forEach((sample) => {
      materialsCoins.forEach((coin) => {
        expect(
          overlapsVolume(
            { x: sample.x, y: 0.375, z: sample.z, width: 1.6, height: 1.6, depth: 1.6 },
            coin.position.x,
            coin.position.y,
            coin.position.z + 160,
            COIN_VISUAL_RADIUS,
          ),
        ).toBe(false);
      });
    });
  });
});
