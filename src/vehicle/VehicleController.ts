import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable, InputState, SpawnPointData } from '@core/types';
import type { CameraConfig } from '@core/types';

export interface VehicleController extends FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  readonly id: string;
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Object3D;
  readonly exitOffset: THREE.Vector3;
  readonly cameraConfig: Partial<CameraConfig>;
  /**
   * Controls how the orbit camera consumes look input while this vehicle is active.
   * - full: normal orbit (yaw + pitch)
   * - yawOnly: consume X for yaw, keep pitch stable (use look Y for vehicle-specific controls)
   */
  readonly cameraLookMode?: 'full' | 'yawOnly';
  enter(input: InputState): void;
  exit(): SpawnPointData;
  setInput(input: InputState): void;
  /**
   * Optional: when implemented, the vehicle can steer relative to the player's camera.
   * The orbit camera always owns raw mouse look; vehicles can follow the camera yaw.
   */
  setControlYaw?(yaw: number): void;
  /** Optional: restore the vehicle to its authored spawn if it leaves the playable space. */
  resetToSpawn?(): void;
}
