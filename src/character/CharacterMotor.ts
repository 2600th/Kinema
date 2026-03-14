import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerConfig } from '@core/types';
import type { PhysicsWorld } from '@physics/PhysicsWorld';

// Pre-allocated vectors for ground queries — owned by the motor.
const _rayOrigin = new THREE.Vector3();
const _slopeRayOrigin = new THREE.Vector3();
const _slopeForward = new THREE.Vector3();
const _actualSlopeNormal = new THREE.Vector3(0, 1, 0);
const _standingForcePoint = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

const _rapierDown = new RAPIER.Vector3(0, -1, 0);

// Pre-allocated Rapier vectors to avoid per-frame GC pressure.
const _rv3A = new RAPIER.Vector3(0, 0, 0);
const _rv3B = new RAPIER.Vector3(0, 0, 0);

/** Set x/y/z on a pre-allocated RAPIER.Vector3 and return it. */
function _setRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x; v.y = y; v.z = z;
  return v;
}

/** Raycast filter: skip sensors and vehicle colliders. */
export function notSensorOrVehicle(c: RAPIER.Collider): boolean {
  if (c.isSensor()) return false;
  const parent = c.parent();
  if (parent) {
    const ud = parent.userData as { kind?: string } | null;
    if (ud?.kind === 'vehicle') return false;
  }
  return true;
}

export interface GroundInfo {
  closeToGround: boolean;
  movementGrounded: boolean;
  effectivelyGrounded: boolean;
  canJump: boolean;
  isGrounded: boolean;
  slopeAngle: number;
  slopeNormal: THREE.Vector3;
  standingSlopeAllowed: boolean;
  groundBody: RAPIER.RigidBody | null;
  floatingRayHit: RAPIER.RayColliderHit | null;
  groundedGrace: number;
  /** The standing force application point (bottom of capsule at ray hit). */
  standingForcePoint: THREE.Vector3;
}

/** Check if a body should receive ground reaction forces. */
export function shouldApplyGroundReaction(body: RAPIER.RigidBody | null): boolean {
  if (!body) return false;
  const data = body.userData;
  if (typeof data !== 'object' || data === null) return true;
  const kind = (data as { kind?: unknown }).kind;
  return kind !== 'floating-platform';
}

/**
 * Handles ground detection, floating spring force, and gravity scaling.
 * Pure physics queries — knows nothing about input, FSM, crouch, grab, or carry.
 */
export class CharacterMotor {
  /** Frames to suppress grounded detection after a jump to prevent instant re-grounding. */
  private jumpSuppressGroundFrames = 0;
  private groundedGrace = 0;
  private currentGravityScale = 1;

  /**
   * Run ground queries and return the result. Does NOT mutate PlayerController state.
   */
  queryGround(
    body: RAPIER.RigidBody,
    capsuleHalfHeight: number,
    meshQuaternion: THREE.Quaternion,
    config: PlayerConfig,
    physicsWorld: PhysicsWorld,
    floatingDistance: number,
    dt: number,
  ): GroundInfo {
    const pos = body.translation();

    _rayOrigin.set(
      pos.x,
      pos.y - capsuleHalfHeight,
      pos.z,
    );

    const floatingRayHit = physicsWorld.castRay(
      _setRV(_rv3A, _rayOrigin.x, _rayOrigin.y, _rayOrigin.z),
      _rapierDown,
      config.floatingRayLength,
      undefined,
      body,
      notSensorOrVehicle,
    );

    const closeToGround =
      floatingRayHit !== null &&
      floatingRayHit.timeOfImpact < floatingDistance + config.floatingRayHitForgiveness;

    // Slope detection: two separate concerns.
    // 1. standingSlopeAllowed: Is the surface DIRECTLY UNDER the player walkable?
    //    Used for grounding/jump validation. Uses the floating ray origin (straight down).
    // 2. actualSlopeAngle/Normal: Forward probe for movement velocity projection on slopes.
    //    NOT used for grounding — prevents walls from blocking jumps on flat ground.
    let slopeAngle = 0;
    _actualSlopeNormal.set(0, 1, 0);
    let standingSlopeAllowed = true;

    if (closeToGround) {
      // Ground normal directly under the player for jump/grounding validation.
      const standingNormal = physicsWorld.castRayAndGetNormal(
        _setRV(_rv3A, _rayOrigin.x, _rayOrigin.y, _rayOrigin.z),
        _rapierDown,
        config.floatingRayLength,
        undefined,
        body,
      );
      if (standingNormal) {
        const standAngle = new THREE.Vector3(
          standingNormal.normal.x, standingNormal.normal.y, standingNormal.normal.z,
        ).angleTo(_worldUp);
        standingSlopeAllowed = standAngle < config.slopeMaxAngle;
      }

      // Forward slope probe for movement velocity adjustment only.
      _slopeForward.set(0, 0, 1).applyQuaternion(meshQuaternion);
      _slopeRayOrigin.copy(_rayOrigin).addScaledVector(_slopeForward, config.slopeRayOriginOffset);
      const slopeRayHit = physicsWorld.castRay(
        _setRV(_rv3A, _slopeRayOrigin.x, _slopeRayOrigin.y, _slopeRayOrigin.z),
        _rapierDown,
        config.slopeRayLength,
        undefined,
        body,
        notSensorOrVehicle,
      );
      if (slopeRayHit) {
        const n = physicsWorld.castRayAndGetNormal(
          _setRV(_rv3A, _slopeRayOrigin.x, _slopeRayOrigin.y, _slopeRayOrigin.z),
          _rapierDown,
          config.slopeRayLength,
          undefined,
          body,
        );
        if (n) {
          _actualSlopeNormal.set(n.normal.x, n.normal.y, n.normal.z).normalize();
          slopeAngle = _actualSlopeNormal.angleTo(_worldUp);
        }
      }
    }

    const movementGrounded = closeToGround && standingSlopeAllowed;

    // Suppress grounded detection for a few frames after a jump to prevent
    // the ground probe from re-grounding the player on the same tick.
    if (this.jumpSuppressGroundFrames > 0) {
      this.jumpSuppressGroundFrames--;
    }
    const effectivelyGrounded = movementGrounded && this.jumpSuppressGroundFrames <= 0;

    if (effectivelyGrounded) {
      this.groundedGrace = config.coyoteTime;
    } else {
      this.groundedGrace = Math.max(0, this.groundedGrace - dt);
    }
    // isGrounded reflects actual ground contact; canJump keeps coyote forgiveness.
    const canJump = effectivelyGrounded || this.groundedGrace > 0;
    const isGrounded = effectivelyGrounded;

    // Compute standing force point for ground reaction forces.
    _standingForcePoint.set(
      _rayOrigin.x,
      floatingRayHit ? _rayOrigin.y - floatingRayHit.timeOfImpact : _rayOrigin.y,
      _rayOrigin.z,
    );

    let groundBody: RAPIER.RigidBody | null = null;
    if (floatingRayHit?.collider.parent() && canJump) {
      groundBody = floatingRayHit.collider.parent()!;
    }

    return {
      closeToGround,
      movementGrounded,
      effectivelyGrounded,
      canJump,
      isGrounded,
      slopeAngle,
      slopeNormal: _actualSlopeNormal,
      standingSlopeAllowed,
      groundBody,
      floatingRayHit,
      groundedGrace: this.groundedGrace,
      standingForcePoint: _standingForcePoint,
    };
  }

