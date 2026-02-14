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
  enter(input: InputState): void;
  exit(): SpawnPointData;
  setInput(input: InputState): void;
}
