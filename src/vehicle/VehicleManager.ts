import type { OrbitFollowCamera } from "@camera/OrbitFollowCamera";
import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type {
  Disposable,
  FixedUpdatable,
  InputState,
  PostPhysicsUpdatable,
  SpawnPointData,
  Updatable,
} from "@core/types";
import { NULL_INPUT } from "@core/types";
import type { InteractionManager } from "@interaction/InteractionManager";
import type { VehicleController } from "./VehicleController";

export class VehicleManager implements FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  private static readonly VEHICLE_RESET_Y = -8;
  private vehicles = new Map<string, VehicleController>();
  private active: VehicleController | null = null;
  private lastInput: InputState = NULL_INPUT;
  /** Blocks immediate re-entry on the same tick as an exit. */
  private exitCooldown = 0;
  private unsubs: (() => void)[] = [];

  constructor(
    private eventBus: EventBus,
    private player: PlayerController,
    private camera: OrbitFollowCamera,
    private interactionManager: InteractionManager,
  ) {
    this.unsubs.push(
      this.eventBus.on("vehicle:enter", ({ vehicle }) => {
        this.enterVehicle(vehicle);
      }),
    );
  }

  register(vehicle: VehicleController): void {
    this.vehicles.set(vehicle.id, vehicle);
  }

  getVehicle(id: string): VehicleController | null {
    return this.vehicles.get(id) ?? null;
  }

  getVehicleIds(): string[] {
    return [...this.vehicles.keys()];
  }

  isActive(): boolean {
    return this.active !== null;
  }

  getCameraLookMode(): "full" | "yawOnly" {
    return this.active?.cameraLookMode ?? "full";
  }

  setInput(input: InputState): void {
    this.lastInput = input;
    if (this.active) {
      this.active.setInput(input);
    }
  }

  requestExit(): void {
    if (!this.active) return;
    this.exitVehicle(this.active);
  }

  /** Force-exit the active vehicle (e.g. for level teardown). */
  forceExit(): void {
    if (!this.active) return;
    this.exitVehicle(this.active);
  }

  fixedUpdate(dt: number): void {
    if (this.exitCooldown > 0) this.exitCooldown--;
    if (this.active?.setControlYaw) {
      this.active.setControlYaw(this.camera.getYaw());
    }
    if (this.active) {
      this.active.fixedUpdate(dt);
      this.resetIfOutOfBounds(this.active);
      const lv = this.active.body.linvel();
      const sn = Math.min(Math.hypot(lv.x, lv.z) / 18, 1);
      const handlingFeel = this.active.getHandlingFeelState?.() ?? null;
      this.camera.setVehicleSpeedRatio(sn);
      this.camera.setVehicleHandlingFeel(handlingFeel);
      this.eventBus.emit("vehicle:speedUpdate", { speedNorm: sn });
      this.eventBus.emit("vehicle:handlingUpdate", handlingFeel);
      return;
    }
    // Keep parked vehicles simulating (e.g., drone auto-landing).
    for (const vehicle of this.vehicles.values()) {
      vehicle.fixedUpdate(dt);
      this.resetIfOutOfBounds(vehicle);
    }
  }

  postPhysicsUpdate(dt: number): void {
    if (this.active) {
      this.active.postPhysicsUpdate(dt);
      return;
    }
    // Keep parked vehicle visuals (and seats) in sync.
    for (const vehicle of this.vehicles.values()) {
      vehicle.postPhysicsUpdate(dt);
    }
  }

  update(dt: number, alpha: number): void {
    if (this.active) {
      this.active.update(dt, alpha);
      return;
    }
    // Keep parked vehicle visuals smooth (e.g., drone auto-landing).
    for (const vehicle of this.vehicles.values()) {
      vehicle.update(dt, alpha);
    }
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.clear();
  }

  clear(): void {
    // If the player is seated, restore ownership before disposing vehicles.
    if (this.active) {
      this.eventBus.emit("vehicle:engineStop", undefined);
      this.eventBus.emit("vehicle:handlingUpdate", null);
      this.camera.setChaseMode(false);
      this.camera.setVehicleSpeedRatio(0);
      this.camera.setVehicleHandlingFeel(null);
      this.camera.resetTarget();
      this.camera.resetCameraConfig();
      this.player.setEnabled(true);
      this.player.setActive(true);
      this.interactionManager.setEnabled(true);
      this.active = null;
    }
    for (const vehicle of this.vehicles.values()) {
      vehicle.dispose();
    }
    this.vehicles.clear();
  }

  private enterVehicle(vehicle: VehicleController): void {
    if (this.active || this.exitCooldown > 0) return;
    this.releaseHeldInteractionBeforeEntry();
    this.active = vehicle;
    this.player.setActive(false);
    this.player.setEnabled(false);
    this.interactionManager.setEnabled(false);
    vehicle.body.wakeUp();
    vehicle.enter(this.lastInput);
    vehicle.postPhysicsUpdate(0);
    vehicle.update(0, 1);
    this.camera.applyCameraConfig(vehicle.cameraConfig);
    this.camera.setTarget(vehicle.mesh, {
      body: vehicle.body,
      heightOffset: vehicle.cameraConfig.heightOffset,
      inputProvider: () => this.lastInput,
    });
    this.camera.setChaseMode(true);
    this.camera.snapToTarget();
    this.eventBus.emit("vehicle:engineStart", undefined);
  }

  private exitVehicle(vehicle: VehicleController): void {
    const spawn = vehicle.exit();
    this.active = null;
    // Spawn player BEFORE snapping camera so it targets the exit point,
    // not the pre-spawn (stale) player position.
    this.player.setEnabled(true);
    this.player.setActive(true);
    this.player.suppressInteract(2);
    this.player.spawn(this.ensureSpawnPoint(spawn));
    this.camera.setChaseMode(false);
    this.camera.setVehicleSpeedRatio(0);
    this.camera.setVehicleHandlingFeel(null);
    this.camera.resetTarget();
    this.camera.resetCameraConfig();
    this.camera.snapToTarget();
    this.interactionManager.setEnabled(true);
    // Block re-entry for 2 ticks (this tick + next) to prevent same-frame re-entry
    // from the interactPressed that triggered the exit.
    this.exitCooldown = 2;
    this.eventBus.emit("vehicle:engineStop", undefined);
    this.eventBus.emit("vehicle:handlingUpdate", null);
    this.eventBus.emit("vehicle:exit", { position: spawn.position });
  }

  private releaseHeldInteractionBeforeEntry(): void {
    if (this.player.grabCarry.isGrabbing) {
      this.player.endGrab();
    }
    if (!this.player.grabCarry.isCarrying) return;

    const standingHalfHeight = this.player.config.capsuleHalfHeight;
    const crouchedHalfHeight = Math.max(0.16, standingHalfHeight - this.player.config.crouchHeightOffset);
    const capsuleHalfHeight = this.player.crouching ? crouchedHalfHeight : standingHalfHeight;
    this.player.grabCarry.dropCarried(
      this.player.position,
      capsuleHalfHeight,
      this.player.getCameraForward(),
      this.eventBus,
    );
  }

  private ensureSpawnPoint(spawn: SpawnPointData): SpawnPointData {
    return {
      position: spawn.position.clone(),
      rotation: spawn.rotation?.clone(),
    };
  }

  private resetIfOutOfBounds(vehicle: VehicleController): void {
    if (!vehicle.resetToSpawn) return;
    const p = vehicle.body.translation();
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.z) ||
      p.y < VehicleManager.VEHICLE_RESET_Y
    ) {
      vehicle.resetToSpawn();
      this.camera.setVehicleSpeedRatio(0);
      this.camera.setVehicleHandlingFeel(vehicle.getHandlingFeelState?.() ?? null);
      this.eventBus.emit("vehicle:speedUpdate", { speedNorm: 0 });
      this.eventBus.emit("vehicle:handlingUpdate", vehicle.getHandlingFeelState?.() ?? null);
    }
  }
}
