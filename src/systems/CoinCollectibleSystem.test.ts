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
    expect(system.getTotalValue()).toBe(70);
    expect(system.listRemainingCoins()).toHaveLength(getProceduralCoinPlacements().length);
    expect(changed).toHaveBeenLastCalledWith({ count: 0, total: 70 });
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
    expect(changed).toHaveBeenLastCalledWith({ count: 1, total: 5 });
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
    expect(system.getTotalValue()).toBe(5);
    expect(remaining).toHaveLength(getProceduralCoinPlacements("steps").length);
    expect(remaining.every((coin) => coin.station === "steps")).toBe(true);
    system.dispose();
  });

  it("emits changed, collected, then all-collected exactly once after the final value", () => {
    const { eventBus, player, system } = createSystem();
    const order: string[] = [];
    const completed = vi.fn();
    eventBus.on("collectible:changed", ({ count, total }) => order.push(`changed:${count}/${total}`));
    eventBus.on("collectible:collected", ({ count }) => order.push(`collected:${count}`));
    eventBus.on("collectible:allCollected", (payload) => {
      order.push(`complete:${payload.count}/${payload.total}`);
      completed(payload);
    });
    system.setupStation("door");
    order.length = 0;

    while (system.listRemainingCoins().length > 0) {
      const [coin] = system.listRemainingCoins();
      player.position.set(coin.position.x, coin.position.y, coin.position.z);
      system.fixedUpdate(1 / 60);
    }
    system.fixedUpdate(1 / 60);

    expect(order.slice(-3)).toEqual(["changed:5/5", "collected:5", "complete:5/5"]);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0][0]).toMatchObject({ count: 5, total: 5 });
    expect(completed.mock.calls[0][0].position).toBeInstanceOf(THREE.Vector3);
    system.dispose();
  });

  it("resets to a zero total without emitting completion for an empty custom level", () => {
    const { eventBus, system } = createSystem();
    const changed = vi.fn();
    const completed = vi.fn();
    eventBus.on("collectible:changed", changed);
    eventBus.on("collectible:allCollected", completed);
    system.setupStation("steps");

    system.setupCustomLevel();

    expect(system.getCollectedCount()).toBe(0);
    expect(system.getTotalValue()).toBe(0);
    expect(changed).toHaveBeenLastCalledWith({ count: 0, total: 0 });
    expect(completed).not.toHaveBeenCalled();
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
