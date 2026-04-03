import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import { COLLISION_GROUP_WORLD_ONLY } from '@core/constants';

// Pre-allocated vectors used only by grab/carry logic.
const _grabTarget = new THREE.Vector3();
const _grabForward = new THREE.Vector3();
const _carryTarget = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();

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
  private grabbedActiveCollisionTypes: number | null = null;
  private grabDistance = 1.2;
  private grabOriginalY = 0;
  private grabFaceNormal: THREE.Vector3 | null = null;
  private grabAnchorPerp = 0; // perpendicular position component at grab time
  private grabWeightMult = 1.0;

  // -- Carry state --
  private carriedObject: CarryableObject | null = null;
  private carriedBodyType: number | null = null;
  private carriedActiveCollisionTypes: number | null = null;
  private carriedGravityScale: number | null = null;
  private carriedCollisionGroups: number | null = null;

  get isGrabbing(): boolean {
    return this.grabbedBody !== null;
  }

  get isCarrying(): boolean {
    return this.carriedObject !== null;
  }

  /** The rigidbody of the currently carried object, if any. */
  get carriedBody(): RAPIER.RigidBody | null {
    return this.carriedObject?.body ?? null;
  }

  /** Face normal of the grabbed box face (push direction). Null if no axis lock. */
  get grabAxis(): THREE.Vector3 | null {
    return this.grabFaceNormal;
  }

  /** Weight multiplier for grab movement speed (1.0 = no slowdown). */
  get weightMultiplier(): number {
    return this.grabWeightMult;
  }

  /** The currently grabbed physics body (for reading velocity). */
  get grabbedRigidBody(): RAPIER.RigidBody | null {
    return this.grabbedBody;
  }

  // ── Grab ────────────────────────────────────────────────────────────

  startGrab(body: RAPIER.RigidBody, playerPosition: THREE.Vector3, offset?: THREE.Vector3, grabWeight?: number): void {
    if (this.grabbedBody || this.carriedObject) return;
    this.grabbedBody = body;
    this.grabbedBodyType = body.bodyType();
    this.grabbedGravityScale = body.gravityScale();
    this.grabWeightMult = grabWeight ?? 1.0;
    const collider = body.collider(0);
    if (collider) {
      const cg = collider as unknown as { collisionGroups?: () => number };
      this.grabbedCollisionGroups = cg.collisionGroups ? cg.collisionGroups() : null;
      this.grabbedActiveCollisionTypes = collider.activeCollisionTypes();
      collider.setCollisionGroups(COLLISION_GROUP_WORLD_ONLY);
      // Enable kinematic-vs-fixed collisions so the held object doesn't ghost through walls
      collider.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED);
    } else {
      this.grabbedCollisionGroups = null;
      this.grabbedActiveCollisionTypes = null;
    }
    const bodyPos = body.translation();
    const sourceOffset =
      offset ?? new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z).sub(playerPosition);
    // Keep grab distance short for natural push/pull feel (arm's length)
    this.grabDistance = Math.min(1.0, Math.max(0.6, Math.sqrt(sourceOffset.x ** 2 + sourceOffset.z ** 2)));
    this.grabOriginalY = bodyPos.y;
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setGravityScale(0, true);

    // Compute nearest horizontal box face for axis-locked grab
    this.computeGrabFace(body, playerPosition);
  }

  /** Find which horizontal box face the player is closest to and lock the grab axis. */
  private computeGrabFace(body: RAPIER.RigidBody, playerPosition: THREE.Vector3): void {
    const collider = body.collider(0);
    if (!collider) { this.grabFaceNormal = null; return; }

    const bodyPos = body.translation();
    const bodyRot = body.rotation();
    const q = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);

    // Get half-extents for a cuboid collider
    const he = (collider as any).halfExtents?.();
    if (!he) { this.grabFaceNormal = null; return; }

    // Test 4 horizontal face normals rotated by body orientation
    const normals: THREE.Vector3[] = [
      new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      new THREE.Vector3(-1, 0, 0).applyQuaternion(q),
      new THREE.Vector3(0, 0, 1).applyQuaternion(q),
      new THREE.Vector3(0, 0, -1).applyQuaternion(q),
    ];
    _toPlayer.set(playerPosition.x - bodyPos.x, 0, playerPosition.z - bodyPos.z).normalize();

    let bestDot = -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < 4; i++) {
      // Pick the face whose outward normal points most toward the player
      const dot = normals[i].x * _toPlayer.x + normals[i].z * _toPlayer.z;
      if (dot > bestDot) {
        bestDot = dot;
        bestIdx = i;
      }
    }

    this.grabFaceNormal = normals[bestIdx].clone();
    // Store the perpendicular component of the box position at grab time
    // (perpendicular to the face normal in the XZ plane)
    const perp = this.grabFaceNormal.z * bodyPos.x - this.grabFaceNormal.x * bodyPos.z;
    this.grabAnchorPerp = perp;
  }

  endGrab(cameraForward: THREE.Vector3, eventBus: EventBus): void {
    if (!this.grabbedBody) return;
    const body = this.grabbedBody;
    const collider = body.collider(0);
    if (collider) {
      if (this.grabbedCollisionGroups != null) collider.setCollisionGroups(this.grabbedCollisionGroups);
      if (this.grabbedActiveCollisionTypes != null) collider.setActiveCollisionTypes(this.grabbedActiveCollisionTypes);
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
    this.grabbedActiveCollisionTypes = null;
    this.grabbedCollisionGroups = null;
    this.grabFaceNormal = null;
    this.grabWeightMult = 1.0;
    eventBus.emit('interaction:grabEnd', undefined);
  }

  updateGrab(playerPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (!this.grabbedBody) return;

    if (this.grabFaceNormal) {
      // Axis-locked grab: constrain box to move only along the face normal axis.
      // Project player position onto the grab axis to get the push/pull component.
      const n = this.grabFaceNormal;
      const axisPos = n.x * playerPosition.x + n.z * playerPosition.z - this.grabDistance;
      // Reconstruct position: axis component from player, perpendicular from anchor
      // Given n = (nx, 0, nz), perp = (nz, 0, -nx)
      // pos = axisPos * n + anchorPerp * perp
      _grabTarget.set(
        axisPos * n.x + this.grabAnchorPerp * n.z,
        this.grabOriginalY,
        axisPos * n.z - this.grabAnchorPerp * n.x,
      );
    } else {
      // Fallback: camera-forward positioning (original behavior)
      _grabForward.copy(cameraForward).setY(0);
      if (_grabForward.lengthSq() < 0.0001) {
        _grabForward.set(0, 0, -1);
      } else {
        _grabForward.normalize();
      }
      _grabTarget
        .set(playerPosition.x, this.grabOriginalY, playerPosition.z)
        .addScaledVector(_grabForward, this.grabDistance);
    }

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
    this.carriedActiveCollisionTypes = object.collider.activeCollisionTypes();
    object.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    object.body.setGravityScale(0, true);
    object.collider.setCollisionGroups(COLLISION_GROUP_WORLD_ONLY);
    object.collider.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED);
  }

  throwCarried(cameraForward: THREE.Vector3, eventBus: EventBus): void {
    if (!this.carriedObject) return;
    const object = this.carriedObject;
    this.releaseCarryBody();
    object.body.enableCcd(true);
    const forward = cameraForward.clone().normalize();

    // Offset launch position forward to clear player capsule and prevent self-collision
    const bodyPos = object.body.translation();
    const clearance = 0.35; // slightly larger than capsule radius (0.3)
    object.body.setTranslation(
      _setRV(_rv3A, bodyPos.x + forward.x * clearance, bodyPos.y + forward.y * clearance, bodyPos.z + forward.z * clearance),
      true,
    );

    // Treat throwForce as a *target throw speed* (m/s) rather than a raw impulse.
    const targetSpeed = Math.max(1.0, Math.min(object.throwForce * 2, 20));
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

  /** Update carry position to a specific world-space target (e.g., hand bone). */
  updateCarryTarget(target: THREE.Vector3): void {
    if (!this.carriedObject) return;
    // Use setNextKinematicTranslation so Rapier computes derived velocity
    // for proper collision response (not teleport via setTranslation).
    this.carriedObject.body.setNextKinematicTranslation(
      _setRV(_rv3A, target.x, target.y, target.z),
    );
  }

  updateCarry(playerPosition: THREE.Vector3, _capsuleHalfHeight: number): void {
    if (!this.carriedObject) return;
    // Hold object at chest height (body center - small offset) not above head
    _carryTarget.set(playerPosition.x, playerPosition.y - 0.05, playerPosition.z);
    // Use only setNextKinematicTranslation so Rapier computes the correct
    // derived velocity for collision response. Mesh interpolation captures
    // the position after world.step() via postPhysicsUpdate().
    this.carriedObject.body.setNextKinematicTranslation(_setRV(_rv3A, _carryTarget.x, _carryTarget.y, _carryTarget.z));
  }

  /** Force-release any grab or carry state (used on respawn). */
  forceRelease(): void {
    if (this.grabbedBody) {
      const body = this.grabbedBody;
      const collider = body.collider(0);
      if (collider) {
        if (this.grabbedCollisionGroups != null) collider.setCollisionGroups(this.grabbedCollisionGroups);
        if (this.grabbedActiveCollisionTypes != null) collider.setActiveCollisionTypes(this.grabbedActiveCollisionTypes);
      }
      body.setBodyType(this.grabbedBodyType ?? RAPIER.RigidBodyType.Dynamic, true);
      body.setGravityScale(this.grabbedGravityScale ?? 1, true);
      this.grabbedBody = null;
      this.grabbedBodyType = null;
      this.grabbedGravityScale = null;
      this.grabbedCollisionGroups = null;
      this.grabbedActiveCollisionTypes = null;
      this.grabFaceNormal = null;
      this.grabWeightMult = 1.0;
    }
    if (this.carriedObject) {
      this.releaseCarryBody();
    }
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
    if (this.carriedActiveCollisionTypes != null) {
      object.collider.setActiveCollisionTypes(this.carriedActiveCollisionTypes);
    }
    this.carriedObject = null;
    this.carriedBodyType = null;
    this.carriedGravityScale = null;
    this.carriedCollisionGroups = null;
    this.carriedActiveCollisionTypes = null;
  }
}
