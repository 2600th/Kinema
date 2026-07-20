import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import { ObjectiveManager } from "@core/ObjectiveManager";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import type { SpawnPointData } from "@core/types";
import { type ActiveCheckpoint, CheckpointManager } from "@level/CheckpointManager";
import { getShowcaseBayTopY, getShowcaseStationZ } from "@level/ShowcaseLayout";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import * as THREE from "three";

export class CheckpointObjectiveSystem implements RuntimeSystem {
  readonly id = "checkpoint-objective";

  private readonly checkpointManager: CheckpointManager;
  private readonly objectiveManager: ObjectiveManager;
  private unsubs: (() => void)[] = [];

  constructor(
    renderer: RendererManager,
    _physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    private playerController: PlayerController,
  ) {
    this.checkpointManager = new CheckpointManager(renderer.scene, playerController, eventBus);
    this.objectiveManager = new ObjectiveManager(eventBus);

    this.unsubs.push(
      this.eventBus.on("objective:beaconActivated", () => {
        this.objectiveManager.complete("activate-beacon");
      }),
      this.eventBus.on("checkpoint:activated", ({ position }) => {
        this.playerController.setRespawnPoint({
          position: new THREE.Vector3(position.x, position.y, position.z),
        });
        this.objectiveManager.complete("reach-checkpoint");
      }),
    );
  }

  setupLevel(): void {
    this.spawnCheckpoints();
    this.objectiveManager.setObjectives([
      { id: "reach-checkpoint", text: "Reach a checkpoint" },
      { id: "activate-beacon", text: "Activate the beacon" },
    ]);
  }

  teardownLevel(): void {
    // Without this, every level restart adds another checkpoint mesh and
    // re-fires checkpoint:activated for already-passed checkpoints.
    this.checkpointManager.dispose();
  }

  fixedUpdate(dt: number): void {
    this.checkpointManager.fixedUpdate(dt);
  }

  getActiveCheckpoint(): ActiveCheckpoint | null {
    return this.checkpointManager.getActiveCheckpoint();
  }

  getActiveSpawnPoint(): SpawnPointData | null {
    return this.checkpointManager.getActiveCheckpoint()?.spawnPoint ?? null;
  }

  private spawnCheckpoints(): void {
    this.checkpointManager.addCheckpoint(
      "showcase-checkpoint",
      new THREE.Vector3(10, getShowcaseBayTopY() + 0.12, getShowcaseStationZ("door")),
      2.2,
    );
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.checkpointManager.dispose();
    this.objectiveManager.dispose();
  }
}
