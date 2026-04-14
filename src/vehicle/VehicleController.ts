import type {
  CameraConfig,
  Disposable,
  FixedUpdatable,
  InputState,
  PostPhysicsUpdatable,
  SpawnPointData,
  Updatable,
} from "@core/types";
import type RAPIER from "@dimforge/rapier3d-compat";
import type * as THREE from "three";

export type VehicleDriftState = "none" | "light" | "drift" | "slide";

export interface VehicleHandlingFeelState {
  readonly speedNorm: number;
  readonly forwardSpeed: number;
  readonly lateralSpeed: number;
  readonly slipAngle: number;
  readonly slipRatio: number;
  readonly slipSign: number;
  readonly driftAmount: number;
  readonly driftState: VehicleDriftState;
  readonly handbrake: boolean;
  readonly grounded: boolean;
  readonly groundedWheelCount: number;
}

export interface VehicleController extends FixedUpdatable, PostPhysicsUpdatable, Updatable, Disposable {
  readonly id: string;
  readonly type: "car" | "drone";
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Object3D;
  readonly exitOffset: THREE.Vector3;
  readonly cameraConfig: Partial<CameraConfig>;
  /**
   * Controls how the orbit camera consumes look input while this vehicle is active.
   * - full: normal orbit (yaw + pitch)
   * - yawOnly: consume X for yaw, keep pitch stable (use look Y for vehicle-specific controls)
   */
  readonly cameraLookMode?: "full" | "yawOnly";
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
  /** Optional: expose runtime diagnostics for dev tools and browser automation. */
  getDebugState?(): unknown;
  enableSteeringDebugTrace?(options?: { capacity?: number; autoLog?: boolean; label?: string | null }): unknown;
  disableSteeringDebugTrace?(): unknown;
  clearSteeringDebugTrace?(): void;
  getSteeringDebugTrace?(): unknown;
  dumpSteeringDebugTrace?(): unknown;
  getHandlingFeelState?(): VehicleHandlingFeelState | null;
}
