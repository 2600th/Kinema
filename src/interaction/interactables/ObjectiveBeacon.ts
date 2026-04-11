import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COLLISION_GROUP_INTERACTABLE } from '@core/constants';
import type { IInteractable, InteractionAccess, InteractionSpec } from '../Interactable';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { PlayerController } from '@character/PlayerController';

const IDLE_COLOR = new THREE.Color(0x9be8ff);
const CHARGING_COLOR = new THREE.Color(0xbeffcc);
const ACTIVE_COLOR = new THREE.Color(0x8cff9b);
const IDLE_EMISSIVE = new THREE.Color(0x123247);
const CHARGING_EMISSIVE = new THREE.Color(0x52c18f);
const ACTIVE_EMISSIVE = new THREE.Color(0x2c6f2f);

/**
 * Objective beacon with a longer hold-to-activate charge-up.
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
  private readonly haloMaterial: THREE.MeshBasicMaterial;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly beaconMesh: THREE.Mesh;
  private readonly haloMesh: THREE.Mesh;
  private readonly ringMesh: THREE.Mesh;
  private readonly beaconLight: THREE.PointLight;
  private activated = false;
  private focused = false;
  private holdProgress = 0;
  private targetHoldProgress = 0;
  private time = Math.random() * Math.PI * 2;

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

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x9ef7cf,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.05, 12, 48), this.ringMaterial);
    this.ringMesh.position.y = 1.05;
    this.ringMesh.rotation.x = Math.PI / 2;
    this.root.add(this.ringMesh);

    this.haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xa5ffe8,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.haloMesh = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 16), this.haloMaterial);
    this.haloMesh.position.y = 1.05;
    this.root.add(this.haloMesh);

    this.beaconMaterial = new THREE.MeshStandardMaterial({
      color: IDLE_COLOR.clone(),
      emissive: IDLE_EMISSIVE.clone(),
      emissiveIntensity: 0.25,
      roughness: 0.28,
      metalness: 0.05,
    });
    this.beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), this.beaconMaterial);
    this.beaconMesh.position.y = 1.05;
    this.beaconMesh.castShadow = true;
    this.beaconMesh.receiveShadow = true;
    this.root.add(this.beaconMesh);

    this.beaconLight = new THREE.PointLight(0x92ffe1, 0.4, 4.5, 2);
    this.beaconLight.position.set(0, 1.1, 0);
    this.root.add(this.beaconLight);

    this.scene.add(this.root);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y + 1.0, position.z);
    this.sensorBody = physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.8, 1.0, 0.8)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_INTERACTABLE);
    this.collider = physicsWorld.world.createCollider(colliderDesc, this.sensorBody);
  }

  getInteractionSpec(): InteractionSpec {
    return { mode: 'hold', holdDuration: 3 };
  }

  update(dt: number): void {
    this.time += dt;
    const target = this.activated ? 1 : this.targetHoldProgress;
    this.holdProgress = THREE.MathUtils.damp(this.holdProgress, target, this.activated ? 8 : 11, dt);

    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.6 + this.holdProgress * 6.4);
    const focusBoost = this.focused ? 0.1 : 0;
    const charge = this.activated ? 1 : this.holdProgress;

    if (this.activated) {
      this.beaconMaterial.color.copy(ACTIVE_COLOR);
      this.beaconMaterial.emissive.copy(ACTIVE_EMISSIVE);
    } else {
      this.beaconMaterial.color.copy(IDLE_COLOR).lerp(CHARGING_COLOR, Math.min(1, charge * 0.92));
      this.beaconMaterial.emissive.copy(IDLE_EMISSIVE).lerp(CHARGING_EMISSIVE, Math.min(1, charge));
    }

    this.beaconMaterial.emissiveIntensity = this.activated
      ? 1.28 + pulse * 0.14
      : 0.24 + focusBoost + charge * 1.05 + pulse * (0.04 + charge * 0.16);

    const coreScale = 1 + charge * 0.12 + pulse * (0.018 + charge * 0.014);
    this.beaconMesh.scale.setScalar(coreScale);

    this.haloMaterial.opacity = this.activated
      ? 0.5 + pulse * 0.08
      : 0.08 + focusBoost * 0.12 + charge * 0.42;
    this.haloMesh.scale.setScalar(1.02 + charge * 0.5 + pulse * 0.04);

    this.ringMaterial.opacity = this.activated
      ? 0.72
      : 0.11 + focusBoost * 0.06 + charge * 0.56;
    this.ringMesh.rotation.z += dt * (0.8 + charge * 2.4);
    this.ringMesh.scale.setScalar(0.92 + charge * 0.38 + pulse * 0.025);

    this.beaconLight.intensity = this.activated
      ? 3.1 + pulse * 0.35
      : 0.4 + focusBoost * 0.6 + charge * 2.4;
    this.beaconLight.distance = 4.5 + charge * 3.8 + (this.activated ? 1.6 : 0);
  }

  onFocus(): void {
    if (this.activated) return;
    this.focused = true;
  }

  onBlur(): void {
    this.focused = false;
    if (!this.activated) {
      this.targetHoldProgress = 0;
    }
  }

  canInteract(player: PlayerController): InteractionAccess {
    if (this.activated) {
      return { allowed: false, reason: 'Beacon online' };
    }
    return player.isGrounded ? { allowed: true } : { allowed: false, reason: 'Must be grounded' };
  }

  setHoldProgress(progress: number | null): void {
    if (this.activated) return;
    this.targetHoldProgress = progress === null ? 0 : THREE.MathUtils.clamp(progress, 0, 1);
  }

  interact(_player: PlayerController): void {
    if (this.activated) return;
    this.activated = true;
    this.focused = false;
    this.targetHoldProgress = 1;
    this.holdProgress = 1;
    this.beaconMaterial.color.copy(ACTIVE_COLOR);
    this.beaconMaterial.emissive.copy(ACTIVE_EMISSIVE);
    this.beaconMaterial.emissiveIntensity = 1.35;
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
