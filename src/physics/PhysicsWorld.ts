import RAPIER from '@dimforge/rapier3d-compat';
import type { Disposable } from '@core/types';
import {
  CC_OFFSET,
  MAX_SLOPE_CLIMB_ANGLE,
  MIN_SLOPE_SLIDE_ANGLE,
  AUTOSTEP,
  SNAP_TO_GROUND_DIST,
  DEFAULT_PLAYER_CONFIG,
} from '@core/constants';

/**
 * Wraps Rapier world.
 * Uses static factory — RAPIER.init() must be called before construction.
 */
export class PhysicsWorld implements Disposable {
  public readonly world: RAPIER.World;
  public readonly characterController: RAPIER.KinematicCharacterController;
  public readonly eventQueue: RAPIER.EventQueue;

  private constructor() {
    // Use Rapier default world gravity.
    this.world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    this.eventQueue = new RAPIER.EventQueue(true);

    // Create the shared character controller
    this.characterController = this.world.createCharacterController(CC_OFFSET);
    this.characterController.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB_ANGLE);
    this.characterController.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE_ANGLE);
    this.characterController.enableAutostep(
      AUTOSTEP.maxHeight,
      AUTOSTEP.minWidth,
      AUTOSTEP.includeDynamicBodies,
    );
    this.characterController.enableSnapToGround(SNAP_TO_GROUND_DIST);
    this.characterController.setApplyImpulsesToDynamicBodies(true);
    this.characterController.setCharacterMass(DEFAULT_PLAYER_CONFIG.mass);
  }

  /** Synchronous factory — call only after RAPIER.init() has resolved. */
  static create(): PhysicsWorld {
    return new PhysicsWorld();
  }

  /** Step the simulation forward. */
  step(): void {
    this.world.step(this.eventQueue);
  }

  /** Shapecast from origin in direction. Returns hit info or null. */
  castShape(
    origin: RAPIER.Vector3,
    rotation: RAPIER.Quaternion,
    direction: RAPIER.Vector3,
    shape: RAPIER.Shape,
    maxToi: number,
    excludeCollider?: RAPIER.Collider,
    excludeRigidBody?: RAPIER.RigidBody,
  ): RAPIER.ColliderShapeCastHit | null {
    return this.world.castShape(
      origin,
      rotation,
      direction,       // shapeVel
      shape,
      0,               // targetDistance
      maxToi,
      true,            // stopAtPenetration
      undefined,       // filterFlags
      undefined,       // filterGroups
      excludeCollider, // filterExcludeCollider
      excludeRigidBody, // filterExcludeRigidBody
    );
  }

  /** Raycast from a point in a direction. Returns hit or null. */
  castRay(
    origin: RAPIER.Vector3,
    direction: RAPIER.Vector3,
    maxToi: number,
    excludeCollider?: RAPIER.Collider,
    excludeRigidBody?: RAPIER.RigidBody,
    filterPredicate?: (collider: RAPIER.Collider) => boolean,
  ): RAPIER.RayColliderHit | null {
    const ray = new RAPIER.Ray(origin, direction);
    return this.world.castRay(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      excludeCollider,
      excludeRigidBody,
      filterPredicate,
    );
  }

  /** Raycast from a point in a direction. Returns hit with normal or null. */
  castRayAndGetNormal(
    origin: RAPIER.Vector3,
    direction: RAPIER.Vector3,
    maxToi: number,
    excludeCollider?: RAPIER.Collider,
    excludeRigidBody?: RAPIER.RigidBody,
  ): RAPIER.RayColliderIntersection | null {
    const ray = new RAPIER.Ray(origin, direction);
    return this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      excludeCollider,
      excludeRigidBody,
    );
  }

  /** Remove a rigid body and all attached colliders. */
  removeBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
  }

  /** Remove a standalone collider. */
  removeCollider(collider: RAPIER.Collider): void {
    this.world.removeCollider(collider, true);
  }

  dispose(): void {
    this.world.free();
  }
}
