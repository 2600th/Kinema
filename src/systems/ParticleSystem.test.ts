import { EventBus } from "@core/EventBus";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParticleSystem } from "./ParticleSystem";

function installCanvasShim(): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag !== "canvas") return {};
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            createRadialGradient: () => ({
              addColorStop: vi.fn(),
            }),
            fillStyle: "",
            fillRect: vi.fn(),
          }),
        };
      },
    },
  });
}

function createSystem() {
  const eventBus = new EventBus();
  const renderer = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    getGraphicsProfile: vi.fn(() => "performance"),
  };
  const playerController = {
    body: { linvel: () => ({ x: 0, z: 0 }) },
    isGrounded: true,
    groundPosition: new THREE.Vector3(),
  };
  const vehicleManager = {
    isActive: vi.fn(() => false),
  };
  const system = new ParticleSystem(renderer as any, eventBus, playerController as any, vehicleManager as any);
  return { eventBus, renderer, system };
}

describe("ParticleSystem", () => {
  beforeEach(() => {
    installCanvasShim();
  });

  it("shares one lazy GameParticles instance across concurrent effects", async () => {
    const { eventBus, renderer } = createSystem();

    eventBus.emit("level:loaded", { name: "test" });
    eventBus.emit("player:jumped", {
      airJump: false,
      groundPosition: new THREE.Vector3(1, 2, 3),
      jumpVel: 0,
      position: new THREE.Vector3(1, 3, 3),
      run: false,
    });
    await vi.dynamicImportSettled();

    expect(renderer.scene.children).toHaveLength(10);
  });

  it("does not retain a particle instance created after dispose", async () => {
    const { eventBus, renderer, system } = createSystem();

    eventBus.emit("level:loaded", { name: "test" });
    system.dispose();
    await vi.dynamicImportSettled();

    expect(renderer.scene.children).toHaveLength(0);
    expect((system as any).gameParticles).toBeNull();
  });

  it("clears and hides its particle roots for deterministic captures", async () => {
    const { eventBus, renderer, system } = createSystem();
    eventBus.emit("level:loaded", { name: "test" });
    eventBus.emit("player:jumped", {
      airJump: false,
      groundPosition: new THREE.Vector3(1, 2, 3),
      jumpVel: 0,
      position: new THREE.Vector3(1, 3, 3),
      run: false,
    });
    await vi.dynamicImportSettled();

    await system.freezeForCapture();

    expect(renderer.scene.children).toHaveLength(10);
    expect(renderer.scene.children.every((child) => !child.visible)).toBe(true);
    expect(renderer.scene.children.every((child) => (child as THREE.InstancedMesh).count === 0)).toBe(true);
  });

  it("routes final collection and vehicle transitions through existing lazy particles", async () => {
    const { eventBus, system } = createSystem();
    eventBus.emit("level:loaded", { name: "test" });
    await vi.dynamicImportSettled();
    const particles = (system as any).gameParticles;
    const celebration = vi.spyOn(particles, "coinCelebration");
    const vehicleDust = vi.spyOn(particles, "vehicleTransitionDust");
    const completionPosition = new THREE.Vector3(1, 2, 3);
    const vehiclePosition = new THREE.Vector3(4, 5, 6);
    const seatPosition = new THREE.Vector3(7, 8, 9);

    eventBus.emit("collectible:allCollected", { count: 70, total: 70, position: completionPosition });
    eventBus.emit("vehicle:enter", {
      vehicle: { mesh: { position: vehiclePosition } } as any,
      position: seatPosition,
    });
    eventBus.emit("vehicle:exit", { position: vehiclePosition });

    expect(celebration).toHaveBeenCalledExactlyOnceWith(completionPosition);
    expect(vehicleDust).toHaveBeenNthCalledWith(1, seatPosition);
    expect(vehicleDust).toHaveBeenNthCalledWith(2, vehiclePosition);
  });

  it("advances retained grounded handling and boost state with current profile density", async () => {
    const { eventBus, system } = createSystem();
    eventBus.emit("level:loaded", { name: "vehicles" });
    await vi.dynamicImportSettled();
    const particles = (system as any).gameParticles;
    const motionSpy = vi.spyOn(particles, "updateVehicleMotion");
    const handling = {
      speedNorm: 0.8,
      forwardSpeed: 12,
      lateralSpeed: 1,
      slipAngle: 0.2,
      slipRatio: 0.1,
      slipSign: 1,
      driftAmount: 0.7,
      driftState: "drift" as const,
      handbrake: true,
      grounded: true,
      groundedWheelCount: 2,
      wheelContactPositions: [new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, -1), null, null],
    };

    eventBus.emit("vehicle:handlingUpdate", handling);
    eventBus.emit("vehicle:boostChanged", { active: true });
    system.update(0.25, 0);

    expect(motionSpy).toHaveBeenLastCalledWith(handling, true, 0.25, 0.35);
    expect(system.getDebugState().vehicle.emitted).toMatchObject({
      dust: expect.any(Number),
      skid: expect.any(Number),
      boost: expect.any(Number),
    });
    expect(system.getDebugState().vehicle.emitted.dust).toBeGreaterThan(0);
    expect(system.getDebugState().vehicle.emitted.skid).toBeGreaterThan(0);
    expect(system.getDebugState().vehicle.emitted.boost).toBeGreaterThan(0);

    eventBus.emit("vehicle:handlingUpdate", null);
    eventBus.emit("vehicle:boostChanged", { active: false });
    system.update(1, 0);
    expect(motionSpy).toHaveBeenLastCalledWith(null, false, 1, 0.35);
    expect(system.getDebugState().vehicle.active).toEqual({ dust: 0, skid: 0, boost: 0 });
  });
});
