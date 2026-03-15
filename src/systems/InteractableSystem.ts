import type { PlayerController } from "@character/PlayerController";
import { COLLISION_GROUP_INTERACTABLE, COLLISION_GROUP_WORLD } from "@core/constants";
import type { EventBus } from "@core/EventBus";
import type { RuntimeSystem } from "@core/RuntimeSystem";
import RAPIER from "@dimforge/rapier3d-compat";
import type { InteractionManager } from "@interaction/InteractionManager";
import { Door } from "@interaction/interactables/Door";
import { GrabbableObject } from "@interaction/interactables/GrabbableObject";
import { ObjectiveBeacon } from "@interaction/interactables/ObjectiveBeacon";
import { PhysicsRope } from "@interaction/interactables/PhysicsRope";
import { ThrowableObject } from "@interaction/interactables/ThrowableObject";
import { VehicleSeat } from "@interaction/interactables/VehicleSeat";
import type { LevelManager } from "@level/LevelManager";
import { getShowcaseBayTopY, getShowcaseStationZ, type ShowcaseStationKey } from "@level/ShowcaseLayout";
import type { PhysicsWorld } from "@physics/PhysicsWorld";
import type { RendererManager } from "@renderer/RendererManager";
import type { UIManager } from "@ui/UIManager";
import { CarController } from "@vehicle/CarController";
import { DroneController } from "@vehicle/DroneController";
import type { VehicleManager } from "@vehicle/VehicleManager";
import * as THREE from "three";

export class InteractableSystem implements RuntimeSystem {
  readonly id = "interactable";

  private runtimeInteractables: Array<{ id: string; dispose: () => void }> = [];
  private throwableObjects = new Map<number, ThrowableObject>();
  private throwableMaterial: THREE.Material | null = null;
  private carriedThrowable: ThrowableObject | null = null;
  private rope: PhysicsRope | null = null;
  private unsubs: (() => void)[] = [];

