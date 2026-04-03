import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { Updatable, Disposable, InputState } from '@core/types';
import type { CameraConfig } from '@core/types';
import { COLLISION_GROUP_PLAYER, DEFAULT_CAMERA_CONFIG } from '@core/constants';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { PlayerController } from '@character/PlayerController';
import { ScreenShake } from '@juice/ScreenShake';
import type { FOVPunch } from '@juice/FOVPunch';

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
  private landingDipVelocity = 0;
  private lookAheadOffset = new THREE.Vector3();
  private lateralDriftCurrent = 0;
  private screenShake = new ScreenShake();
  private fovPunch: FOVPunch | null = null;
  private unsubs: (() => void)[] = [];

  // Chase mode: auto-rotates yaw to face behind a vehicle's forward direction
  private chaseModeEnabled = false;

  // Speed-feel: dynamic FOV and distance offsets driven by vehicle speed
  private speedFovOffset = 0;
  private speedDistanceOffset = 0;

  // Pre-allocated Rapier temps for castShape (avoid per-frame heap allocs).
  private _rv3Origin = new RAPIER.Vector3(0, 0, 0);
  private _rv3Dir = new RAPIER.Vector3(0, 0, 0);
  private _rQuatIdentity = new RAPIER.Quaternion(0, 0, 0, 1);

  // Collision caching: castShape runs at 30 Hz, result reused between ticks.
  private collisionQueryTimer = 0;
  private cachedCollisionToi = Number.POSITIVE_INFINITY;

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
    this.unsubs.push(
      this.eventBus.on('player:landed', ({ impactSpeed }) => {
        this.landingDipVelocity -= Math.min(impactSpeed * 0.18, 1.25);
      }),
    );
    this.unsubs.push(
      this.eventBus.on('player:respawned', () => {
        this.snapToTarget();
      }),
    );
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

  /** Add trauma to the screen shake system (0-1 range, clamped). */
  addTrauma(amount: number): void {
    this.screenShake.addTrauma(amount);
  }

  /** Attach an FOV punch spring to be applied each frame. */
  setFOVPunch(fovPunch: FOVPunch): void {
    this.fovPunch = fovPunch;
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
    const targetPos = this.target ? this.target.position : this.player.renderPosition;
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
    this.landingDipVelocity = 0;

    // Place camera at the exact snap position immediately
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    _spherical.set(1, Math.PI / 2 - this.pitch, this.yaw);
    _idealDir.setFromSpherical(_spherical);
    this.camera.position.copy(this.pivotPosition).addScaledVector(_idealDir, this.currentDistance);
    this.camera.lookAt(this.pivotPosition);
  }

  /** Set yaw and pitch directly (for headless screenshot capture). */
  snapToAngle(yaw: number, pitch: number): void {
    this.targetYaw = yaw;
    this.targetPitch = pitch;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  resetTarget(): void {
    this.target = null;
    this.targetBody = null;
    this.targetHeightOverride = null;
    this.inputProvider = null;
    // Reset vehicle camera effects
    this.chaseModeEnabled = false;
    this.speedFovOffset = 0;
    this.speedDistanceOffset = 0;
  }

  /**
   * Enable/disable chase-camera mode.
   * When active, the camera yaw auto-rotates behind the target's forward
   * direction while still allowing mouse offsets that drift back.
   */
  setChaseMode(enabled: boolean): void {
    this.chaseModeEnabled = enabled;
  }

  /**
   * Feed the current vehicle speed ratio (0-1) so the camera can apply
   * speed-feel effects: FOV widening and distance pullback.
   */
  setVehicleSpeedRatio(ratio: number): void {
    this.speedFovOffset = ratio * 15;       // up to +15° FOV at top speed
    this.speedDistanceOffset = ratio * 3;   // up to +3 m pullback at top speed
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

  /** Current world-space camera forward direction. */
  getForwardDirection(target: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldDirection(target).normalize();
  }

  /** Render-frame update — position camera with collision. */
  update(dt: number, _alpha: number): void {
    // Smooth camera rotation for a less abrupt orbit response.
    const rotationDamp = 1 - Math.exp(-this.config.rotationDamping * dt);
    this.yaw += (this.targetYaw - this.yaw) * rotationDamp;
    this.pitch += (this.targetPitch - this.pitch) * rotationDamp;

    // Chase mode: compute behind-vehicle yaw from the target's rotation and
    // smoothly drift targetYaw toward it. Mouse input still offsets yaw, but
    // it auto-returns, giving a "chase camera" feel.
    if (this.chaseModeEnabled && this.target) {
      // Extract the target's Y-axis rotation. We want the camera BEHIND the
      // vehicle, so we use the negated forward direction (behind = -forward).
      const q = this.target.quaternion;
      _velDir.set(0, 0, -1).applyQuaternion(q);
      // Negate forward to get behind direction; atan2 of behind vector gives
      // the yaw that places the camera orbit point behind the vehicle.
      const behindYaw = Math.atan2(-_velDir.x, -_velDir.z);
      // Smoothly drift targetYaw toward behindYaw along the shortest arc
      const twoPi = Math.PI * 2;
      let delta = ((((behindYaw - this.targetYaw) % twoPi) + Math.PI * 3) % twoPi) - Math.PI;
      const chaseT = 1 - Math.exp(-3 * dt);
      this.targetYaw += delta * chaseT;
    }

    // Pivot at player head height — clamp to ceiling if in tight tunnel.
    const targetPos = this.target ? this.target.position : this.player.renderPosition;
    const crouchCameraOffset = this.target ? 0 : this.player.getCameraHeightOffset();
    let heightOffset = this.targetHeightOverride ?? this.config.heightOffset;

    // Ceiling probe: check if there's geometry above the ideal pivot.
    // If so, lower the pivot to stay below it (prevents camera fighting ceiling).
    if (!this.target) {
      const probeY = targetPos.y + heightOffset - crouchCameraOffset;
      const ceilingClearance = 0.4; // stay this far below ceiling
      this._rv3Origin.x = targetPos.x;
      this._rv3Origin.y = targetPos.y + 0.2; // probe from just above player center
      this._rv3Origin.z = targetPos.z;
      const upDir = { x: 0, y: 1, z: 0 } as RAPIER.Vector3;
      const ceilingHit = this.physicsWorld.castRay(
        this._rv3Origin,
        upDir,
        heightOffset + 1,
        undefined,
        this.player.body,
      );
      if (ceilingHit) {
        const ceilingY = targetPos.y + 0.2 + ceilingHit.timeOfImpact;
        const maxPivotY = ceilingY - ceilingClearance;
        const idealPivotY = probeY;
        if (idealPivotY > maxPivotY) {
          // Reduce height offset so pivot stays below ceiling
          heightOffset = maxPivotY - targetPos.y + crouchCameraOffset;
          heightOffset = Math.max(0.3, heightOffset); // never go below player center
        }
      }
    }

    _pivotPos.set(targetPos.x, targetPos.y + heightOffset - crouchCameraOffset, targetPos.z);
    // Landing dip: critically-damped spring drives pivot back to neutral.
    const landingK = 150;
    const landingC = 22;
    this.landingDipVelocity += (-landingK * this.landingDip - landingC * this.landingDipVelocity) * dt;
    this.landingDip += this.landingDipVelocity * dt;
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
      : this.targetDistance + this.speedDistanceOffset;

    // Collision caching at 30 Hz: run castShape only when the timer expires,
    // then reuse cachedCollisionToi every render frame in between.
    // When collision is disabled or rope is attached, always clear the cache.
    if (!this.collisionEnabled || ropeAttached) {
      this.cachedCollisionToi = Number.POSITIVE_INFINITY;
      this.collisionQueryTimer = 0;
    } else {
      this.collisionQueryTimer -= dt;
      if (this.collisionQueryTimer <= 0) {
        this.collisionQueryTimer = 1 / 30;
        this._rv3Origin.x = this.pivotPosition.x;
        this._rv3Origin.y = this.pivotPosition.y;
        this._rv3Origin.z = this.pivotPosition.z;
        this._rv3Dir.x = _idealDir.x;
        this._rv3Dir.y = _idealDir.y;
        this._rv3Dir.z = _idealDir.z;
        const carriedBody = this.target ? null : this.player.carriedBody;
        const rayHit = this.physicsWorld.castShape(
          this._rv3Origin,
          this._rQuatIdentity,
          this._rv3Dir,
          this.getCollisionShape(),
          0, // targetDistance
          desiredDistance, // maxToi (direction is unit vector)
          undefined,
          this.targetBody ?? this.player.body,
          COLLISION_GROUP_PLAYER,
          (c) => {
            if (c.isSensor()) return false;
            if (carriedBody && c.parent() === carriedBody) return false;
            return true;
          },
        );
        this.cachedCollisionToi = rayHit ? rayHit.time_of_impact : Number.POSITIVE_INFINITY;
      }
    }
    if (this.cachedCollisionToi < desiredDistance) {
      const hitDistance = this.cachedCollisionToi - this.config.spherecastRadius * 0.92;
      desiredDistance = Math.max(this.config.zoomMinDistance, Math.min(desiredDistance, hitDistance));
    }
    // Self-clip floor: prevent camera from entering the player capsule.
    const selfClipMin = 0.3 + this.config.spherecastRadius + 0.15;
    desiredDistance = Math.max(selfClipMin, desiredDistance);

    // Smooth camera distance with frame-rate independent exponential smoothing.
    const contractionSpeed = 12;  // fast pull-in on collision
    const expansionSpeed = ropeAttached ? 11.5 : 4; // slower return (faster when rope attached)
    const speed = (this.currentDistance > desiredDistance) ? contractionSpeed : expansionSpeed;
    this.currentDistance += (desiredDistance - this.currentDistance) * (1 - Math.exp(-speed * dt));
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
    const speedFov = speedNorm * speedNorm * this.config.speedFovBoost;
    const sprintFov = sprinting ? this.config.sprintFovBoost : 0;
    const locomotionFov = Math.min(12, speedFov + sprintFov);
    const punchFov = this.fovPunch?.update(dt) ?? 0;
    const targetFov = this.baseFov + locomotionFov + this.speedFovOffset + punchFov;
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

    // Apply screen shake offsets after final camera positioning
    const shake = this.screenShake.update(dt);
    if (shake.offsetX !== 0 || shake.offsetY !== 0 || shake.offsetZ !== 0) {
      this.camera.position.x += shake.offsetX;
      this.camera.position.y += shake.offsetY;
      this.camera.position.z += shake.offsetZ;
      this.camera.rotateX(shake.rotX);
      this.camera.rotateY(shake.rotY);
      this.camera.rotateZ(shake.rotZ);
    }
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
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
  }
}
