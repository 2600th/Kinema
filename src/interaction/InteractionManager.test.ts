import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { InteractionManager } from './InteractionManager';
import type { IInteractable, InteractionSpec } from './Interactable';

vi.mock('@physics/ColliderFactory', () => ({
  ColliderFactory: class {
    createCylinderSensor() {
      return { handle: 999 };
    }
  },
}));

function makeInteractable(
  id: string,
  x: number,
  z: number,
  handle: number,
  spec?: InteractionSpec,
  ignoredHandles?: number[],
): IInteractable {
  return {
    id,
    label: `label-${id}`,
    position: new THREE.Vector3(x, 0, z),
    collider: { handle } as any,
    update: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    interact: vi.fn(),
    getInteractionSpec: spec ? vi.fn(() => spec) : undefined,
    getIgnoredColliderHandles: ignoredHandles ? vi.fn(() => ignoredHandles) : undefined,
    dispose: vi.fn(),
  };
}

describe('InteractionManager', () => {
  let physicsWorld: { castRay: ReturnType<typeof vi.fn>; removeCollider: ReturnType<typeof vi.fn> };
  let player: { body: unknown; position: THREE.Vector3 };
  let eventBus: { emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    physicsWorld = {
      castRay: vi.fn(),
      removeCollider: vi.fn(),
    };
    player = {
      body: { handle: 1 },
      position: new THREE.Vector3(0, 0, 0),
    };
    eventBus = {
      emit: vi.fn(),
    };
  });

  it('focuses nearest visible interactable', () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(physicsWorld as any, player as any, eventBus as any);
    const near = makeInteractable('near', 1, 0, 11);
    const far = makeInteractable('far', 2, 0, 12);
    manager.register(near);
    manager.register(far);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });

    expect(near.onFocus).toHaveBeenCalledTimes(1);
    expect(far.onFocus).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('interaction:focusChanged', {
      id: 'near',
      label: 'Press E to label-near',
    });
  });

  it('skips occluded nearest interactable', () => {
    physicsWorld.castRay
      .mockReturnValueOnce({ timeOfImpact: 0.5 }) // near target is blocked
      .mockReturnValueOnce(null); // far target is clear

    const manager = new InteractionManager(physicsWorld as any, player as any, eventBus as any);
    const near = makeInteractable('near', 1, 0, 21);
    const far = makeInteractable('far', 2, 0, 22);
    manager.register(near);
    manager.register(far);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });

    expect(near.onFocus).not.toHaveBeenCalled();
    expect(far.onFocus).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith('interaction:focusChanged', {
      id: 'far',
      label: 'Press E to label-far',
    });
  });

  it('emits blocked event for locked interactables', () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(physicsWorld as any, player as any, eventBus as any);
    const locked = makeInteractable('locked', 1, 0, 51);
    locked.canInteract = vi.fn(() => ({ allowed: false, reason: 'Needs keycard' }));
    manager.register(locked);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.triggerInteraction();

    expect(locked.interact).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('interaction:blocked', {
      id: 'locked',
      reason: 'Needs keycard',
    });
  });

  it('requires hold duration before triggering hold interactable', () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(physicsWorld as any, player as any, eventBus as any);
    const holdDoor = makeInteractable('hold', 1, 0, 61, { mode: 'hold', holdDuration: 0.3 });
    manager.register(holdDoor);
    (player as any).lastInputSnapshot = { interact: true };

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.triggerInteraction();
    manager.fixedUpdate(0.1);
    expect(holdDoor.interact).not.toHaveBeenCalled();

    manager.fixedUpdate(0.25);
    expect(holdDoor.interact).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith('interaction:triggered', { id: 'hold' });
  });

  it('does not treat interactable-owned collider as LOS blocker', () => {
    const ownSolidHandle = 777;
    physicsWorld.castRay.mockImplementation(
      (_origin, _direction, _distance, _solid, _exclude, predicate?: (collider: any) => boolean) => {
        const collider = { isSensor: () => false, handle: ownSolidHandle };
        return predicate?.(collider) ? { timeOfImpact: 0.15 } : null;
      },
    );
    const manager = new InteractionManager(physicsWorld as any, player as any, eventBus as any);
    const doorLike = makeInteractable('door', 1, 0, 71, undefined, [ownSolidHandle]);
    manager.register(doorLike);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });

    expect(doorLike.onFocus).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith('interaction:focusChanged', {
      id: 'door',
      label: 'Press E to label-door',
    });
  });
});
