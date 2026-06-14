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
});
