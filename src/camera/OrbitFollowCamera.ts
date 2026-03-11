import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { Updatable, Disposable, InputState } from '@core/types';
import type { CameraConfig } from '@core/types';
import { COLLISION_GROUP_PLAYER, DEFAULT_CAMERA_CONFIG } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { PlayerController } from '@character/PlayerController';

// Pre-allocated temp objects
const _pivotPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _idealDir = new THREE.Vector3();
const _spherical = new THREE.Spherical();
const _velDir = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _zeroVec = new THREE.Vector3();

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
  private config = { ...DEFAULT_CAMERA_CONFIG };
  private defaultConfig = { ...DEFAULT_CAMERA_CONFIG };
  private baseFov: number;
  private mouseSensitivity = DEFAULT_CAMERA_CONFIG.mouseSensitivity;
  private invertY = false;
  private collisionEnabled = true;
  private pivotPosition = new THREE.Vector3();
  private readonly camFollowMult = 11;
  private readonly ropeCameraMinDistance = 4.2;
  private target: THREE.Object3D | null = null;
  private targetBody: RAPIER.RigidBody | null = null;
  private targetHeightOverride: number | null = null;
  private inputProvider: (() => InputState | null) | null = null;
  private collisionShape: RAPIER.Ball | null = null;
  private collisionShapeRadius = 0;
  private landingDip = 0;
  private lookAheadOffset = new THREE.Vector3();
  private lateralDriftCurrent = 0;

  get position(): THREE.Vector3 {
    return this.camera.position;
  }

  constructor(
    private camera: THREE.PerspectiveCamera,
    private player: PlayerController,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
  ) {
    this.baseFov = this.camera.fov;
    this.eventBus.on('player:landed', ({ impactSpeed }) => {
      this.landingDip = -Math.min(impactSpeed * 0.04, 0.4);
    });
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

  setTarget(
    object: THREE.Object3D,
    options?: { body?: RAPIER.RigidBody; heightOffset?: number; inputProvider?: () => InputState | null },
  ): void {
    this.target = object;
    this.targetBody = options?.body ?? null;
    this.targetHeightOverride = options?.heightOffset ?? null;
    this.inputProvider = options?.inputProvider ?? null;
  }

  snapToTarget(): void {
    const targetPos = this.target ? this.target.position : this.player.position;
    const crouchCameraOffset = this.target ? 0 : this.player.getCameraHeightOffset();
    const heightOffset = this.targetHeightOverride ?? this.config.heightOffset;
    _pivotPos.set(targetPos.x, targetPos.y + heightOffset - crouchCameraOffset, targetPos.z);
    this.pivotPosition.copy(_pivotPos);
    this.targetDistance = this.config.distance;
    this.currentDistance = this.config.distance;

    // Clear transient state so the camera doesn't smear from previous framing
    this.lookAheadOffset.set(0, 0, 0);
    this.lateralDriftCurrent = 0;
    this.landingDip = 0;

    // Place camera at the exact snap position immediately
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    _spherical.set(1, Math.PI / 2 - this.pitch, this.yaw);
    _idealDir.setFromSpherical(_spherical);
    this.camera.position.copy(this.pivotPosition).addScaledVector(_idealDir, this.currentDistance);
    this.camera.lookAt(this.pivotPosition);
  }

  resetTarget(): void {
    this.target = null;
    this.targetBody = null;
    this.targetHeightOverride = null;
    this.inputProvider = null;
  }

  applyCameraConfig(overrides: Partial<CameraConfig>): void {
    this.config = { ...this.config, ...overrides };
    this.targetDistance = this.config.distance;
  }

  resetCameraConfig(): void {
    this.config = { ...this.defaultConfig };
    this.targetDistance = this.config.distance;
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
    const targetPos = this.target ? this.target.position : this.player.position;
    const crouchCameraOffset = this.target ? 0 : this.player.getCameraHeightOffset();
    const heightOffset = this.targetHeightOverride ?? this.config.heightOffset;
    _pivotPos.set(targetPos.x, targetPos.y + heightOffset - crouchCameraOffset, targetPos.z);
    // Landing dip: decays back to zero
    this.landingDip = THREE.MathUtils.damp(this.landingDip, 0, 12, dt);
    _pivotPos.y += this.landingDip;

    // Velocity-aware camera: look-ahead + lateral drift
    const body = this.targetBody ?? this.player.body;
    const lv = body.linvel();
    const planarSpeed = Math.hypot(lv.x, lv.z);
    const speedNorm = Math.min(planarSpeed / 14, 1);

    // Look-ahead: offset pivot along velocity direction
    if (planarSpeed > 0.5) {
      _velDir.set(lv.x, 0, lv.z).normalize();
      const aheadAmount = speedNorm * this.config.lookAhead;
      _velDir.multiplyScalar(aheadAmount);
      this.lookAheadOffset.lerp(_velDir, 1 - Math.exp(-4 * dt));
    } else {
      this.lookAheadOffset.lerp(_zeroVec, 1 - Math.exp(-6 * dt));
    }
    _pivotPos.add(this.lookAheadOffset);

    // Lateral drift: shift pivot when strafing
    const inputForDrift = this.target ? this.inputProvider?.() : this.player.lastInputSnapshot;
    if (inputForDrift) {
      const drift = inputForDrift.moveX * this.config.lateralDriftScale;
      this.lateralDriftCurrent = THREE.MathUtils.damp(this.lateralDriftCurrent, drift, 5, dt);
      _camRight.set(1, 0, 0).applyAxisAngle(_worldUp, this.yaw);
      _pivotPos.addScaledVector(_camRight, this.lateralDriftCurrent);
    }

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
    const ropeAttached = this.target ? false : this.player.isRopeAttached;
    let desiredDistance = ropeAttached
      ? Math.max(this.targetDistance, this.ropeCameraMinDistance)
      : this.targetDistance;
    const origin = new RAPIER.Vector3(this.pivotPosition.x, this.pivotPosition.y, this.pivotPosition.z);
    const dir = new RAPIER.Vector3(_idealDir.x, _idealDir.y, _idealDir.z);
    const rayHit =
      this.collisionEnabled && !ropeAttached
        ? this.physicsWorld.castShape(
          origin,
          new RAPIER.Quaternion(0, 0, 0, 1),
          dir,
          this.getCollisionShape(),
          0, // targetDistance
          desiredDistance, // maxToi (direction is unit vector)
          undefined,
          this.targetBody ?? this.player.body,
          COLLISION_GROUP_PLAYER,
          (c) => !c.isSensor(),
        )
        : null;
    if (rayHit && rayHit.time_of_impact < desiredDistance) {
      const hitDistance = rayHit.time_of_impact - this.config.spherecastRadius * 0.92;
      desiredDistance = Math.max(this.config.zoomMinDistance, Math.min(desiredDistance, hitDistance));
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

    const input = this.target ? this.inputProvider?.() ?? null : this.player.lastInputSnapshot;
    const sprinting =
      !!input &&
      input.sprint &&
      (input.forward || input.backward || input.left || input.right);
    const speedFov = speedNorm * this.config.speedFovBoost;
    const sprintFov = sprinting ? this.config.sprintFovBoost : 0;
    const targetFov = this.baseFov + Math.max(speedFov, sprintFov);
    const fovDamp = 1 - Math.exp(-this.config.fovDamping * dt);
    let nextFov = this.camera.fov + (targetFov - this.camera.fov) * fovDamp;
    // Avoid endless subpixel projection jitter from asymptotic damping convergence.
    if (Math.abs(targetFov - nextFov) < 0.0001) {
      nextFov = targetFov;
    }
    if (Math.abs(nextFov - this.camera.fov) > 0.00001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(this.pivotPosition);
  }

  private getCollisionShape(): RAPIER.Ball {
    const r = Math.max(0.01, this.config.spherecastRadius);
    if (!this.collisionShape || Math.abs(this.collisionShapeRadius - r) > 0.0001) {
      this.collisionShapeRadius = r;
      this.collisionShape = new RAPIER.Ball(r);
    }
    return this.collisionShape;
  }

  dispose(): void {
    // No event subscriptions to clean up — mouse input handled externally
  }
}
