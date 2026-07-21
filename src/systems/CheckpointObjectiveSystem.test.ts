import { EventBus } from "@core/EventBus";
import { getShowcaseBayTopY, getShowcaseStationZ } from "@level/ShowcaseLayout";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CheckpointObjectiveSystem } from "./CheckpointObjectiveSystem";

describe("CheckpointObjectiveSystem", () => {
  it("activates the back checkpoint without completing the one-shot checkpoint objective twice", () => {
    const scene = new THREE.Scene();
    const eventBus = new EventBus();
    const completed: string[] = [];
    const setRespawnPoint = vi.fn();
    const checkpointY = getShowcaseBayTopY() + 0.12;
    const player = {
      position: new THREE.Vector3(10, checkpointY, getShowcaseStationZ("door")),
      setRespawnPoint,
    };
    eventBus.on("objective:completed", ({ id }) => completed.push(id));

    const system = new CheckpointObjectiveSystem({ scene } as never, {} as never, eventBus, player as never);
    system.setupLevel();

    expect(scene.getObjectByName("Checkpoint_showcase-checkpoint")).toBeDefined();
    expect(scene.getObjectByName("Checkpoint_showcase-checkpoint-back")).toBeDefined();

    system.fixedUpdate(1 / 60);
    expect(completed).toEqual(["reach-checkpoint"]);

    const backCheckpointPosition = new THREE.Vector3(18, checkpointY, getShowcaseStationZ("vfx") - 15);
    player.position.copy(backCheckpointPosition);
    system.fixedUpdate(1 / 60);

    expect(system.getActiveCheckpoint()?.id).toBe("showcase-checkpoint-back");
    expect(setRespawnPoint).toHaveBeenCalledTimes(2);
    expect(setRespawnPoint).toHaveBeenLastCalledWith({ position: backCheckpointPosition });
    expect(completed).toEqual(["reach-checkpoint"]);
    system.dispose();
  });

  it("completes the beacon objective only from its domain event", () => {
    const eventBus = new EventBus();
    const currentObjectives: string[] = [];
    const completed: string[] = [];
    eventBus.on("objective:set", ({ text }) => currentObjectives.push(text));
    eventBus.on("objective:completed", ({ id }) => completed.push(id));
    const system = new CheckpointObjectiveSystem({ scene: new THREE.Scene() } as never, {} as never, eventBus, {
      setRespawnPoint: vi.fn(),
    } as never);
    system.setupLevel();

    eventBus.emit("checkpoint:activated", { id: "checkpoint", position: new THREE.Vector3() });
    eventBus.emit("interaction:triggered", { id: "beacon1" });
    expect(completed).toEqual(["reach-checkpoint"]);

    eventBus.emit("objective:beaconActivated", { id: "beacon1" });
    eventBus.emit("objective:beaconActivated", { id: "beacon1" });
    expect(completed).toEqual(["reach-checkpoint", "activate-beacon"]);
    expect(currentObjectives).toEqual(["Reach a checkpoint", "Activate the beacon", "All objectives complete"]);
    system.dispose();
  });
});
