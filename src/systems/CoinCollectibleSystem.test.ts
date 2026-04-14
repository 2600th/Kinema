import { EventBus } from "@core/EventBus";
import { getProceduralCoinPlacements } from "@level/CoinLayout";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CoinCollectibleSystem } from "./CoinCollectibleSystem";

function createSystem() {
  const scene = new THREE.Scene();
  const eventBus = new EventBus();
  const player = {
    isActive: true,
    position: new THREE.Vector3(1000, 1000, 1000),
  };
  const vehicleManager = {
    isActive: vi.fn(() => false),
  };

  const system = new CoinCollectibleSystem(scene, eventBus, player as any, vehicleManager as any);
  return { scene, eventBus, player, vehicleManager, system };
}

describe("CoinCollectibleSystem", () => {
  it("resets count to zero when a procedural level is set up", () => {
    const { eventBus, system } = createSystem();
    const changed = vi.fn();
    eventBus.on("collectible:changed", changed);

    system.setupLevel();

    expect(system.getCollectedCount()).toBe(0);
    expect(system.listRemainingCoins()).toHaveLength(getProceduralCoinPlacements().length);
    expect(changed).toHaveBeenLastCalledWith({ count: 0 });
    system.dispose();
  });

  it("collects an overlapping coin exactly once and removes it from the scene", () => {
    const { scene, eventBus, player, system } = createSystem();
    const changed = vi.fn();
    const collected = vi.fn();
    eventBus.on("collectible:changed", changed);
    eventBus.on("collectible:collected", collected);

    system.setupStation("door");
    const [firstCoin] = system.listRemainingCoins();
    expect(firstCoin).toBeDefined();

    const beforeRemaining = system.listRemainingCoins().length;
    player.position.set(firstCoin.position.x, firstCoin.position.y, firstCoin.position.z);

    system.fixedUpdate(1 / 60);
    system.fixedUpdate(1 / 60);

    expect(system.getCollectedCount()).toBe(1);
    expect(system.listRemainingCoins()).toHaveLength(beforeRemaining - 1);
    expect(system.listRemainingCoins().some((coin) => coin.id === firstCoin.id)).toBe(false);
    expect(collected).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith({ count: 1 });
    expect(scene.children.some((child) => child.name === "CoinCollectible_1")).toBe(false);
    system.dispose();
  });

  it("skips collection while the player is inactive or seated in a vehicle", () => {
    const { player, vehicleManager, system } = createSystem();
    system.setupStation("vehicles");
    const [firstCoin] = system.listRemainingCoins();
    expect(firstCoin).toBeDefined();

    player.position.set(firstCoin.position.x, firstCoin.position.y, firstCoin.position.z);
    player.isActive = false;
    system.fixedUpdate(1 / 60);
    expect(system.getCollectedCount()).toBe(0);

    player.isActive = true;
    vehicleManager.isActive.mockReturnValue(true);
    system.fixedUpdate(1 / 60);
    expect(system.getCollectedCount()).toBe(0);

    vehicleManager.isActive.mockReturnValue(false);
    system.fixedUpdate(1 / 60);
    expect(system.getCollectedCount()).toBe(1);
    system.dispose();
  });

  it("filters station setup to the requested station subset", () => {
    const { system } = createSystem();

    system.setupStation("steps");

    const remaining = system.listRemainingCoins();
    expect(remaining).toHaveLength(getProceduralCoinPlacements("steps").length);
    expect(remaining.every((coin) => coin.station === "steps")).toBe(true);
    system.dispose();
  });

  it("keeps coin visuals out of Three.js raycast results", () => {
    const { scene, system } = createSystem();
    system.setupStation("vehicles");

    const [firstCoin] = system.listRemainingCoins();
    expect(firstCoin).toBeDefined();

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(firstCoin.position.x, firstCoin.position.y, firstCoin.position.z - 2),
      new THREE.Vector3(0, 0, 1),
    );
    const hits = raycaster.intersectObjects(scene.children, true);

    expect(hits).toHaveLength(0);
    system.dispose();
  });
});
