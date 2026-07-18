import type { PlayerController } from "@character/PlayerController";
import { EventBus } from "@core/EventBus";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Door } from "./Door";

function createPhysicsWorld(): PhysicsWorld {
  const makeBody = () =>
    ({
      handle: 1,
      setNextKinematicTranslation: vi.fn(),
      setNextKinematicRotation: vi.fn(),
    }) as unknown as RAPIER.RigidBody;
  return {
    world: {
      createRigidBody: vi.fn(makeBody),
      createCollider: vi.fn(() => ({ handle: 2 }) as unknown as RAPIER.Collider),
    },
    removeCollider: vi.fn(),
    removeBody: vi.fn(),
  } as unknown as PhysicsWorld;
}

describe("Door", () => {
  it("reports and emits each committed open state", () => {
    const eventBus = new EventBus();
    const toggles: boolean[] = [];
    eventBus.on("interaction:doorToggled", ({ open }) => toggles.push(open));
    const door = new Door("door1", new THREE.Vector3(), new THREE.Scene(), createPhysicsWorld(), eventBus);
    const player = { isGrounded: true, position: new THREE.Vector3(0, 0, 1) } as PlayerController;

    expect(door.interact(player)).toBe("opened");
    expect(door.label).toBe("Close Door");
    expect(door.interact(player)).toBe("closed");
    expect(door.label).toBe("Open Door");
    expect(toggles).toEqual([true, false]);
    door.dispose();
  });
});
