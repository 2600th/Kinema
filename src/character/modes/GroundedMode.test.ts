import type { PlayerContext } from "@character/modes/CharacterMode";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GroundedMode } from "./GroundedMode";

interface StepAssistAccess {
  applyStepAssist(ctx: PlayerContext, desiredInputDir: THREE.Vector3, run: boolean, dt: number): void;
}

function runStepAssist(stepHeight: number, run: boolean, dt: number) {
  const setVelocities: Array<{ x: number; y: number; z: number }> = [];
  let horizontalProbe = 0;
  const castRay = vi.fn((origin: { y: number }, direction: { y: number }) => {
    if (direction.y === 0) {
      horizontalProbe++;
      if (horizontalProbe === 1 && origin.y <= stepHeight) return { timeOfImpact: 0.1 };
      return null;
    }
    return { timeOfImpact: origin.y - stepHeight };
  });
  const ctx = {
    isGrounded: true,
    currentVel: new THREE.Vector3(0, 0, 0),
    currentPos: new THREE.Vector3(0, 0.65, 0),
    currentCapsuleHalfHeight: 0.35,
    config: { capsuleRadius: 0.3 },
    physicsWorld: { castRay },
    body: {
      linvel: () => ({ x: 0, y: 0, z: 0 }),
      setLinvel: (velocity: { x: number; y: number; z: number }) => setVelocities.push({ ...velocity }),
    },
  } as unknown as PlayerContext;
  const mode = new GroundedMode() as unknown as StepAssistAccess;

  mode.applyStepAssist(ctx, new THREE.Vector3(0, 0, 1), run, dt);

  return setVelocities.at(-1);
}

describe("GroundedMode step assist", () => {
  it("converts a walkable step displacement using the supplied timestep", () => {
    const dt = 1 / 30;
    const velocity = runStepAssist(0.2, false, dt);

    expect(velocity?.y).toBeDefined();
    expect((velocity?.y ?? 0) * dt).toBeCloseTo(0.21);
    expect((velocity?.z ?? 0) * dt).toBeCloseTo(0.018);
  });

  it("allows a 0.25 metre walking step but blocks a 0.28 metre walking step", () => {
    expect(runStepAssist(0.25, false, 1 / 60)).toBeDefined();
    expect(runStepAssist(0.28, false, 1 / 60)).toBeUndefined();
  });

  it("allows a 0.28 metre running step at a short timestep", () => {
    const dt = 1 / 120;
    const velocity = runStepAssist(0.28, true, dt);

    expect(velocity?.y).toBeDefined();
    expect((velocity?.y ?? 0) * dt).toBeCloseTo(0.29);
    expect((velocity?.z ?? 0) * dt).toBeCloseTo(0.018);
  });

  it("blocks a 0.35 metre obstacle while running", () => {
    expect(runStepAssist(0.35, true, 1 / 60)).toBeUndefined();
  });
});
