import type { PlayerController } from "@character/PlayerController";
import { EventBus } from "@core/EventBus";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { PhysicsRope } from "./PhysicsRope";

type RopeInternals = {
  id: string;
  eventBus: EventBus;
  segmentBodies: Array<Record<string, ReturnType<typeof vi.fn>>>;
  physicsWorld: {
    world: { createImpulseJoint: ReturnType<typeof vi.fn>; removeImpulseJoint: ReturnType<typeof vi.fn> };
  };
  attachedPlayer: PlayerController | null;
  attachJoint: { setContactsEnabled: ReturnType<typeof vi.fn> } | null;
  attachedSegmentIndex: number;
  climbStepCooldown: number;
  playerBaseSolverIters: number;
  jointBallMaterial: { emissive: { setHex: ReturnType<typeof vi.fn> }; emissiveIntensity: number };
  detachPlayer: (jumpOff: boolean) => void;
};

function makeRope(eventBus: EventBus): PhysicsRope {
  const joint = { setContactsEnabled: vi.fn() };
  const segment = {
    translation: vi.fn(() => ({ x: 0, y: 2, z: 0 })),
    setLinearDamping: vi.fn(),
    setAngularDamping: vi.fn(),
    wakeUp: vi.fn(),
  };
  const rope = Object.create(PhysicsRope.prototype) as PhysicsRope;
  Object.assign(rope as unknown as RopeInternals, {
    id: "rope1",
    eventBus,
    segmentBodies: [segment],
    physicsWorld: {
      world: {
        createImpulseJoint: vi.fn(() => joint),
        removeImpulseJoint: vi.fn(),
      },
    },
    attachedPlayer: null,
    attachJoint: null,
    attachedSegmentIndex: -1,
    climbStepCooldown: 0,
    playerBaseSolverIters: 2,
    jointBallMaterial: { emissive: { setHex: vi.fn() }, emissiveIntensity: 0 },
  });
  return rope;
}

function makePlayer(): PlayerController {
  return {
    position: new THREE.Vector3(),
    config: { capsuleHalfHeight: 0.6, capsuleRadius: 0.3 },
    body: {
      linvel: vi.fn(() => ({ x: 1, y: 0, z: 0 })),
      setTranslation: vi.fn(),
      setLinvel: vi.fn(),
      setAngvel: vi.fn(),
      setAdditionalSolverIterations: vi.fn(),
      wakeUp: vi.fn(),
    },
    attachToRope: vi.fn(),
    detachFromRope: vi.fn(),
  } as unknown as PlayerController;
}

describe("PhysicsRope interaction lifecycle", () => {
  it("emits after attach and once after the common detach transition", () => {
    const eventBus = new EventBus();
    const lifecycle: string[] = [];
    eventBus.on("interaction:ropeAttached", ({ id }) => lifecycle.push(`attached:${id}`));
    eventBus.on("interaction:ropeReleased", ({ id }) => lifecycle.push(`released:${id}`));
    const rope = makeRope(eventBus);
    const player = makePlayer();

    expect(rope.interact(player)).toBe("attached");
    expect(lifecycle).toEqual(["attached:rope1"]);
    expect(rope.interact(player)).toBeUndefined();

    const internals = rope as unknown as RopeInternals;
    internals.detachPlayer(false);
    internals.detachPlayer(false);
    expect(lifecycle).toEqual(["attached:rope1", "released:rope1"]);
  });
});
