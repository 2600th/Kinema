import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ObjectiveBeacon } from './ObjectiveBeacon';

function createPhysicsWorld() {
  return {
    world: {
      createRigidBody: vi.fn(() => ({ handle: 1 })),
      createCollider: vi.fn(() => ({ handle: 2 })),
    },
    removeBody: vi.fn(),
  };
}

describe('ObjectiveBeacon', () => {
  it('uses a 3-second hold interaction spec', () => {
    const physicsWorld = createPhysicsWorld();
    const beacon = new ObjectiveBeacon('beacon1', new THREE.Vector3(0, 0, 0), new THREE.Scene(), physicsWorld as any);

    expect(beacon.getInteractionSpec()).toEqual({ mode: 'hold', holdDuration: 3 });
    beacon.dispose();
  });

  it('charges up while held, resets when released, and locks once activated', () => {
    const physicsWorld = createPhysicsWorld();
    const beacon = new ObjectiveBeacon('beacon1', new THREE.Vector3(0, 0, 0), new THREE.Scene(), physicsWorld as any);

    const baseIntensity = (beacon as any).beaconMaterial.emissiveIntensity;
    beacon.onFocus();
    beacon.setHoldProgress(0.72);
    for (let i = 0; i < 18; i++) {
      beacon.update(1 / 60);
    }
    const chargedIntensity = (beacon as any).beaconMaterial.emissiveIntensity;

    beacon.onBlur();
    beacon.setHoldProgress(null);
    for (let i = 0; i < 28; i++) {
      beacon.update(1 / 60);
    }
    const releasedIntensity = (beacon as any).beaconMaterial.emissiveIntensity;

    expect(chargedIntensity).toBeGreaterThan(baseIntensity);
    expect(releasedIntensity).toBeLessThan(chargedIntensity);
    expect(beacon.canInteract({ isGrounded: true } as any)).toEqual({ allowed: true });

    beacon.interact({} as any);
    beacon.update(1 / 60);

    expect(beacon.canInteract({ isGrounded: true } as any)).toEqual({ allowed: false, reason: 'Beacon online' });
    expect((beacon as any).beaconLight.intensity).toBeGreaterThan(2);
    beacon.dispose();
  });
});
