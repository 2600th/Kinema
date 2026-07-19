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

const MANUAL_RESET_HOLD_SECONDS = 1.5;
const MANUAL_RESET_MAX_PLANAR_SPEED = 0.5;

type Vector3Like = { x: number; y: number; z: number };
type QuaternionLike = { x: number; y: number; z: number; w: number };

export function isVehicleManualResetEligible(velocity: Vector3Like, rotation: QuaternionLike): boolean {
  const planarSpeed = Math.hypot(velocity.x, velocity.z);
  const upY = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
  return planarSpeed < MANUAL_RESET_MAX_PLANAR_SPEED || upY < 0;
}

export class VehicleManager implements FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  private static readonly VEHICLE_RESET_Y = -8;
  private vehicles = new Map<string, VehicleController>();
  private active: VehicleController | null = null;
  private lastInput: InputState = NULL_INPUT;
  /** Blocks immediate re-entry on the same tick as an exit. */
  private exitCooldown = 0;
  private manualResetHoldSeconds = 0;
  private manualResetNeedsRelease = false;
  private forcedExitFallback: SpawnPointData | null = null;
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
    this.exitVehicle(this.active, false);
  }

  fixedUpdate(dt: number): void {
    if (this.exitCooldown > 0) this.exitCooldown--;
    if (this.active?.setControlYaw) {
      this.active.setControlYaw(this.camera.getYaw());
    }
    if (this.active) {
      this.active.fixedUpdate(dt);
      this.resetIfOutOfBounds(this.active);
      this.updateManualResetHold(this.active, dt);
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
      this.exitVehicle(this.active, false);
      this.exitCooldown = 0;
    }
    for (const vehicle of this.vehicles.values()) {
      vehicle.dispose();
    }
    this.vehicles.clear();
  }

  private enterVehicle(vehicle: VehicleController): void {
    if (this.active || this.exitCooldown > 0) return;
    this.releaseHeldInteractionBeforeEntry();
    this.forcedExitFallback = { position: this.player.position.clone() };
    this.active = vehicle;
    this.clearManualResetHold();
    this.manualResetNeedsRelease = false;
    this.player.setActive(false);
    this.player.setEnabled(false);
    this.interactionManager.setEnabled(false);
    vehicle.body.wakeUp();
    this.lastInput = NULL_INPUT;
    vehicle.enter(NULL_INPUT);
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
    if (vehicle.type === "car") {
      this.eventBus.emit("vehicle:resetAvailable", { id: vehicle.id });
    }
  }

  private exitVehicle(vehicle: VehicleController, abortOnUnsafe = true): void {
    this.clearManualResetHold();
    this.manualResetNeedsRelease = false;
    let spawn: SpawnPointData;
    try {
      spawn = vehicle.exit();
    } catch (error) {
      if (abortOnUnsafe) {
        vehicle.enter(this.lastInput);
        this.eventBus.emit("interaction:blocked", { id: vehicle.id, reason: "No safe vehicle exit found" });
        console.warn(`[VehicleManager] Aborted unsafe exit from ${vehicle.id}.`, error);
        return;
      }
      const bodyPosition = vehicle.body.translation();
      spawn = this.forcedExitFallback ?? {
        position: vehicle.mesh.position.clone().set(bodyPosition.x, bodyPosition.y + 2, bodyPosition.z),
      };
      console.warn(`[VehicleManager] Forced exit from ${vehicle.id} used its safe fallback pose.`, error);
    }
    this.active = null;
    this.forcedExitFallback = null;
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

  private updateManualResetHold(vehicle: VehicleController, dt: number): void {
    if (vehicle.type !== "car" || !vehicle.resetToSpawn) {
      this.clearManualResetHold();
      return;
    }

    if (!this.lastInput.crouch) {
      this.manualResetNeedsRelease = false;
      this.clearManualResetHold();
      return;
    }
    if (this.manualResetNeedsRelease) return;

    if (!isVehicleManualResetEligible(vehicle.body.linvel(), vehicle.body.rotation())) {
      this.clearManualResetHold();
      return;
    }

    this.manualResetHoldSeconds = Math.min(this.manualResetHoldSeconds + dt, MANUAL_RESET_HOLD_SECONDS);
    this.eventBus.emit("vehicle:resetHoldProgress", {
      id: vehicle.id,
      progress: this.manualResetHoldSeconds / MANUAL_RESET_HOLD_SECONDS,
    });
    if (this.manualResetHoldSeconds < MANUAL_RESET_HOLD_SECONDS) return;

    vehicle.resetToSpawn();
    vehicle.enter(this.lastInput);
    vehicle.postPhysicsUpdate(0);
    vehicle.update(0, 1);
    this.camera.setVehicleSpeedRatio(0);
    this.camera.setVehicleHandlingFeel(vehicle.getHandlingFeelState?.() ?? null);
    this.camera.snapToTarget();
    this.eventBus.emit("vehicle:speedUpdate", { speedNorm: 0 });
    this.eventBus.emit("vehicle:handlingUpdate", vehicle.getHandlingFeelState?.() ?? null);
    this.eventBus.emit("vehicle:reset", { id: vehicle.id });
    this.manualResetNeedsRelease = true;
    this.clearManualResetHold();
  }

  private clearManualResetHold(): void {
    if (this.manualResetHoldSeconds > 0) {
      this.eventBus.emit("vehicle:resetHoldProgress", null);
    }
    this.manualResetHoldSeconds = 0;
  }
}
