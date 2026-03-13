import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COLLISION_GROUP_INTERACTABLE, COLLISION_GROUP_WORLD } from '@core/constants';
import type { IInteractable, InteractionAccess, InteractionSpec } from '../Interactable';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { PlayerController } from '@character/PlayerController';

const _doorRV3 = new RAPIER.Vector3(0, 0, 0);
const _doorRQuat = new RAPIER.Quaternion(0, 0, 0, 1);

interface DoorOptions {
  interactionMode?: 'press' | 'hold';
  holdDuration?: number;
  unlockCondition?: () => boolean;
  lockedReason?: string;
}

/**
 * Sample interactable: a door that toggles open/closed.
 */
export class Door implements IInteractable {
  readonly id: string;
  get label(): string { return this.isOpen ? 'Close Door' : 'Open Door'; }
  readonly position: THREE.Vector3;
  readonly collider: RAPIER.Collider;

  private mesh: THREE.Mesh;
  private pivot: THREE.Object3D;
  private scene: THREE.Scene;
  private sensorBody: RAPIER.RigidBody;
  private doorBody: RAPIER.RigidBody;
  private doorCollider: RAPIER.Collider;
  private physicsWorld: PhysicsWorld;
  private isOpen = false;
  private readonly closedRotation = 0;
  private readonly openRotationMagnitude = Math.PI / 2;
  private currentRotation = 0;
  private targetRotation = 0;
  private readonly rotationLerp = 10;
  private originalMaterial: THREE.Material;
  private highlightMaterial: THREE.MeshStandardMaterial;
  private worldPos = new THREE.Vector3();
  private worldQuat = new THREE.Quaternion();
  private playerLocal = new THREE.Vector3();
  private interactionMode: 'press' | 'hold';
  private holdDuration: number;
  private unlockCondition?: () => boolean;
  private lockedReason: string;

  constructor(
    id: string,
    position: THREE.Vector3,
    scene: THREE.Scene,
    physicsWorld: PhysicsWorld,
    options?: DoorOptions,
  ) {
    this.id = id;
    this.position = position.clone().add(new THREE.Vector3(0, 1.25, 0));
    this.interactionMode = options?.interactionMode ?? 'press';
    this.holdDuration = Math.max(options?.holdDuration ?? 0.85, 0.05);
    this.unlockCondition = options?.unlockCondition;
    this.lockedReason = options?.lockedReason ?? 'The door is locked';

    // Create door mesh
    const geom = new THREE.BoxGeometry(1.5, 2.5, 0.15);
    this.originalMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    this.highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xdaa520,
      emissive: 0x332200,
    });
    this.pivot = new THREE.Object3D();
    this.pivot.position.set(position.x - 0.75, position.y, position.z); // hinge axis
    this.scene = scene;
    scene.add(this.pivot);

    this.mesh = new THREE.Mesh(geom, this.originalMaterial);
    this.mesh.position.set(0.75, 1.25, 0); // offset from hinge pivot
    this.mesh.name = `Door_${id}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.pivot.add(this.mesh);

    // Create sensor collider for proximity detection
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y + 1.25, position.z);
    this.sensorBody = physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(1.0, 1.5, 0.5)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_INTERACTABLE);
    this.collider = physicsWorld.world.createCollider(colliderDesc, this.sensorBody);

    // Solid kinematic panel collider so player cannot walk through closed door.
    const doorBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y + 1.25, position.z);
    this.doorBody = physicsWorld.world.createRigidBody(doorBodyDesc);
    const doorColliderDesc = RAPIER.ColliderDesc.cuboid(0.75, 1.25, 0.08)
      .setCollisionGroups(COLLISION_GROUP_WORLD)
      .setFriction(0.8);
    this.doorCollider = physicsWorld.world.createCollider(doorColliderDesc, this.doorBody);
    this.physicsWorld = physicsWorld;
  }

  getInteractionSpec(): InteractionSpec {
    if (this.interactionMode === 'hold') {
      return { mode: 'hold', holdDuration: this.holdDuration };
    }
    return { mode: 'press' };
  }

  canInteract(_player: PlayerController): InteractionAccess {
    if (this.unlockCondition && !this.unlockCondition()) {
      return {
        allowed: false,
        reason: this.lockedReason,
      };
    }
    return { allowed: true };
  }

  getIgnoredColliderHandles(): number[] {
    return [this.collider.handle, this.doorCollider.handle];
  }

  update(dt: number): void {
    const t = 1 - Math.exp(-this.rotationLerp * dt);
    this.currentRotation += (this.targetRotation - this.currentRotation) * t;
    this.pivot.rotation.y = this.currentRotation;

    // Keep physics collider aligned with animated door mesh.
    this.mesh.updateWorldMatrix(true, false);
    this.mesh.getWorldPosition(this.worldPos);
    this.mesh.getWorldQuaternion(this.worldQuat);
    _doorRV3.x = this.worldPos.x; _doorRV3.y = this.worldPos.y; _doorRV3.z = this.worldPos.z;
    this.doorBody.setNextKinematicTranslation(_doorRV3);
    _doorRQuat.x = this.worldQuat.x; _doorRQuat.y = this.worldQuat.y; _doorRQuat.z = this.worldQuat.z; _doorRQuat.w = this.worldQuat.w;
    this.doorBody.setNextKinematicRotation(_doorRQuat);
  }

  onFocus(): void {
    this.mesh.material = this.highlightMaterial;
  }

  onBlur(): void {
    this.mesh.material = this.originalMaterial;
  }

  interact(player: PlayerController): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.playerLocal.copy(player.position);
      this.pivot.worldToLocal(this.playerLocal);
      // Open away from player side: +Z side opens toward -Z and vice versa.
      const swingDir = this.playerLocal.z >= 0 ? 1 : -1;
      this.targetRotation = this.openRotationMagnitude * swingDir;
    } else {
      this.targetRotation = this.closedRotation;
    }
  }

  dispose(): void {
    this.scene.remove(this.pivot);
    this.mesh.geometry.dispose();
    this.originalMaterial.dispose();
    this.highlightMaterial.dispose();
    this.physicsWorld.removeCollider(this.doorCollider);
    this.physicsWorld.removeCollider(this.collider);
    this.physicsWorld.removeBody(this.sensorBody);
    this.physicsWorld.removeBody(this.doorBody);
  }
}
