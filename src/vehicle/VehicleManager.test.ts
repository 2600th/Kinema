import { EventBus } from "@core/EventBus";
import { NULL_INPUT } from "@core/types";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { VehicleController } from "./VehicleController";
import { isVehicleManualResetEligible, VehicleManager } from "./VehicleManager";

function createVehicle() {
  const spawn = { position: new THREE.Vector3(4, 1, 2) };
  return {
    id: "vehicle-1",
    type: "car" as const,
    mesh: new THREE.Group(),
    body: {
      wakeUp: vi.fn(),
      linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
      rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    },
    cameraConfig: { heightOffset: 1 },
    enter: vi.fn(),
    exit: vi.fn(() => spawn),
    setInput: vi.fn(),
    fixedUpdate: vi.fn(),
    postPhysicsUpdate: vi.fn(),
    update: vi.fn(),
    resetToSpawn: vi.fn(),
    dispose: vi.fn(),
  };
}

function createManager() {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, "emit");
  const player = {
    position: new THREE.Vector3(2, 1, 3),
    setActive: vi.fn(),
    setEnabled: vi.fn(),
    suppressInteract: vi.fn(),
    spawn: vi.fn(),
    grabCarry: { isGrabbing: false, isCarrying: false },
  };
  const camera = {
    applyCameraConfig: vi.fn(),
    setTarget: vi.fn(),
    setChaseMode: vi.fn(),
    snapToTarget: vi.fn(),
    setVehicleSpeedRatio: vi.fn(),
    setVehicleHandlingFeel: vi.fn(),
    resetTarget: vi.fn(),
    resetCameraConfig: vi.fn(),
    getYaw: vi.fn(() => 0),
  };
  const interactionManager = {
    setEnabled: vi.fn(),
  };
  const manager = new VehicleManager(eventBus, player as any, camera as any, interactionManager as any);
  return { eventBus, emitSpy, player, manager };
}

