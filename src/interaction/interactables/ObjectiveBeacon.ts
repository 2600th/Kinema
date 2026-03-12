import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COLLISION_GROUP_INTERACTABLE } from '@core/constants';
import type { IInteractable, InteractionSpec } from '../Interactable';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { PlayerController } from '@character/PlayerController';

/**
 * Simple objective interactable kept independent from door logic.
 */
export class ObjectiveBeacon implements IInteractable {
  readonly id: string;
  readonly label = 'Activate Beacon';
  readonly position: THREE.Vector3;
  readonly collider: RAPIER.Collider;

  private readonly scene: THREE.Scene;
  private readonly root: THREE.Group;
  private readonly sensorBody: RAPIER.RigidBody;
  private readonly physicsWorld: PhysicsWorld;
  private readonly beaconMaterial: THREE.MeshStandardMaterial;
  private activated = false;

  constructor(id: string, position: THREE.Vector3, scene: THREE.Scene, physicsWorld: PhysicsWorld) {
    this.id = id;
    this.position = position.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.scene = scene;
    this.physicsWorld = physicsWorld;

    this.root = new THREE.Group();
    this.root.position.copy(position);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 0.8, 16),
      new THREE.MeshStandardMaterial({ color: 0x5e6779, roughness: 0.8 }),
    );
    pedestal.position.y = 0.4;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.root.add(pedestal);

    this.beaconMaterial = new THREE.MeshStandardMaterial({
      color: 0x9be8ff,
      emissive: 0x123247,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.05,
    });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), this.beaconMaterial);
    beacon.position.y = 1.05;
    beacon.castShadow = true;
    beacon.receiveShadow = true;
    this.root.add(beacon);

    this.scene.add(this.root);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y + 1.0, position.z);
    this.sensorBody = physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.8, 1.0, 0.8)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_INTERACTABLE);
    this.collider = physicsWorld.world.createCollider(colliderDesc, this.sensorBody);
  }

  getInteractionSpec(): InteractionSpec {
    return { mode: 'press' };
  }

  update(_dt: number): void {
    // Static object.
  }

  onFocus(): void {
    if (this.activated) return;
    this.beaconMaterial.emissiveIntensity = 0.45;
  }

  onBlur(): void {
    this.beaconMaterial.emissiveIntensity = this.activated ? 0.9 : 0.25;
  }

  interact(_player: PlayerController): void {
    if (this.activated) return;
    this.activated = true;
    this.beaconMaterial.color.setHex(0x8cff9b);
    this.beaconMaterial.emissive.setHex(0x2c6f2f);
    this.beaconMaterial.emissiveIntensity = 0.9;
    console.log(`[ObjectiveBeacon] ${this.id} activated`);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          for (const material of child.material) {
            material.dispose();
          }
        } else {
          child.material.dispose();
        }
      }
    });
    this.physicsWorld.removeBody(this.sensorBody);
  }
}
