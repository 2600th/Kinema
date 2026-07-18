import type { PlayerController } from "@character/PlayerController";
import { EventBus } from "@core/EventBus";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IInteractable, InteractionSpec } from "./Interactable";
import { InteractionManager } from "./InteractionManager";

type MockFn = ReturnType<typeof vi.fn>;
type TestPhysicsWorld = {
  castRay: MockFn;
  removeCollider: MockFn;
};
type TestPlayer = {
  body: RAPIER.RigidBody;
  position: THREE.Vector3;
  lastInputSnapshot?: { interact: boolean };
};
type TestEventBus = {
  emit: MockFn;
  on: MockFn;
};
type TestInteractable = IInteractable & {
  update: MockFn;
  onFocus: MockFn;
  onBlur: MockFn;
  interact: MockFn;
  dispose: MockFn;
};
type PredicateCollider = Pick<RAPIER.Collider, "handle" | "isSensor">;

function asCollider(handle: number): RAPIER.Collider {
  return { handle } as unknown as RAPIER.Collider;
}

function asPhysicsWorld(physicsWorld: TestPhysicsWorld): PhysicsWorld {
  return physicsWorld as unknown as PhysicsWorld;
}

function asPlayerController(player: TestPlayer): PlayerController {
  return player as unknown as PlayerController;
}

function asEventBus(eventBus: TestEventBus): EventBus {
  return eventBus as unknown as EventBus;
}

function asCanInteract(fn: MockFn): NonNullable<IInteractable["canInteract"]> {
  return fn as unknown as NonNullable<IInteractable["canInteract"]>;
}

function asSetHoldProgress(fn: MockFn): NonNullable<IInteractable["setHoldProgress"]> {
  return fn as unknown as NonNullable<IInteractable["setHoldProgress"]>;
}

