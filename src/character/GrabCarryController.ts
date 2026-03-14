import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import { COLLISION_GROUP_WORLD_ONLY } from '@core/constants';

// Pre-allocated vectors used only by grab/carry logic.
const _grabTarget = new THREE.Vector3();
const _grabForward = new THREE.Vector3();
const _carryTarget = new THREE.Vector3();

// Pre-allocated Rapier vectors for grab/carry operations.
const _rv3A = new RAPIER.Vector3(0, 0, 0);
const _rv3B = new RAPIER.Vector3(0, 0, 0);

/** Set x/y/z on a pre-allocated RAPIER.Vector3 and return it. */
function _setRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x; v.y = y; v.z = z;
  return v;
}

export interface CarryableObject {
  readonly id: string;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Object3D;
  readonly throwForce: number;
}

/**
 * Manages grab (kinematic position-lock) and carry (overhead hold + throw/drop)
 * interactions. Extracted from PlayerController to isolate grab/carry state and
 * keep the main controller focused on locomotion.
 */
export class GrabCarryController {
  // -- Grab state --
  private grabbedBody: RAPIER.RigidBody | null = null;
  private grabbedBodyType: number | null = null;
  private grabbedGravityScale: number | null = null;
  private grabbedCollisionGroups: number | null = null;
  private grabDistance = 1.2;
  private grabOffsetY = 0;

  // -- Carry state --
  private carriedObject: CarryableObject | null = null;
  private carriedBodyType: number | null = null;
  private carriedGravityScale: number | null = null;
  private carriedCollisionGroups: number | null = null;

  get isGrabbing(): boolean {
    return this.grabbedBody !== null;
  }

  get isCarrying(): boolean {
    return this.carriedObject !== null;
  }

  // ── Grab ────────────────────────────────────────────────────────────

