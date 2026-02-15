import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { PlayerController } from '@character/PlayerController';
import type { IInteractable } from '../Interactable';

export class ThrowableObject implements IInteractable {
  readonly id: string;
  readonly label = 'Pick Up';
  readonly position = new THREE.Vector3();
  private hasPose = false;
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currQuat = new THREE.Quaternion();

  constructor(
    id: string,
    public readonly mesh: THREE.Object3D,
    public readonly body: RAPIER.RigidBody,
    public readonly collider: RAPIER.Collider,
    public readonly throwForce: number,
    private eventBus: EventBus,
  ) {
    this.id = id;
    this.syncPositionFromBody();
  }

  update(_dt: number): void {
    // Keep interaction position current (UI + range checks). Mesh interpolation is handled in renderUpdate().
    this.syncPositionFromBody();
  }

  postPhysicsUpdate(): void {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    if (!this.hasPose) {
      this.prevPos.set(pos.x, pos.y, pos.z);
      this.currPos.set(pos.x, pos.y, pos.z);
      this.prevQuat.set(rot.x, rot.y, rot.z, rot.w);
      this.currQuat.set(rot.x, rot.y, rot.z, rot.w);
      this.hasPose = true;
      return;
    }
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.currPos.set(pos.x, pos.y, pos.z);
    this.currQuat.set(rot.x, rot.y, rot.z, rot.w);
  }

  renderUpdate(alpha: number): void {
    if (!this.hasPose) return;
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  onFocus(): void {
    this.setHighlighted(true);
  }

  onBlur(): void {
    this.setHighlighted(false);
  }

  interact(_player: PlayerController): void {
    this.eventBus.emit('interaction:pickUp', { object: this });
  }

  dispose(): void {
    // Ownership handled by game/level managers.
  }

  private readonly originalMaterials = new WeakMap<THREE.Material, { emissive?: number; emissiveIntensity?: number }>();

  private setHighlighted(enabled: boolean): void {
    this.mesh.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh) return;
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of materials) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!('emissive' in std)) continue;
        if (!this.originalMaterials.has(mat)) {
          this.originalMaterials.set(mat, {
            emissive: (std.emissive as THREE.Color | undefined)?.getHex?.(),
            emissiveIntensity: (std.emissiveIntensity as number | undefined),
          });
        }
        if (enabled) {
          (std.emissive as THREE.Color).setHex(0xffb24a);
          std.emissiveIntensity = 0.35;
        } else {
          const original = this.originalMaterials.get(mat);
          (std.emissive as THREE.Color).setHex(original?.emissive ?? 0x000000);
          std.emissiveIntensity = original?.emissiveIntensity ?? 0;
        }
      }
    });
  }

  private syncPositionFromBody(): void {
    const pos = this.body.translation();
    this.position.set(pos.x, pos.y, pos.z);
  }
}