vi.mock("@physics/ColliderFactory", () => ({
  ColliderFactory: class {
    createCylinderSensor() {
      return asCollider(999);
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
): TestInteractable {
  const interactable = {
    id,
    label: `label-${id}`,
    position: new THREE.Vector3(x, 0, z),
    collider: asCollider(handle),
    update: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    interact: vi.fn(),
    getInteractionSpec: spec ? () => spec : undefined,
    getIgnoredColliderHandles: ignoredHandles ? () => ignoredHandles : undefined,
    dispose: vi.fn(),
  };
  return interactable as unknown as TestInteractable;
}

describe("InteractionManager", () => {
  let physicsWorld: TestPhysicsWorld;
  let player: TestPlayer;
  let eventBus: TestEventBus;

  beforeEach(() => {
    physicsWorld = {
      castRay: vi.fn(),
      removeCollider: vi.fn(),
    };
    player = {
      body: { handle: 1 } as unknown as RAPIER.RigidBody,
      position: new THREE.Vector3(0, 0, 0),
    };
    eventBus = {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
    };
  });

  it("focuses nearest visible interactable", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );
    const near = makeInteractable("near", 1, 0, 11);
    const far = makeInteractable("far", 2, 0, 12);
    manager.register(near);
    manager.register(far);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });

    expect(near.onFocus).toHaveBeenCalledTimes(1);
    expect(far.onFocus).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith("interaction:focusChanged", {
      id: "near",
      label: "Press F to label-near",
    });
  });

  it("skips occluded nearest interactable", () => {
    physicsWorld.castRay.mockReturnValueOnce({ timeOfImpact: 0.5 }).mockReturnValueOnce(null);

    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );
    const near = makeInteractable("near", 1, 0, 21);
    const far = makeInteractable("far", 2, 0, 22);
    manager.register(near);
    manager.register(far);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });

    expect(near.onFocus).not.toHaveBeenCalled();
    expect(far.onFocus).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith("interaction:focusChanged", {
      id: "far",
      label: "Press F to label-far",
    });
  });

  it("emits blocked event for locked interactables", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );
    const locked = makeInteractable("locked", 1, 0, 51);
    const canInteract = vi.fn(() => ({ allowed: false, reason: "Needs keycard" }));
    locked.canInteract = asCanInteract(canInteract);
    manager.register(locked);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.triggerInteraction();

    expect(locked.interact).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith("interaction:blocked", {
      id: "locked",
      reason: "Needs keycard",
    });
  });

  it("requires hold duration before triggering hold interactable", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );
    const holdDoor = makeInteractable("hold", 1, 0, 61, { mode: "hold", holdDuration: 0.3 });
    manager.register(holdDoor);
    player.lastInputSnapshot = { interact: true };

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.triggerInteraction();
    manager.fixedUpdate(0.1);
    expect(holdDoor.interact).not.toHaveBeenCalled();

    manager.fixedUpdate(0.25);
    expect(holdDoor.interact).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith("interaction:triggered", { id: "hold" });
  });

  it("reports an interaction outcome and refreshes a state-dependent prompt", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );
    const door = makeInteractable("door", 1, 0, 62);
    let open = false;
    Object.defineProperty(door, "label", {
      get: () => (open ? "Close Door" : "Open Door"),
    });
    door.interact.mockImplementation(() => {
      open = true;
      return "opened";
    });
    manager.register(door);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.triggerInteraction();

    expect(eventBus.emit).toHaveBeenCalledWith("interaction:triggered", {
      id: "door",
      outcome: "opened",
    });
    expect(eventBus.emit).toHaveBeenLastCalledWith("interaction:focusChanged", {
      id: "door",
      label: "Press F to Close Door",
    });
  });

  it("refreshes the focused prompt when the input glyph changes without duplicate emissions", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const realEventBus = new EventBus();
    const labels: Array<string | null> = [];
    realEventBus.on("interaction:focusChanged", ({ label }) => labels.push(label));
    let glyph = "F";
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      realEventBus,
      () => glyph,
    );
    manager.register(makeInteractable("door", 1, 0, 63));

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.fixedUpdate(1 / 60);
    glyph = "X";
    realEventBus.emit("input:sourceChanged", { source: "gamepad" });
    manager.fixedUpdate(1 / 60);

    expect(labels).toEqual(["Press F to label-door", "Press X to label-door"]);
    manager.dispose();
  });

  it("refreshes a focused blocked reason only when access state changes", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const realEventBus = new EventBus();
    const labels: Array<string | null> = [];
    realEventBus.on("interaction:focusChanged", ({ label }) => labels.push(label));
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      realEventBus,
    );
    let reason: string | null = null;
    const target = makeInteractable("door", 1, 0, 65);
    target.canInteract = asCanInteract(vi.fn(() => (reason ? { allowed: false, reason } : { allowed: true })));
    manager.register(target);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.fixedUpdate(1 / 60);
    reason = "Needs power";
    manager.fixedUpdate(1 / 60);
    manager.fixedUpdate(1 / 60);

    expect(labels).toEqual(["Press F to label-door", "Needs power"]);
    manager.dispose();
  });

  it("does not re-emit a blocked prompt when only the input glyph changes", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const realEventBus = new EventBus();
    const labels: Array<string | null> = [];
    realEventBus.on("interaction:focusChanged", ({ label }) => labels.push(label));
    let glyph = "F";
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      realEventBus,
      () => glyph,
    );
    const target = makeInteractable("door", 1, 0, 66);
    target.canInteract = asCanInteract(vi.fn(() => ({ allowed: false, reason: "Needs power" })));
    manager.register(target);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    glyph = "X";
    realEventBus.emit("input:sourceChanged", { source: "gamepad" });

    expect(labels).toEqual(["Needs power"]);
    manager.dispose();
  });

  it("unsubscribes from input source changes when disposed", () => {
    const unsubscribe = vi.fn();
    eventBus.on.mockReturnValue(unsubscribe);
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );

    manager.dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("feeds hold progress into the interactable and emits world position for hold VFX", () => {
    physicsWorld.castRay.mockReturnValue(null);
    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );
    const holdTarget = makeInteractable("hold", 1, 0, 64, { mode: "hold", holdDuration: 0.5 });
    const setHoldProgress = vi.fn();
    holdTarget.setHoldProgress = asSetHoldProgress(setHoldProgress);
    manager.register(holdTarget);
    player.lastInputSnapshot = { interact: true };

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });
    manager.triggerInteraction();
    manager.fixedUpdate(0.25);
    player.lastInputSnapshot = { interact: false };
    manager.fixedUpdate(0.05);

    expect(setHoldProgress).toHaveBeenCalledWith(0);
    expect(setHoldProgress).toHaveBeenCalledWith(0.5);
    expect(setHoldProgress).toHaveBeenLastCalledWith(null);
    expect(eventBus.emit).toHaveBeenCalledWith("interaction:holdProgress", {
      id: "hold",
      progress: 0.5,
      position: holdTarget.position.clone(),
    });
  });

  it("does not treat interactable-owned collider as LOS blocker", () => {
    const ownSolidHandle = 777;
    physicsWorld.castRay.mockImplementation(
      (_origin, _direction, _distance, _solid, _exclude, predicate?: (collider: PredicateCollider) => boolean) => {
        const collider: PredicateCollider = {
          handle: ownSolidHandle,
          isSensor: () => false,
        };
        return predicate?.(collider) ? { timeOfImpact: 0.15 } : null;
      },
    );

    const manager = new InteractionManager(
      asPhysicsWorld(physicsWorld),
      asPlayerController(player),
      asEventBus(eventBus),
    );
    const doorLike = makeInteractable("door", 1, 0, 71, undefined, [ownSolidHandle]);
    manager.register(doorLike);

    manager.refreshFocusFromPosition({ x: 0, y: 0, z: 0 });

    expect(doorLike.onFocus).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith("interaction:focusChanged", {
      id: "door",
      label: "Press F to label-door",
    });
  });
});