  startGrab(body: RAPIER.RigidBody, playerPosition: THREE.Vector3, offset?: THREE.Vector3): void {
    if (this.grabbedBody || this.carriedObject) return;
    this.grabbedBody = body;
    this.grabbedBodyType = body.bodyType();
    this.grabbedGravityScale = body.gravityScale();
    const collider = body.collider(0);
    if (collider) {
      const cg = collider as unknown as { collisionGroups?: () => number };
      this.grabbedCollisionGroups = cg.collisionGroups ? cg.collisionGroups() : null;
      collider.setCollisionGroups(COLLISION_GROUP_WORLD_ONLY);
    } else {
      this.grabbedCollisionGroups = null;
    }
    const bodyPos = body.translation();
    const sourceOffset =
      offset ?? new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z).sub(playerPosition);
    this.grabDistance = Math.min(2.5, Math.max(0.8, Math.sqrt(sourceOffset.x ** 2 + sourceOffset.z ** 2)));
    this.grabOffsetY = sourceOffset.y;
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setGravityScale(0, true);
  }

  endGrab(cameraForward: THREE.Vector3, eventBus: EventBus): void {
    if (!this.grabbedBody) return;
    const body = this.grabbedBody;
    const collider = body.collider(0);
    if (collider && this.grabbedCollisionGroups != null) {
      collider.setCollisionGroups(this.grabbedCollisionGroups);
    }
    const bodyType = this.grabbedBodyType ?? RAPIER.RigidBodyType.Dynamic;
    body.setBodyType(bodyType, true);
    body.setGravityScale(this.grabbedGravityScale ?? 1, true);
    if (bodyType === RAPIER.RigidBodyType.Dynamic) {
      const forward = cameraForward.clone().setY(0).normalize();
      body.applyImpulse(_setRV(_rv3A, forward.x * 0.25, 0, forward.z * 0.25), true);
    }
    this.grabbedBody = null;
    this.grabbedBodyType = null;
    this.grabbedGravityScale = null;
    this.grabbedCollisionGroups = null;
    eventBus.emit('interaction:grabEnd', undefined);
  }

  updateGrab(playerPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (!this.grabbedBody) return;
    _grabForward.copy(cameraForward).setY(0);
    if (_grabForward.lengthSq() < 0.0001) {
      _grabForward.set(0, 0, -1);
    } else {
      _grabForward.normalize();
    }
    _grabTarget
      .set(playerPosition.x, playerPosition.y, playerPosition.z)
      .addScaledVector(_grabForward, this.grabDistance);
    _grabTarget.y += this.grabOffsetY;
    // Use only setNextKinematicTranslation so Rapier computes the correct
    // derived velocity for collision response. Mesh interpolation captures
    // the position after world.step() via postPhysicsUpdate().
    this.grabbedBody.setNextKinematicTranslation(_setRV(_rv3A, _grabTarget.x, _grabTarget.y, _grabTarget.z));
  }

  // ── Carry ───────────────────────────────────────────────────────────

  startCarry(object: CarryableObject): void {
    if (this.carriedObject || this.grabbedBody) return;
    this.carriedObject = object;
    this.carriedBodyType = object.body.bodyType();
    this.carriedGravityScale = object.body.gravityScale();
    const collider = object.collider as unknown as { collisionGroups?: () => number };
    this.carriedCollisionGroups = collider.collisionGroups ? collider.collisionGroups() : null;
    object.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    object.body.setGravityScale(0, true);
    object.collider.setCollisionGroups(COLLISION_GROUP_WORLD_ONLY);
  }

  throwCarried(cameraForward: THREE.Vector3, eventBus: EventBus): void {
    if (!this.carriedObject) return;
    const object = this.carriedObject;
    this.releaseCarryBody();
    object.body.enableCcd(true);
    const forward = cameraForward.clone().normalize();
    // Treat throwForce as a *target throw speed* (m/s) rather than a raw impulse.
    // WHY: applying a fixed impulse makes small/light objects reach extreme
    // velocities and tunnel through walls even with contact events enabled.
    const targetSpeed = Math.max(0.5, Math.min(object.throwForce, 10));
    object.body.setLinvel(
      _setRV(_rv3A, forward.x * targetSpeed, forward.y * targetSpeed, forward.z * targetSpeed),
      true,
    );
    // Add some spin for readability.
    object.body.setAngvel(_setRV(_rv3B, forward.z * 6, 5, -forward.x * 6), true);
    eventBus.emit('interaction:throw', { direction: forward.clone(), force: targetSpeed });
  }

  dropCarried(
    playerPosition: THREE.Vector3,
    capsuleHalfHeight: number,
    cameraForward: THREE.Vector3,
    eventBus: EventBus,
  ): void {
    if (!this.carriedObject) return;
    const object = this.carriedObject;
    const forward = cameraForward.clone().setY(0).normalize();
    _carryTarget.copy(playerPosition).addScaledVector(forward, 0.8);
    _carryTarget.y += capsuleHalfHeight + 0.2;
    this.releaseCarryBody();
    object.body.setTranslation(_setRV(_rv3A, _carryTarget.x, _carryTarget.y, _carryTarget.z), true);
    object.body.setLinvel(_setRV(_rv3B, 0, 0, 0), true);
    eventBus.emit('interaction:drop', undefined);
  }

  updateCarry(playerPosition: THREE.Vector3, capsuleHalfHeight: number): void {
    if (!this.carriedObject) return;
    _carryTarget.set(playerPosition.x, playerPosition.y + capsuleHalfHeight + 0.4, playerPosition.z);
    // Use only setNextKinematicTranslation so Rapier computes the correct
    // derived velocity for collision response. Mesh interpolation captures
    // the position after world.step() via postPhysicsUpdate().
    this.carriedObject.body.setNextKinematicTranslation(_setRV(_rv3A, _carryTarget.x, _carryTarget.y, _carryTarget.z));
  }

  /** Restores a carried body to its original physics state and clears carry fields. */
  private releaseCarryBody(): void {
    if (!this.carriedObject) return;
    const object = this.carriedObject;
    object.body.setBodyType(this.carriedBodyType ?? RAPIER.RigidBodyType.Dynamic, true);
    object.body.setGravityScale(this.carriedGravityScale ?? 1, true);
    if (this.carriedCollisionGroups != null) {
      object.collider.setCollisionGroups(this.carriedCollisionGroups);
    }
    this.carriedObject = null;
    this.carriedBodyType = null;
    this.carriedGravityScale = null;
    this.carriedCollisionGroups = null;
  }
}
