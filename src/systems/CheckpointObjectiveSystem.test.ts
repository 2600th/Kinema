import { EventBus } from "@core/EventBus";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CheckpointObjectiveSystem } from "./CheckpointObjectiveSystem";

describe("CheckpointObjectiveSystem", () => {
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