  // Shared throwable geometries (reused across all throwable objects)
  private readonly throwableGeometries = {
    sphere: new THREE.SphereGeometry(1, 8, 6),
    box: new THREE.BoxGeometry(2, 2, 2),
    cylinder: new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12),
  };

  constructor(
    private renderer: RendererManager,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    private interactionManager: InteractionManager,
    private playerController: PlayerController,
    private vehicleManager: VehicleManager,
    private levelManager: LevelManager,
    private uiManager: UIManager,
  ) {
    this.unsubs.push(
      this.eventBus.on("interaction:grabStart", ({ body, offset }) => {
        this.playerController.startGrab(body, offset);
      }),
      this.eventBus.on("interaction:pickUp", ({ object }) => {
        this.carriedThrowable = object;
        this.playerController.startCarry(object);
        this.interactionManager.unregister(object.id);
      }),
      this.eventBus.on("interaction:throw", () => {
        this.restoreThrownObject();
      }),
      this.eventBus.on("interaction:drop", () => {
        this.restoreThrownObject();
      }),
    );
  }

  setupLevel(): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();
    this.spawnInteractables();
  }

  /** Minimal level setup for custom/editor levels -- no procedural showcase content. */
  setupCustomLevel(): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();
  }

  /** Setup only the interactables for a single showcase station (debug/test). */
  setupStation(key: ShowcaseStationKey): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();

    switch (key) {
      case "door": {
        const bayTopY = getShowcaseBayTopY();
        const zDoor = getShowcaseStationZ("door");
        const beacon = new ObjectiveBeacon(
          "beacon1",
          new THREE.Vector3(4, bayTopY, zDoor),
          this.renderer.scene,
          this.physicsWorld,
        );
        this.interactionManager.register(beacon);
        const door = new Door("door1", new THREE.Vector3(0, bayTopY, zDoor), this.renderer.scene, this.physicsWorld);
        this.interactionManager.register(door);
        this.runtimeInteractables.push(beacon, door);
        break;
      }
      case "movement": {
        const bayTopY = getShowcaseBayTopY();
        const zMovement = getShowcaseStationZ("movement");
        const rope = new PhysicsRope(
          "rope1",
          new THREE.Vector3(-14, bayTopY + 6.2, zMovement + 2),
          this.renderer.scene,
          this.physicsWorld,
          this.playerController,
        );
        this.rope = rope;
        this.interactionManager.register(rope);
        this.runtimeInteractables.push(rope);
        break;
      }
      case "grab":
        this.spawnGrabbables();
        break;
      case "throw":
        this.spawnThrowableObjects();
        break;
      case "vehicles":
        this.spawnVehicles();
        break;
      // Other stations only have LevelManager geometry (no runtime interactables)
    }
  }

  teardownLevel(): void {
    this.clearRuntimeInteractables();
    this.vehicleManager.clear();
  }

  postPhysicsUpdate(_dt: number): void {
    this.rope?.postPhysicsUpdate();
    for (const throwable of this.throwableObjects.values()) {
      throwable.postPhysicsUpdate();
    }

    if (this.throwableObjects.size > 0) {
      this.physicsWorld.eventQueue.drainContactForceEvents((event) => {
        const h1 = event.collider1();
        const h2 = event.collider2();
        const obj = this.throwableObjects.get(h1) ?? this.throwableObjects.get(h2);
        if (!obj) return;
        if (event.totalForceMagnitude() > 12) {
          this.uiManager.hud.showStatus("Impact!", 700);
        }
      });
    }
  }

  update(_dt: number, alpha: number): void {
    this.rope?.renderUpdate(alpha);
    for (const throwable of this.throwableObjects.values()) {
      throwable.renderUpdate(alpha);
    }
  }

  private spawnInteractables(): void {
    const bayTopY = getShowcaseBayTopY();
    const zDoor = getShowcaseStationZ("door");
    const zMovement = getShowcaseStationZ("movement");
    const rope = new PhysicsRope(
      "rope1",
      new THREE.Vector3(-14, bayTopY + 6.2, zMovement + 2),
      this.renderer.scene,
      this.physicsWorld,
      this.playerController,
    );
    this.rope = rope;
    this.interactionManager.register(rope);

    const beacon = new ObjectiveBeacon(
      "beacon1",
      new THREE.Vector3(4, bayTopY, zDoor),
      this.renderer.scene,
      this.physicsWorld,
    );
    this.interactionManager.register(beacon);

    const door = new Door("door1", new THREE.Vector3(0, bayTopY, zDoor), this.renderer.scene, this.physicsWorld);
    this.interactionManager.register(door);

    this.runtimeInteractables.push(rope, beacon, door);

    this.spawnGrabbables();
    this.spawnThrowableObjects();
    this.spawnVehicles();
  }

  private spawnGrabbables(): void {
    const dynamicBodies = this.levelManager.getDynamicBodies();
    dynamicBodies.forEach((entry, index) => {
      if (entry.mesh.userData?.grabbable !== true) return;
      const id = `grab-${index}`;
      const collider = entry.body.collider(0);
      if (!collider) return;
      const grab = new GrabbableObject(id, entry.body, collider, this.eventBus, entry.mesh);
      this.interactionManager.register(grab);
      this.runtimeInteractables.push(grab);
    });
  }

  private spawnThrowableObjects(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9d7b52, roughness: 0.7 });
    this.throwableMaterial = mat;
    const zThrow = getShowcaseStationZ("throw");
    const bayTopY = getShowcaseBayTopY();
    const placements = [
      { shape: "sphere", pos: new THREE.Vector3(-3, 0, zThrow + 2), size: 0.3, force: 8 },
      { shape: "sphere", pos: new THREE.Vector3(-1, 0, zThrow), size: 0.25, force: 7 },
      { shape: "box", pos: new THREE.Vector3(1, 0, zThrow + 2), size: 0.35, force: 8 },
      { shape: "box", pos: new THREE.Vector3(3, 0, zThrow), size: 0.45, force: 9 },
      { shape: "cylinder", pos: new THREE.Vector3(-3, 0, zThrow - 2), size: 0.25, force: 7.5 },
      { shape: "cylinder", pos: new THREE.Vector3(3, 0, zThrow - 2), size: 0.28, force: 8.5 },
    ] as const;

    placements.forEach((entry, index) => {
      const id = `throw-${index}`;
      const mesh = this.createThrowableMesh(entry.shape, entry.size, mat);
      let halfHeight = entry.size;
      if (entry.shape === "cylinder") {
        halfHeight = entry.size * 0.6;
      }
      mesh.position.set(entry.pos.x, bayTopY + halfHeight + 0.04, entry.pos.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.renderer.scene.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z);
      const body = this.physicsWorld.world.createRigidBody(bodyDesc);
      body.enableCcd(true);

      let colliderDesc: RAPIER.ColliderDesc;
      if (entry.shape === "sphere") {
        colliderDesc = RAPIER.ColliderDesc.ball(entry.size);
      } else if (entry.shape === "cylinder") {
        colliderDesc = RAPIER.ColliderDesc.cylinder(entry.size * 0.6, entry.size * 0.6);
      } else {
        colliderDesc = RAPIER.ColliderDesc.cuboid(entry.size, entry.size, entry.size);
      }

      colliderDesc
        .setDensity(1.0)
        .setCollisionGroups(COLLISION_GROUP_WORLD)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(8);
      const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

      const throwable = new ThrowableObject(id, mesh, body, collider, entry.force, this.eventBus);
      this.throwableObjects.set(collider.handle, throwable);
      this.interactionManager.register(throwable);
      this.runtimeInteractables.push(throwable);
    });
  }

  private createThrowableMesh(
    shape: "sphere" | "box" | "cylinder",
    size: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.throwableGeometries[shape], material);
    mesh.scale.setScalar(size);
    return mesh;
  }

  private spawnVehicles(): void {
    const zVehicles = getShowcaseStationZ("vehicles");
    const bayTopY = getShowcaseBayTopY();
    // Spread vehicles wider. Car raised to clear wheel radius above pedestal.
    const drone = new DroneController(
      "drone-1",
      new THREE.Vector3(-10, bayTopY + 2.5, zVehicles),
      this.physicsWorld,
      this.renderer.scene,
    );
    // Car needs body center high enough that suspension settles wheels ON the surface.
    // wheelOffset=0.32, wheelRadius=0.32, suspensionRest=0.6 → min Y = 1.25 above pedestal.
    const car = new CarController(
      "car-1",
      new THREE.Vector3(10, bayTopY + 1.3, zVehicles),
      this.physicsWorld,
      this.renderer.scene,
    );
    this.vehicleManager.register(drone);
    this.vehicleManager.register(car);

    const droneSeat = this.createVehicleSeat("seat-drone", "Fly", drone, new THREE.Vector3(0, 0.6, 0));
    const carSeat = this.createVehicleSeat("seat-car", "Drive", car, new THREE.Vector3(-1.5, 0.5, -1.0));
    this.interactionManager.register(droneSeat);
    this.interactionManager.register(carSeat);
    this.runtimeInteractables.push(droneSeat, carSeat);
  }

  private createVehicleSeat(
    id: string,
    label: string,
    vehicle: DroneController | CarController,
    offset: THREE.Vector3,
  ): VehicleSeat {
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.6, 0.8, 0.6)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_INTERACTABLE)
      .setTranslation(offset.x, offset.y, offset.z);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, vehicle.body);
    return new VehicleSeat(id, label, collider, vehicle, this.eventBus, offset);
  }

  private restoreThrownObject(): void {
    if (!this.carriedThrowable) return;
    this.interactionManager.register(this.carriedThrowable);
    this.carriedThrowable = null;
  }

  private clearRuntimeInteractables(): void {
    this.rope = null;
    for (const interactable of this.runtimeInteractables) {
      this.interactionManager.unregister(interactable.id);
      if (interactable instanceof ThrowableObject) {
        this.physicsWorld.removeCollider(interactable.collider);
        this.physicsWorld.removeBody(interactable.body);
        this.renderer.scene.remove(interactable.mesh);
      }
      if (interactable instanceof VehicleSeat) {
        this.physicsWorld.removeCollider(interactable.collider);
      }
      interactable.dispose();
    }
    this.runtimeInteractables = [];
    this.throwableObjects.clear();
    this.carriedThrowable = null;
    if (this.throwableMaterial) {
      this.throwableMaterial.dispose();
      this.throwableMaterial = null;
    }
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.clearRuntimeInteractables();
    this.throwableGeometries.sphere.dispose();
    this.throwableGeometries.box.dispose();
    this.throwableGeometries.cylinder.dispose();
  }
}
