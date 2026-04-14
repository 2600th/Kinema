import { getProceduralSpikePlacements } from "@level/SpikeLayout";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { SpikeHazardSystem } from "./SpikeHazardSystem";

function createSystem() {
  const scene = new THREE.Scene();
  const playerController = {
    isActive: true,
    groundPosition: new THREE.Vector3(1000, 1000, 1000),
  };
  const vehicleManager = {
    isActive: vi.fn(() => false),
  };
  const healthSystem = {
    isInvulnerable: vi.fn(() => false),
    applySpikeDamage: vi.fn(() => ({ accepted: true, deathTriggered: false, resolution: null })),
  };

  const system = new SpikeHazardSystem(scene, playerController as any, vehicleManager as any, healthSystem as any);
  return { scene, playerController, vehicleManager, healthSystem, system };
}

describe("SpikeHazardSystem", () => {
  it("filters station setup to the requested hazard subset", () => {
    const { system } = createSystem();

    system.setupStation("slopes");

    const hazards = system.listHazards();
    expect(hazards).toHaveLength(getProceduralSpikePlacements("slopes").length);
    expect(hazards.every((hazard) => hazard.station === "slopes")).toBe(true);
    system.dispose();
  });

  it("damages the player on overlap and skips hits while invulnerable or seated", () => {
    const { playerController, vehicleManager, healthSystem, system } = createSystem();
    system.setupStation("platformsPhysics");
    const [firstHazard] = system.listHazards();
    expect(firstHazard).toBeDefined();

    playerController.groundPosition.set(firstHazard.position.x, firstHazard.position.y, firstHazard.position.z);
    system.fixedUpdate(1 / 60);
    expect(healthSystem.applySpikeDamage).toHaveBeenCalledTimes(1);

    healthSystem.isInvulnerable.mockReturnValue(true);
    system.fixedUpdate(1 / 60);
    expect(healthSystem.applySpikeDamage).toHaveBeenCalledTimes(1);

    healthSystem.isInvulnerable.mockReturnValue(false);
    vehicleManager.isActive.mockReturnValue(true);
    system.fixedUpdate(1 / 60);
    expect(healthSystem.applySpikeDamage).toHaveBeenCalledTimes(1);

    system.dispose();
  });

  it("keeps hazard visuals out of Three.js raycast hits", () => {
    const { scene, system } = createSystem();
    system.setupStation("steps");

    const [firstHazard] = system.listHazards();
    expect(firstHazard).toBeDefined();

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(firstHazard.position.x, firstHazard.position.y + 1, firstHazard.position.z - 2),
      new THREE.Vector3(0, 0, 1),
    );
    const hits = raycaster.intersectObjects(scene.children, true);

    expect(hits).toHaveLength(0);
    system.dispose();
  });
});
