import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../core/EventBus";
import { InteractableSystem } from "./InteractableSystem";

function createSystem(now: () => number, force: () => number) {
  const showStatus = vi.fn();
  const contact = { collider1: 7, collider2: 99 };
  const eventQueue = {
    drainContactForceEvents: vi.fn((visit: (event: unknown) => void) => {
      visit({
        collider1: () => contact.collider1,
        collider2: () => contact.collider2,
        totalForceMagnitude: force,
      });
    }),
  };
  const eventBus = new EventBus();
  const system = new InteractableSystem(
    { scene: {} } as never,
    { eventQueue } as never,
    eventBus,
    { register: vi.fn(), unregister: vi.fn() } as never,
    {} as never,
    { clear: vi.fn() } as never,
    { getDynamicBodies: vi.fn(() => []) } as never,
    { hud: { showStatus } } as never,
    now,
  );
  return { contact, eventBus, eventQueue, system, showStatus };
}

describe("InteractableSystem impact toast grace", () => {
  it("drains unarmed settle contacts without ever showing impact feedback", () => {
    let now = 1_000;
    const force = 13;
    const { eventQueue, system, showStatus } = createSystem(
      () => now,
      () => force,
    );

    system.setupStation("steps");
    const throwable = { id: "settling-prop", postPhysicsUpdate: vi.fn() };
    const internals = system as unknown as {
      throwableObjects: Map<number, typeof throwable>;
    };
    internals.throwableObjects.set(7, throwable);
    system.postPhysicsUpdate(1 / 60);
    now = 2_499;
    system.postPhysicsUpdate(1 / 60);

    expect(showStatus).not.toHaveBeenCalled();

    now = 2_500;
    system.postPhysicsUpdate(1 / 60);
    expect(showStatus).not.toHaveBeenCalled();
    expect(eventQueue.drainContactForceEvents).toHaveBeenCalledTimes(3);
  });

  it("shows one post-grace toast for the first above-threshold contact after a throw", () => {
    let now = 1_000;
    let force = 13;
    const { contact, eventBus, system, showStatus } = createSystem(
      () => now,
      () => force,
    );

    system.setupStation("steps");
    const settlingThrowable = { id: "settling-prop", postPhysicsUpdate: vi.fn() };
    const throwable = { id: "thrown-prop", postPhysicsUpdate: vi.fn() };
    const internals = system as unknown as {
      carriedThrowable: typeof throwable | null;
      impactToastArmed: Set<string>;
      throwableObjects: Map<number, typeof throwable | typeof settlingThrowable>;
    };
    internals.throwableObjects.set(7, settlingThrowable);
    internals.throwableObjects.set(8, throwable);

    internals.carriedThrowable = throwable;
    eventBus.emit("interaction:throw", { direction: {} as never, force: 16 });
    contact.collider1 = 7;
    contact.collider2 = 8;
    system.postPhysicsUpdate(1 / 60);
    expect(showStatus).not.toHaveBeenCalled();

    now = 2_500;
    contact.collider1 = 8;
    contact.collider2 = 99;
    system.postPhysicsUpdate(1 / 60);
    expect(showStatus).not.toHaveBeenCalled();

    internals.carriedThrowable = throwable;
    eventBus.emit("interaction:throw", { direction: {} as never, force: 16 });
    contact.collider1 = 7;
    contact.collider2 = 8;

    force = 12;
    system.postPhysicsUpdate(1 / 60);
    expect(showStatus).not.toHaveBeenCalled();

    force = 13;
    system.postPhysicsUpdate(1 / 60);
    system.postPhysicsUpdate(1 / 60);
    expect(showStatus).toHaveBeenCalledOnce();
    expect(showStatus).toHaveBeenCalledWith("Impact!", 700);
    expect(internals.impactToastArmed).not.toContain("thrown-prop");
  });

  it("starts the same grace boundary for a full level setup", () => {
    let now = 4_000;
    const { system } = createSystem(
      () => now,
      () => 0,
    );
    const internals = system as unknown as {
      impactToastGraceUntil: number;
      spawnInteractables: () => void;
    };
    internals.spawnInteractables = vi.fn();

    system.setupLevel();
    expect(internals.impactToastGraceUntil).toBe(5_500);

    now = 8_000;
    system.setupLevel();
    expect(internals.impactToastGraceUntil).toBe(9_500);
  });
});
