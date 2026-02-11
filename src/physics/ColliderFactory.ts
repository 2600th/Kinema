import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  COLLISION_GROUP_WORLD,
  COLLISION_GROUP_PLAYER,
  COLLISION_GROUP_PLAYER_SENSOR,
} from '@core/constants';
import type { PhysicsWorld } from './PhysicsWorld';

/**
 * Converts THREE.Mesh geometry into Rapier colliders.
 * Bakes world transform into vertices for trimesh colliders.
 */
export class ColliderFactory {
  constructor(private physicsWorld: PhysicsWorld) {}

  /** Create a static trimesh collider from a mesh, baking its world transform. */
  createTrimesh(mesh: THREE.Mesh): RAPIER.Collider {
    mesh.updateWorldMatrix(true, false);

    const geometry = mesh.geometry;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.getIndex();

    // Bake world transform into vertices
    const vertices = new Float32Array(posAttr.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i);
      v.applyMatrix4(mesh.matrixWorld);
      vertices[i * 3] = v.x;
      vertices[i * 3 + 1] = v.y;
      vertices[i * 3 + 2] = v.z;
    }

    let indices: Uint32Array;
    if (index) {
      indices = new Uint32Array(index.array);
    } else {
      // Non-indexed geometry: generate sequential indices
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) {
        indices[i] = i;
      }
    }

    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.7)
      .setCollisionGroups(COLLISION_GROUP_WORLD);


    return this.physicsWorld.world.createCollider(colliderDesc);
  }

  /** Create a sensor collider (trigger) from a mesh shape as a cuboid approximation. */
  createSensor(mesh: THREE.Mesh): RAPIER.Collider {
    mesh.updateWorldMatrix(true, false);

    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setSensor(true);

    return this.physicsWorld.world.createCollider(colliderDesc, body);
  }

  /** Create a capsule rigid body (dynamic). */
  createCapsuleBody(
    position: THREE.Vector3,
    halfHeight: number,
    radius: number,
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z);
    const body = this.physicsWorld.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setFriction(0.0)
      .setCollisionGroups(COLLISION_GROUP_PLAYER);
    const collider = this.physicsWorld.world.createCollider(colliderDesc, body);

    return { body, collider };
  }

  /** Create a cylinder sensor attached to a body. */
  createCylinderSensor(
    body: RAPIER.RigidBody,
    halfHeight: number,
    radius: number,
  ): RAPIER.Collider {
    const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_PLAYER_SENSOR);
    return this.physicsWorld.world.createCollider(colliderDesc, body);
  }
}
