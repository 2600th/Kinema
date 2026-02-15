import RAPIER from '@dimforge/rapier3d-compat';
import type { Disposable } from '@core/types';

/**
 * Wraps Rapier world.
 * Uses static factory — RAPIER.init() must be called before construction.
 */
export class PhysicsWorld implements Disposable {
  public readonly world: RAPIER.World;
  public readonly eventQueue: RAPIER.EventQueue;
  private lastStepMs = 0;

  private constructor() {
    // Use Rapier default world gravity.
    this.world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /** Synchronous factory — call only after RAPIER.init() has resolved. */
  static create(): PhysicsWorld {
    return new PhysicsWorld();
  }

  /** Step the simulation forward. */
  step(): void {
    const start = performance.now();
    this.world.step(this.eventQueue);
    this.lastStepMs = performance.now() - start;
  }

  getLastStepMs(): number {
    return this.lastStepMs;
  }

  /** Shapecast from origin in direction. Returns hit info or null. */
  castShape(
    origin: RAPIER.Vector3,
    rotation: RAPIER.Quaternion,
    direction: RAPIER.Vector3,
    shape: RAPIER.Shape,
    targetDistance: number,
    maxToi: number,
    excludeCollider?: RAPIER.Collider,
    excludeRigidBody?: RAPIER.RigidBody,
    filterGroups?: number,
    filterPredicate?: (collider: RAPIER.Collider) => boolean,
  ): RAPIER.ColliderShapeCastHit | null {
    return this.world.castShape(
      origin,
      rotation,
      direction,       // shapeVel
      shape,
      targetDistance,
      maxToi,
      true,            // stopAtPenetration
      undefined,       // filterFlags
      filterGroups,    // filterGroups
      excludeCollider, // filterExcludeCollider
      excludeRigidBody, // filterExcludeRigidBody
      filterPredicate,
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
    this.eventQueue.free();
    this.world.free();
  }
}
