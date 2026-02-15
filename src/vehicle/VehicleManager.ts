import type { EventBus } from '@core/EventBus';
import type { FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable, InputState, SpawnPointData } from '@core/types';
import { NULL_INPUT } from '@core/types';
import type { PlayerController } from '@character/PlayerController';
import type { OrbitFollowCamera } from '@camera/OrbitFollowCamera';
import type { InteractionManager } from '@interaction/InteractionManager';
import type { VehicleController } from './VehicleController';

export class VehicleManager implements FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  private vehicles = new Map<string, VehicleController>();
  private active: VehicleController | null = null;
  private lastInput: InputState = NULL_INPUT;

  constructor(
    private eventBus: EventBus,
    private player: PlayerController,
    private camera: OrbitFollowCamera,
    private interactionManager: InteractionManager,
  ) {
    this.eventBus.on('vehicle:enter', ({ vehicle }) => {
      this.enterVehicle(vehicle);
    });
  }

  register(vehicle: VehicleController): void {
    this.vehicles.set(vehicle.id, vehicle);
  }

  isActive(): boolean {
    return this.active !== null;
  }

  getCameraLookMode(): 'full' | 'yawOnly' {
    return this.active?.cameraLookMode ?? 'full';
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

  fixedUpdate(dt: number): void {
    if (this.active?.setControlYaw) {
      this.active.setControlYaw(this.camera.getYaw());
    }
    if (this.active) {
      this.active.fixedUpdate(dt);
      return;
    }
    // Keep parked vehicles simulating (e.g., drone auto-landing).
    for (const vehicle of this.vehicles.values()) {
      vehicle.fixedUpdate(dt);
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
    this.clear();
  }

  clear(): void {
    for (const vehicle of this.vehicles.values()) {
      vehicle.dispose();
    }
    this.vehicles.clear();
    this.active = null;
  }

  private enterVehicle(vehicle: VehicleController): void {
    if (this.active) return;
    this.active = vehicle;
    this.player.setActive(false);
    this.player.setEnabled(false);
    this.interactionManager.setEnabled(false);
    this.camera.applyCameraConfig(vehicle.cameraConfig);
    this.camera.setTarget(vehicle.mesh, {
      body: vehicle.body,
      heightOffset: vehicle.cameraConfig.heightOffset,
      inputProvider: () => this.lastInput,
    });
    this.camera.snapToTarget();
    vehicle.enter(this.lastInput);
  }

  private exitVehicle(vehicle: VehicleController): void {
    const spawn = vehicle.exit();
    this.camera.resetTarget();
    this.camera.resetCameraConfig();
    this.camera.snapToTarget();
    this.player.setEnabled(true);
    this.player.setActive(true);
    this.player.spawn(this.ensureSpawnPoint(spawn));
    this.interactionManager.setEnabled(true);
    this.active = null;
    this.eventBus.emit('vehicle:exit', { position: spawn.position });
  }

  private ensureSpawnPoint(spawn: SpawnPointData): SpawnPointData {
    return {
      position: spawn.position.clone(),
      rotation: spawn.rotation?.clone(),
    };
  }
}
