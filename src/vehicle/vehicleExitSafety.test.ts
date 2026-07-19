import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { findFirstClearVerticalExitCandidate, pickFirstClearVehicleExitCandidate } from "./vehicleExitSafety";

describe("vehicle exit safety", () => {
  it("keeps candidate priority and returns clones", () => {
    const candidates = [new THREE.Vector3(-1, 1, 0), new THREE.Vector3(1, 1, 0)];

    const selected = pickFirstClearVehicleExitCandidate(candidates, (candidate) => candidate.x > 0);

    expect(selected?.equals(candidates[1])).toBe(true);
    expect(selected).not.toBe(candidates[1]);
  });

  it("searches upward until a full capsule position is clear", () => {
    const base = new THREE.Vector3(4, 2, 6);

    const selected = findFirstClearVerticalExitCandidate(
      base,
      3,
      (candidate) => candidate.y >= 3.5,
      (candidate) => candidate.y >= 4,
      0.5,
      4,
    );

    expect(selected).toEqual(new THREE.Vector3(4, 4, 6));
    expect(base).toEqual(new THREE.Vector3(4, 2, 6));
  });

  it("fails closed instead of returning a known-blocked vertical position", () => {
    expect(() =>
      findFirstClearVerticalExitCandidate(
        new THREE.Vector3(),
        2,
        () => false,
        () => true,
        0.5,
        3,
      ),
    ).toThrowError("No capsule-clear vertical vehicle exit was found.");
  });
});
