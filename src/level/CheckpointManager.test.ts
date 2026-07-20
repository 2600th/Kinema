import { EventBus } from "@core/EventBus";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CheckpointManager } from "./CheckpointManager";

describe("CheckpointManager", () => {
  it("activates checkpoint when player enters radius", () => {
    const scene = new THREE.Scene();
    const eventBus = new EventBus();
    const player = { position: new THREE.Vector3(0, 0, 0) };
    const manager = new CheckpointManager(scene, player as any, eventBus);
    const activated: Array<{ id: string; position: { x: number; y: number; z: number } }> = [];
    eventBus.on("checkpoint:activated", (payload) => activated.push(payload));

    manager.addCheckpoint("cp1", new THREE.Vector3(10, 0, 0), 1.5);
    expect(manager.getActiveCheckpoint()).toBeNull();
    manager.fixedUpdate(1 / 60);
    expect(activated).toHaveLength(0);

    player.position.set(10.4, 0, 0);
    manager.fixedUpdate(1 / 60);
    expect(activated).toHaveLength(1);
    expect(activated[0].id).toBe("cp1");
    const active = manager.getActiveCheckpoint();
    expect(active?.id).toBe("cp1");
    expect(active?.spawnPoint.position.toArray()).toEqual([10, 0, 0]);
    active?.spawnPoint.position.set(999, 999, 999);
    expect(manager.getActiveCheckpoint()?.spawnPoint.position.toArray()).toEqual([10, 0, 0]);

    manager.fixedUpdate(1 / 60);
    expect(activated).toHaveLength(1);
    manager.dispose();
    expect(manager.getActiveCheckpoint()).toBeNull();
  });
});
