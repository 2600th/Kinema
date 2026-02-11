import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { Updatable, Disposable } from '@core/types';
import { DEFAULT_CAMERA_CONFIG } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { PlayerController } from '@character/PlayerController';

// Pre-allocated temp objects
const _pivotPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _idealDir = new THREE.Vector3();
const _spherical = new THREE.Spherical();

/**
 * Orbit-follow camera with spring arm collision.
 * Runs in render loop for maximum responsiveness.
 */
export class OrbitFollowCamera implements Updatable, Disposable {
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private currentDistance = DEFAULT_CAMERA_CONFIG.distance;
  private targetDistance = DEFAULT_CAMERA_CONFIG.distance;
  private config = DEFAULT_CAMERA_CONFIG;
  private pivotPosition = new THREE.Vector3();
  private readonly camFollowMult = 11;

  private sphereShape: RAPIER.Shape;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private player: PlayerController,
    private physicsWorld: PhysicsWorld,
    _eventBus: EventBus,
  ) {
    this.sphereShape = new RAPIER.Ball(this.config.spherecastRadius);
  }

  /** Process mouse deltas (called externally with raw input). */
  handleMouseInput(deltaX: number, deltaY: number): void {
    this.targetYaw -= deltaX * this.config.mouseSensitivity;
    // Pitch handling with clamp from camera config
    this.targetPitch += deltaY * this.config.mouseSensitivity;
    this.targetPitch = Math.max(
      this.config.pitchMin,
      Math.min(this.config.pitchMax, this.targetPitch),
    );
  }

  /** Process wheel input for camera zoom. */
  handleZoomInput(mouseWheelDelta: number): void {
    if (mouseWheelDelta === 0) return;
    this.targetDistance += mouseWheelDelta * 0.002 * this.config.zoomSpeed;
    this.targetDistance = Math.max(
      this.config.zoomMinDistance,
      Math.min(this.config.zoomMaxDistance, this.targetDistance),
    );
  }

  /** Get current yaw for player movement calculations. */
  getYaw(): number {
    return this.yaw;
  }

  /** Render-frame update — position camera with collision. */
  update(dt: number, _alpha: number): void {
    // Smooth camera rotation for a less abrupt orbit response.
    const rotationDamp = 1 - Math.exp(-this.config.rotationDamping * dt);
    this.yaw += (this.targetYaw - this.yaw) * rotationDamp;
    this.pitch += (this.targetPitch - this.pitch) * rotationDamp;

    // Pivot at player head height
    const playerPos = this.player.position;
    _pivotPos.set(playerPos.x, playerPos.y + this.config.heightOffset, playerPos.z);
    if (this.pivotPosition.lengthSq() < 0.0001) {
      this.pivotPosition.copy(_pivotPos);
    } else {
      const pivotDamp = 1 - Math.exp(-this.camFollowMult * dt);
      this.pivotPosition.lerp(_pivotPos, pivotDamp);
    }

    // Compute ideal camera direction (unit vector)
    _spherical.set(1, Math.PI / 2 - this.pitch, this.yaw);
    _idealDir.setFromSpherical(_spherical);

    // Detect collision along desired distance
    let desiredDistance = this.targetDistance;
    const origin = new RAPIER.Vector3(this.pivotPosition.x, this.pivotPosition.y, this.pivotPosition.z);
    const rot = new RAPIER.Quaternion(0, 0, 0, 1);
    const dir = new RAPIER.Vector3(_idealDir.x, _idealDir.y, _idealDir.z);
    const shapeHit = this.physicsWorld.castShape(
      origin,
      rot,
      dir,
      this.sphereShape,
      desiredDistance,
      undefined,
      this.player.body,
    );
    if (shapeHit && shapeHit.time_of_impact < desiredDistance) {
      desiredDistance = Math.max(
        this.config.zoomMinDistance,
        Math.min(desiredDistance, shapeHit.time_of_impact * this.config.collisionOffset),
      );
    }

    const distanceDamp = 1 - Math.exp(
      -(shapeHit ? this.config.collisionSpeed : this.config.positionDamping) * dt,
    );
    this.currentDistance += (desiredDistance - this.currentDistance) * distanceDamp;

    // Build desired world-space camera position from pivot + distance
    _targetPos.copy(this.pivotPosition).addScaledVector(_idealDir, this.currentDistance);

    const positionDamp = 1 - Math.exp(-this.config.positionDamping * dt);
    this.camera.position.lerp(_targetPos, positionDamp);
    this.camera.lookAt(this.pivotPosition);
  }

  dispose(): void {
    // No event subscriptions to clean up — mouse input handled externally
  }
}
