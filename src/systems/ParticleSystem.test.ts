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

    expect(renderer.scene.children).toHaveLength(7);
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

    expect(renderer.scene.children).toHaveLength(7);
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
});
