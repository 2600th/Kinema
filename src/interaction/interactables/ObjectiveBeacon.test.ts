import type { PlayerController } from "@character/PlayerController";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ObjectiveBeacon } from "./ObjectiveBeacon";

type BeaconInternals = {
  beaconMaterial: THREE.MeshStandardMaterial;
  beaconLight: THREE.PointLight;
};

type TestPhysicsWorld = {
  world: {
    createRigidBody: ReturnType<typeof vi.fn>;
    createCollider: ReturnType<typeof vi.fn>;
  };
  removeBody: ReturnType<typeof vi.fn>;
};

function createPhysicsWorld(): TestPhysicsWorld {
  return {
    world: {
      createRigidBody: vi.fn(() => ({ handle: 1 }) as unknown as RAPIER.RigidBody),
      createCollider: vi.fn(() => ({ handle: 2 }) as unknown as RAPIER.Collider),
    },
    removeBody: vi.fn(),
  };
}

function asPhysicsWorld(physicsWorld: TestPhysicsWorld): PhysicsWorld {
  return physicsWorld as unknown as PhysicsWorld;
}

function getBeaconInternals(beacon: ObjectiveBeacon): BeaconInternals {
  return beacon as unknown as BeaconInternals;
}

describe("ObjectiveBeacon", () => {
  it("uses a 3-second hold interaction spec", () => {
    const physicsWorld = createPhysicsWorld();
    const beacon = new ObjectiveBeacon(
      "beacon1",
      new THREE.Vector3(0, 0, 0),
      new THREE.Scene(),
      asPhysicsWorld(physicsWorld),
    );

    expect(beacon.getInteractionSpec()).toEqual({ mode: "hold", holdDuration: 3 });
    beacon.dispose();
  });

  it("charges up while held, resets when released, and locks once activated", () => {
    const physicsWorld = createPhysicsWorld();
    const beacon = new ObjectiveBeacon(
      "beacon1",
      new THREE.Vector3(0, 0, 0),
      new THREE.Scene(),
      asPhysicsWorld(physicsWorld),
    );

    const baseIntensity = getBeaconInternals(beacon).beaconMaterial.emissiveIntensity;
    beacon.onFocus();
    beacon.setHoldProgress(0.72);
    for (let i = 0; i < 18; i++) {
      beacon.update(1 / 60);
    }
    const chargedIntensity = getBeaconInternals(beacon).beaconMaterial.emissiveIntensity;

    beacon.onBlur();
    beacon.setHoldProgress(null);
    for (let i = 0; i < 28; i++) {
      beacon.update(1 / 60);
    }
    const releasedIntensity = getBeaconInternals(beacon).beaconMaterial.emissiveIntensity;

    expect(chargedIntensity).toBeGreaterThan(baseIntensity);
    expect(releasedIntensity).toBeLessThan(chargedIntensity);
    expect(beacon.canInteract({ isGrounded: true } as PlayerController)).toEqual({ allowed: true });

    beacon.interact({} as PlayerController);
    beacon.update(1 / 60);

    expect(beacon.canInteract({ isGrounded: true } as PlayerController)).toEqual({
      allowed: false,
      reason: "Beacon online",
    });
    expect(getBeaconInternals(beacon).beaconLight.intensity).toBeGreaterThan(2);
    beacon.dispose();
  });
});
