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
import { CAR_SPAWN_Y_OFFSET, CarController } from "@vehicle/CarController";
import { DroneController } from "@vehicle/DroneController";
import type { VehicleManager } from "@vehicle/VehicleManager";
import * as THREE from "three";

type ThrowableShape = "sphere" | "box" | "cylinder";

interface ThrowablePlacement {
  shape: ThrowableShape;
  pos: THREE.Vector3;
  surfaceY: number;
  size: number;
  force: number;
  mass: number;
  linearDamping: number;
  angularDamping: number;
}

interface ThrowableSlotState {
  activeId: string | null;
  reserveIds: string[];
  refillDelay: number;
}

interface ThrowablePoolEntry {
  object: ThrowableObject;
  slotIndex: number;
  spawnPosition: THREE.Vector3;
  hiddenPosition: THREE.Vector3;
  activeOnTable: boolean;
  recycleDelay: number;
}

const THROWABLE_POOL_SIZE = 3;
const THROWABLE_RECYCLE_DELAY = 1.25;
const THROWABLE_REFILL_DELAY = 1.6;
const THROWABLE_RECYCLE_RADIUS = 13.5;
const THROWABLE_REFILL_DROP_HEIGHT = 0.42;
const THROWABLE_REFILL_DROP_SPEED = -0.9;

const _throwableZero = new RAPIER.Vector3(0, 0, 0);
const _throwableTmp = new RAPIER.Vector3(0, 0, 0);
const _throwableIdentityRotation = new RAPIER.Quaternion(0, 0, 0, 1);

function setThrowableVector(target: RAPIER.Vector3, source: THREE.Vector3): RAPIER.Vector3 {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  return target;
}

function setThrowableComponents(target: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  target.x = x;
  target.y = y;
  target.z = z;
  return target;
}

export class InteractableSystem implements RuntimeSystem {
  readonly id = "interactable";

