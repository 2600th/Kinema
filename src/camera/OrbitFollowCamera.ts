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
  private baseFov: number;
  private mouseSensitivity = DEFAULT_CAMERA_CONFIG.mouseSensitivity;
  private invertY = false;
  private collisionEnabled = true;
  private pivotPosition = new THREE.Vector3();
  private readonly camFollowMult = 11;
  private readonly ropeCameraMinDistance = 4.2;

  private sphereShape: RAPIER.Shape;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private player: PlayerController,
    private physicsWorld: PhysicsWorld,
    _eventBus: EventBus,
  ) {
    this.sphereShape = new RAPIER.Ball(this.config.spherecastRadius);
    this.baseFov = this.camera.fov;
  }

  /** Process mouse deltas (called externally with raw input). */
  handleMouseInput(deltaX: number, deltaY: number): void {
    this.targetYaw -= deltaX * this.mouseSensitivity;
    // Pitch handling with clamp from camera config
    const signedDeltaY = this.invertY ? -deltaY : deltaY;
    this.targetPitch += signedDeltaY * this.mouseSensitivity;
    this.targetPitch = Math.max(
      this.config.pitchMin,
      Math.min(this.config.pitchMax, this.targetPitch),
    );
  }

  setMouseSensitivity(value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.mouseSensitivity = value;
  }

  setInvertY(value: boolean): void {
    this.invertY = value;
  }

  setBaseFov(value: number): void {
    if (!Number.isFinite(value)) return;
    this.baseFov = value;
  }

  setCollisionEnabled(enabled: boolean): void {
    this.collisionEnabled = enabled;
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
    const crouchCameraOffset = this.player.getCameraHeightOffset();
    _pivotPos.set(playerPos.x, playerPos.y + this.config.heightOffset - crouchCameraOffset, playerPos.z);
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
    const ropeAttached = this.player.isRopeAttached;
    let desiredDistance = ropeAttached
      ? Math.max(this.targetDistance, this.ropeCameraMinDistance)
      : this.targetDistance;
    const origin = new RAPIER.Vector3(this.pivotPosition.x, this.pivotPosition.y, this.pivotPosition.z);
    const rot = new RAPIER.Quaternion(0, 0, 0, 1);
    const dir = new RAPIER.Vector3(_idealDir.x, _idealDir.y, _idealDir.z);
    const shapeHit = this.collisionEnabled && !ropeAttached
      ? this.physicsWorld.castShape(
          origin,
          rot,
          dir,
          this.sphereShape,
          desiredDistance,
          undefined,
          this.player.body,
        )
      : null;
    if (shapeHit && shapeHit.time_of_impact < desiredDistance) {
      const hitDistance = shapeHit.time_of_impact - this.config.spherecastRadius * 0.92;
      desiredDistance = Math.max(
        this.config.zoomMinDistance,
        Math.min(desiredDistance, hitDistance),
      );
    }

    // Prevent abrupt camera pops when stepping very close to walls/doors.
    const distanceDelta = desiredDistance - this.currentDistance;
    const maxContractStep = Math.max(0.08, dt * 3.6);
    const maxExpandStep = ropeAttached
      ? Math.max(0.16, dt * 11.5)
      : Math.max(0.1, dt * 6.5);
    if (distanceDelta < 0) {
      this.currentDistance += Math.max(distanceDelta, -maxContractStep);
    } else {
      this.currentDistance += Math.min(distanceDelta, maxExpandStep);
    }
    this.currentDistance = Math.max(this.config.zoomMinDistance, this.currentDistance);

    // Build desired world-space camera position from pivot + distance
    _targetPos.copy(this.pivotPosition).addScaledVector(_idealDir, this.currentDistance);

    const positionDamp = 1 - Math.exp(-this.config.positionDamping * dt);
    this.camera.position.lerp(_targetPos, positionDamp);

    const input = this.player.lastInputSnapshot;
    const sprinting =
      !!input &&
      input.sprint &&
      (input.forward || input.backward || input.left || input.right);
    const targetFov = this.baseFov + (sprinting ? this.config.sprintFovBoost : 0);
    const fovDamp = 1 - Math.exp(-this.config.fovDamping * dt);
    this.camera.fov += (targetFov - this.camera.fov) * fovDamp;
    this.camera.updateProjectionMatrix();

    this.camera.lookAt(this.pivotPosition);
  }

  dispose(): void {
    // No event subscriptions to clean up — mouse input handled externally
  }
}