  /**
   * Apply floating spring force based on ground info.
   */
  applyFloatingSpring(
    body: RAPIER.RigidBody,
    groundInfo: GroundInfo,
    config: PlayerConfig,
    floatingDistance: number,
  ): void {
    if (!groundInfo.floatingRayHit || !groundInfo.canJump) return;

    const vel = body.linvel();
    const floatingForce =
      config.floatingSpringK * (floatingDistance - groundInfo.floatingRayHit.timeOfImpact) -
      vel.y * config.floatingDampingC;
    body.applyImpulse(_setRV(_rv3A, 0, floatingForce, 0), false);

    const standingBody = groundInfo.floatingRayHit.collider.parent();
    if (standingBody && floatingForce > 0 && shouldApplyGroundReaction(standingBody)) {
      standingBody.applyImpulseAtPoint(
        _setRV(_rv3A, 0, -floatingForce, 0),
        _setRV(_rv3B, groundInfo.standingForcePoint.x, groundInfo.standingForcePoint.y, groundInfo.standingForcePoint.z),
        true,
      );
    }
  }

  /**
   * Apply gravity scaling (apex, falling, terminal velocity clamp).
   */
  applyGravity(
    body: RAPIER.RigidBody,
    currentVelY: number,
    canJump: boolean,
    config: PlayerConfig,
  ): void {
    if (currentVelY < -config.fallingMaxVelocity) {
      const lv = body.linvel();
      body.setLinvel(_setRV(_rv3A, lv.x, -config.fallingMaxVelocity, lv.z), true);
      this.setGravityScale(body, config.fallingGravityScale);
    } else {
      const airborne = !canJump;
      const atApex = airborne && Math.abs(currentVelY) < config.apexHangThreshold;
      const falling = currentVelY < 0 && airborne;
      if (atApex) {
        this.setGravityScale(body, config.apexGravityScale);
      } else if (falling) {
        this.setGravityScale(body, config.fallingGravityScale);
      } else {
        this.setGravityScale(body, 1);
      }
    }
  }

  /** Apply variable jump cut (called from PlayerController when jump key released while rising). */
  applyJumpCut(
    body: RAPIER.RigidBody,
    config: PlayerConfig,
  ): void {
    const jumpCutCeiling = config.jumpForce * 0.58;
    const lv = body.linvel();
    const newVy = Math.min(lv.y, jumpCutCeiling);
    body.setLinvel(_setRV(_rv3A, lv.x, newVy, lv.z), true);
    this.setGravityScale(body, config.fallingGravityScale + 0.25);
  }

  /** Call when a jump fires to suppress ground detection. */
  onJumpFired(): void {
    this.jumpSuppressGroundFrames = 3;
  }

  /** Whether jump suppression is active (needed for variable jump cut timing). */
  get isJumpSuppressed(): boolean {
    return this.jumpSuppressGroundFrames > 0;
  }

  /** Current gravity scale. */
  get gravityScale(): number {
    return this.currentGravityScale;
  }

  /** Clear coyote time grace (e.g. when entering rope/ladder). */
  clearGroundedGrace(): void {
    this.groundedGrace = 0;
  }

  /** Reset all state (for spawn/respawn). */
  reset(): void {
    this.jumpSuppressGroundFrames = 0;
    this.groundedGrace = 0;
    this.currentGravityScale = 1;
  }

  /** Directly set gravity scale (used by ladder, rope, etc.). */
  setGravityScale(body: RAPIER.RigidBody, scale: number): void {
    if (Math.abs(this.currentGravityScale - scale) < 0.0001) return;
    this.currentGravityScale = scale;
    body.setGravityScale(scale, true);
  }
}