  private runtimeInteractables: Array<{ id: string; dispose: () => void }> = [];
  private throwableObjects = new Map<number, ThrowableObject>();
  private throwablePoolEntries = new Map<string, ThrowablePoolEntry>();
  private throwableSlotStates: ThrowableSlotState[] = [];
  private throwableMaterials: THREE.Material[] = [];
  private carriedThrowable: ThrowableObject | null = null;
  private throwableRecycleCenter = new THREE.Vector3();
  private throwableRecycleRadiusSq = THROWABLE_RECYCLE_RADIUS * THROWABLE_RECYCLE_RADIUS;
  private throwableRecycleFloorY = -10;
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
      this.eventBus.on("interaction:grabStart", ({ body, offset, grabWeight }) => {
        this.playerController.startGrab(body, offset, grabWeight);
      }),
      this.eventBus.on("interaction:pickUp", ({ object }) => {
        this.handleThrowablePickup(object);
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

  fixedUpdate(dt: number): void {
    this.updateThrowableRefills(dt);
    this.recycleLooseThrowables(dt);
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
    const materialsByShape: Record<ThrowableShape, THREE.Material> = {
      sphere: new THREE.MeshPhysicalMaterial({
        color: 0xf0a35f,
        roughness: 0.24,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        emissive: 0x5a2208,
        emissiveIntensity: 0.1,
      }),
      box: new THREE.MeshStandardMaterial({
        color: 0xc78f62,
        roughness: 0.58,
        metalness: 0.08,
        emissive: 0x2a1408,
        emissiveIntensity: 0.05,
      }),
      cylinder: new THREE.MeshPhysicalMaterial({
        color: 0xd9dce2,
        roughness: 0.18,
        metalness: 0.78,
        clearcoat: 0.38,
        clearcoatRoughness: 0.18,
        emissive: 0x12151c,
        emissiveIntensity: 0.03,
      }),
    };
    this.throwableMaterials = Object.values(materialsByShape);
    const zThrow = getShowcaseStationZ("throw");
    const bayTopY = getShowcaseBayTopY();
    this.throwableRecycleCenter.set(0, bayTopY, zThrow - 0.15);
    this.throwableRecycleRadiusSq = THROWABLE_RECYCLE_RADIUS * THROWABLE_RECYCLE_RADIUS;
    this.throwableRecycleFloorY = bayTopY - 2.4;
    const placements: ThrowablePlacement[] = [
      { shape: "sphere", pos: new THREE.Vector3(-6.65, 0, zThrow + 2.03), surfaceY: 0.795, size: 0.16, force: 7.9, mass: 1.35, linearDamping: 0.26, angularDamping: 0.72 },
      { shape: "box", pos: new THREE.Vector3(-5.4, 0, zThrow + 2.03), surfaceY: 0.795, size: 0.15, force: 8.1, mass: 1.95, linearDamping: 0.32, angularDamping: 0.9 },
      { shape: "cylinder", pos: new THREE.Vector3(-4.15, 0, zThrow + 2.03), surfaceY: 0.795, size: 0.15, force: 7.7, mass: 1.15, linearDamping: 0.34, angularDamping: 1.05 },
      { shape: "sphere", pos: new THREE.Vector3(4.15, 0, zThrow + 2.03), surfaceY: 0.795, size: 0.15, force: 7.7, mass: 1.2, linearDamping: 0.26, angularDamping: 0.72 },
      { shape: "box", pos: new THREE.Vector3(5.4, 0, zThrow + 2.03), surfaceY: 0.795, size: 0.17, force: 8.2, mass: 2.15, linearDamping: 0.34, angularDamping: 0.95 },
      { shape: "cylinder", pos: new THREE.Vector3(6.65, 0, zThrow + 2.03), surfaceY: 0.795, size: 0.16, force: 7.9, mass: 1.25, linearDamping: 0.34, angularDamping: 1.05 },
    ];

    placements.forEach((entry, slotIndex) => {
      this.throwableSlotStates.push({ activeId: null, reserveIds: [], refillDelay: 0 });
      let halfHeight = entry.size;
      if (entry.shape === "cylinder") {
        halfHeight = entry.size * 0.6;
      }
      const spawnPosition = new THREE.Vector3(entry.pos.x, bayTopY + entry.surfaceY + halfHeight + 0.01, entry.pos.z);

      for (let poolIndex = 0; poolIndex < THROWABLE_POOL_SIZE; poolIndex++) {
        const id = `throw-${slotIndex}-${poolIndex}`;
        const mesh = this.createThrowableMesh(entry.shape, entry.size, materialsByShape[entry.shape]);
        mesh.position.copy(spawnPosition);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.renderer.scene.add(mesh);

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
          .setLinearDamping(entry.linearDamping)
          .setAngularDamping(entry.angularDamping);
        const body = this.physicsWorld.world.createRigidBody(bodyDesc);
        body.enableCcd(true);
        body.userData = { kind: "throwable" };

        let colliderDesc: RAPIER.ColliderDesc;
        if (entry.shape === "sphere") {
          colliderDesc = RAPIER.ColliderDesc.ball(entry.size);
        } else if (entry.shape === "cylinder") {
          colliderDesc = RAPIER.ColliderDesc.cylinder(entry.size * 0.6, entry.size * 0.6);
        } else {
          colliderDesc = RAPIER.ColliderDesc.cuboid(entry.size, entry.size, entry.size);
        }

        colliderDesc
          .setMass(entry.mass)
          .setCollisionGroups(COLLISION_GROUP_WORLD)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(8);
        const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

        const throwable = new ThrowableObject(id, mesh, body, collider, entry.force, this.eventBus);
        this.throwableObjects.set(collider.handle, throwable);
        this.runtimeInteractables.push(throwable);

        const poolEntry: ThrowablePoolEntry = {
          object: throwable,
          slotIndex,
          spawnPosition: spawnPosition.clone(),
          hiddenPosition: new THREE.Vector3(entry.pos.x, bayTopY - 16 - slotIndex * 0.35 - poolIndex * 0.2, entry.pos.z),
          activeOnTable: false,
          recycleDelay: 0,
        };
        this.throwablePoolEntries.set(throwable.id, poolEntry);
        this.deactivateThrowable(poolEntry);
        this.throwableSlotStates[slotIndex].reserveIds.push(throwable.id);
      }

      this.refillThrowableSlot(slotIndex, false);
    });
  }

  private createThrowableMesh(
    shape: ThrowableShape,
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
    const car = new CarController(
      "car-1",
      new THREE.Vector3(10, bayTopY + CAR_SPAWN_Y_OFFSET, zVehicles),
      this.physicsWorld,
      this.renderer.scene,
      this.playerController.body,
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
      .setDensity(0)
      .setCollisionGroups(COLLISION_GROUP_INTERACTABLE)
      .setTranslation(offset.x, offset.y, offset.z);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, vehicle.body);
    return new VehicleSeat(id, label, collider, vehicle, this.eventBus, offset);
  }

  private restoreThrownObject(): void {
    if (!this.carriedThrowable) return;
    this.interactionManager.register(this.carriedThrowable);
    const poolEntry = this.throwablePoolEntries.get(this.carriedThrowable.id);
    if (poolEntry) {
      poolEntry.activeOnTable = false;
      poolEntry.recycleDelay = THROWABLE_RECYCLE_DELAY;
    }
    this.carriedThrowable = null;
  }

  private handleThrowablePickup(object: ThrowableObject): void {
    this.carriedThrowable = object;
    this.playerController.startCarry(object);
    this.interactionManager.unregister(object.id);

    const poolEntry = this.throwablePoolEntries.get(object.id);
    if (!poolEntry) return;

    const slotState = this.throwableSlotStates[poolEntry.slotIndex];
    poolEntry.activeOnTable = false;
    poolEntry.recycleDelay = 0;

    if (slotState?.activeId === object.id) {
      slotState.activeId = null;
      slotState.refillDelay = THROWABLE_REFILL_DELAY;
    }
  }

  private updateThrowableRefills(dt: number): void {
    for (let slotIndex = 0; slotIndex < this.throwableSlotStates.length; slotIndex++) {
      const slotState = this.throwableSlotStates[slotIndex];
      if (slotState.activeId) continue;
      if (slotState.refillDelay > 0) {
        slotState.refillDelay = Math.max(0, slotState.refillDelay - dt);
        if (slotState.refillDelay > 0) continue;
      }
      this.refillThrowableSlot(slotIndex, true);
    }
  }

  private refillThrowableSlot(slotIndex: number, dropFromHeight: boolean): void {
    const slotState = this.throwableSlotStates[slotIndex];
    if (!slotState || slotState.activeId) return;
    const nextId = slotState.reserveIds.shift();
    if (!nextId) return;
    const poolEntry = this.throwablePoolEntries.get(nextId);
    if (!poolEntry) return;

    this.activateThrowable(poolEntry, dropFromHeight);
    slotState.activeId = nextId;
    slotState.refillDelay = 0;
  }

  private recycleLooseThrowables(dt: number): void {
    if (this.throwablePoolEntries.size === 0) return;

    for (const poolEntry of this.throwablePoolEntries.values()) {
      if (poolEntry.activeOnTable) continue;
      if (this.carriedThrowable?.id === poolEntry.object.id) continue;
      if (!poolEntry.object.body.isEnabled()) continue;

      if (poolEntry.recycleDelay > 0) {
        poolEntry.recycleDelay = Math.max(0, poolEntry.recycleDelay - dt);
        continue;
      }

      const pos = poolEntry.object.body.translation();
      const dx = pos.x - this.throwableRecycleCenter.x;
      const dz = pos.z - this.throwableRecycleCenter.z;
      const belowFloor = pos.y < this.throwableRecycleFloorY;
      const beyondStation = dx * dx + dz * dz > this.throwableRecycleRadiusSq;

      if (!belowFloor && !beyondStation && !poolEntry.object.body.isSleeping()) continue;

      this.recycleThrowable(poolEntry);
    }
  }

  private recycleThrowable(poolEntry: ThrowablePoolEntry): void {
    const slotState = this.throwableSlotStates[poolEntry.slotIndex];
    if (slotState?.activeId === poolEntry.object.id) {
      slotState.activeId = null;
    }

    this.interactionManager.unregister(poolEntry.object.id);
    this.deactivateThrowable(poolEntry);
    if (slotState && !slotState.reserveIds.includes(poolEntry.object.id)) {
      slotState.reserveIds.push(poolEntry.object.id);
    }
    if (slotState && !slotState.activeId && slotState.refillDelay <= 0) {
      this.refillThrowableSlot(poolEntry.slotIndex, true);
    }
  }

  private activateThrowable(poolEntry: ThrowablePoolEntry, dropFromHeight: boolean): void {
    const { body, collider, mesh } = poolEntry.object;
    const spawnPosition = dropFromHeight
      ? poolEntry.spawnPosition.clone().add(new THREE.Vector3(0, THROWABLE_REFILL_DROP_HEIGHT, 0))
      : poolEntry.spawnPosition;
    body.setEnabled(true);
    collider.setEnabled(true);
    body.setLinvel(_throwableZero, true);
    body.setAngvel(_throwableZero, true);
    body.setTranslation(setThrowableVector(_throwableTmp, spawnPosition), true);
    body.setRotation(_throwableIdentityRotation, true);
    if (dropFromHeight) {
      body.setLinvel(setThrowableComponents(_throwableTmp, 0, THROWABLE_REFILL_DROP_SPEED, 0), true);
    }
    body.wakeUp();
    mesh.visible = true;
    mesh.position.copy(spawnPosition);
    mesh.quaternion.identity();
    poolEntry.activeOnTable = true;
    poolEntry.recycleDelay = 0;
    this.interactionManager.register(poolEntry.object);
  }

  private deactivateThrowable(poolEntry: ThrowablePoolEntry): void {
    const { body, collider, mesh } = poolEntry.object;
    body.setLinvel(_throwableZero, true);
    body.setAngvel(_throwableZero, true);
    body.setTranslation(setThrowableVector(_throwableTmp, poolEntry.hiddenPosition), false);
    body.setRotation(_throwableIdentityRotation, false);
    body.sleep();
    collider.setEnabled(false);
    body.setEnabled(false);
    mesh.visible = false;
    mesh.position.copy(poolEntry.hiddenPosition);
    mesh.quaternion.identity();
    poolEntry.activeOnTable = false;
    poolEntry.recycleDelay = 0;
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
    this.throwablePoolEntries.clear();
    this.throwableSlotStates = [];
    this.carriedThrowable = null;
    if (this.throwableMaterials.length > 0) {
      for (const material of this.throwableMaterials) material.dispose();
      this.throwableMaterials = [];
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