describe("VehicleManager", () => {
  it("initializes vehicle entry neutrally before accepting the next raw vehicle input", () => {
    const { eventBus, manager } = createManager();
    const vehicle = createVehicle();
    manager.register(vehicle as unknown as VehicleController);
    manager.setInput({ ...NULL_INPUT, crouch: true, crouchPressed: true, sprint: true });

    eventBus.emit("vehicle:enter", { vehicle: vehicle as unknown as VehicleController });

    expect(vehicle.enter).toHaveBeenCalledWith(NULL_INPUT);
    const vehicleInput = { ...NULL_INPUT, crouch: true, sprint: true };
    manager.setInput(vehicleInput);
    expect(vehicle.setInput).toHaveBeenCalledWith(vehicleInput);
  });

  it("emits held boost edges once and clears boost on exit", () => {
    const { eventBus, manager } = createManager();
    const vehicle = createVehicle();
    const boostChanged = vi.fn();
    eventBus.on("vehicle:boostChanged", boostChanged);
    manager.register(vehicle as unknown as VehicleController);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as unknown as VehicleController });

    manager.setInput({ ...NULL_INPUT, sprint: true });
    manager.setInput({ ...NULL_INPUT, sprint: true });
    manager.setInput(NULL_INPUT);
    manager.setInput(NULL_INPUT);
    manager.setInput({ ...NULL_INPUT, sprint: true });
    manager.requestExit();

    expect(boostChanged.mock.calls.map(([payload]) => payload.active)).toEqual([true, false, true, false]);
  });

  it("allows manual recovery only when stationary or upside-down", () => {
    const upright = { x: 0, y: 0, z: 0, w: 1 };
    const upsideDown = { x: 1, y: 0, z: 0, w: 0 };

    expect(isVehicleManualResetEligible({ x: 0.49, y: 12, z: 0 }, upright)).toBe(true);
    expect(isVehicleManualResetEligible({ x: 0.5, y: 0, z: 0 }, upright)).toBe(false);
    expect(isVehicleManualResetEligible({ x: 8, y: 0, z: 4 }, upsideDown)).toBe(true);
  });

  it("resets once after a continuous eligible 1.5-second crouch hold", () => {
    const { eventBus, emitSpy, manager } = createManager();
    const vehicle = createVehicle();
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });
    emitSpy.mockClear();

    manager.setInput({ ...NULL_INPUT, crouch: true });
    manager.fixedUpdate(0.75);
    expect(vehicle.resetToSpawn).not.toHaveBeenCalled();
    manager.fixedUpdate(0.75);

    expect(vehicle.resetToSpawn).toHaveBeenCalledTimes(1);
    expect(vehicle.enter).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenCalledWith("vehicle:reset", { id: vehicle.id });
    expect(emitSpy).toHaveBeenCalledWith("vehicle:resetHoldProgress", null);
  });

  it("cancels partial reset progress when crouch is released", () => {
    const { eventBus, emitSpy, manager } = createManager();
    const vehicle = createVehicle();
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });
    emitSpy.mockClear();

    manager.setInput({ ...NULL_INPUT, crouch: true });
    manager.fixedUpdate(1);
    manager.setInput(NULL_INPUT);
    manager.fixedUpdate(1 / 60);
    manager.setInput({ ...NULL_INPUT, crouch: true });
    manager.fixedUpdate(0.6);

    expect(vehicle.resetToSpawn).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith("vehicle:resetHoldProgress", null);
  });

  it("requires crouch release before another completed reset", () => {
    const { eventBus, manager } = createManager();
    const vehicle = createVehicle();
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });

    manager.setInput({ ...NULL_INPUT, crouch: true });
    manager.fixedUpdate(3);
    manager.fixedUpdate(3);

    expect(vehicle.resetToSpawn).toHaveBeenCalledTimes(1);
  });

  it("clears partial reset progress when the active vehicle exits", () => {
    const { eventBus, emitSpy, manager } = createManager();
    const vehicle = createVehicle();
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });
    manager.setInput({ ...NULL_INPUT, crouch: true });
    manager.fixedUpdate(0.5);
    emitSpy.mockClear();

    manager.requestExit();

    expect(emitSpy).toHaveBeenCalledWith("vehicle:resetHoldProgress", null);
  });

  it("does not consume the drone crouch-to-descend control as a reset hold", () => {
    const { eventBus, emitSpy, manager } = createManager();
    const vehicle = { ...createVehicle(), type: "drone" as const };
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });
    emitSpy.mockClear();

    manager.setInput({ ...NULL_INPUT, crouch: true });
    manager.fixedUpdate(2);

    expect(vehicle.resetToSpawn).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalledWith("vehicle:resetHoldProgress", expect.anything());
  });

  it("keeps the player seated when no capsule-safe exit can be found", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { eventBus, emitSpy, player, manager } = createManager();
    const vehicle = createVehicle();
    vehicle.exit.mockImplementation(() => {
      throw new Error("blocked roof");
    });
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });
    emitSpy.mockClear();

    manager.requestExit();

    expect(manager.isActive()).toBe(true);
    expect(vehicle.enter).toHaveBeenCalledTimes(2);
    expect(player.setEnabled).not.toHaveBeenLastCalledWith(true);
    expect(emitSpy).toHaveBeenCalledWith("interaction:blocked", {
      id: vehicle.id,
      reason: "No safe vehicle exit found",
    });
    warnSpy.mockRestore();
  });

  it("uses the pre-entry player pose when a forced exit cannot find safe vehicle space", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { eventBus, player, manager } = createManager();
    const vehicle = createVehicle();
    vehicle.exit.mockImplementation(() => {
      throw new Error("blocked roof");
    });
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });

    manager.forceExit();

    expect(manager.isActive()).toBe(false);
    expect(player.setEnabled).toHaveBeenLastCalledWith(true);
    expect(player.spawn).toHaveBeenCalledWith({ position: new THREE.Vector3(2, 1, 3), rotation: undefined });
    warnSpy.mockRestore();
  });

  it("clears a vehicle even when its safe-exit search fails during teardown", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { eventBus, manager } = createManager();
    const vehicle = createVehicle();
    vehicle.exit.mockImplementation(() => {
      throw new Error("blocked roof");
    });
    manager.register(vehicle as any);
    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });

    manager.clear();

    expect(manager.isActive()).toBe(false);
    expect(vehicle.dispose).toHaveBeenCalledTimes(1);
    expect(manager.getVehicleIds()).toEqual([]);
    warnSpy.mockRestore();
  });

  it("emits the normal exit lifecycle when clearing an active vehicle", () => {
    const { eventBus, emitSpy, player, manager } = createManager();
    const vehicle = createVehicle();
    manager.register(vehicle as any);

    eventBus.emit("vehicle:enter", { vehicle: vehicle as any });
    emitSpy.mockClear();

    manager.clear();

    expect(vehicle.exit).toHaveBeenCalledTimes(1);
    expect(player.spawn).toHaveBeenCalledWith({ position: expect.any(THREE.Vector3) });
    expect(emitSpy).toHaveBeenCalledWith("vehicle:engineStop", undefined);
    expect(emitSpy).toHaveBeenCalledWith("vehicle:handlingUpdate", null);
    expect(emitSpy).toHaveBeenCalledWith("vehicle:exit", { position: vehicle.exit.mock.results[0].value.position });
  });
});
