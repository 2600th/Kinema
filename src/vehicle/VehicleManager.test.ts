import { EventBus } from "@core/EventBus";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { VehicleManager } from "./VehicleManager";

function createVehicle() {
  const spawn = { position: new THREE.Vector3(4, 1, 2) };
  return {
    id: "vehicle-1",
    mesh: new THREE.Group(),
    body: {
      wakeUp: vi.fn(),
      linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
    },
    cameraConfig: { heightOffset: 1 },
    enter: vi.fn(),
    exit: vi.fn(() => spawn),
    setInput: vi.fn(),
    fixedUpdate: vi.fn(),
    postPhysicsUpdate: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  };
}

function createManager() {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, "emit");
  const player = {
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
