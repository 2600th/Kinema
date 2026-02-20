import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { PlayerController } from '@character/PlayerController';
import type { IInteractable, InteractionAccess } from '../Interactable';

export class GrabbableObject implements IInteractable {
  readonly id: string;
  readonly label = 'Grab';
  readonly position = new THREE.Vector3();

  constructor(
    id: string,
    private body: RAPIER.RigidBody,
    public readonly collider: RAPIER.Collider,
    private eventBus: EventBus,
    private mesh?: THREE.Object3D,
  ) {
    this.id = id;
    this.syncPosition();
  }

  update(_dt: number): void {
    this.syncPosition();
  }

  onFocus(): void {
    this.setHighlighted(true);
  }

  onBlur(): void {
    this.setHighlighted(false);
  }

  canInteract(player: PlayerController): InteractionAccess {
    return player.isGrounded ? { allowed: true } : { allowed: false, reason: 'Must be grounded' };
  }

  interact(player: PlayerController): void {
    const bodyPos = this.body.translation();
    const offset = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z).sub(player.position);
    this.eventBus.emit('interaction:grabStart', { body: this.body, offset });
  }

  dispose(): void {
    // No-op: ownership managed by level
  }

  private readonly originalMaterials = new WeakMap<THREE.Material, { emissive?: number; emissiveIntensity?: number }>();

  private setHighlighted(enabled: boolean): void {
    if (!this.mesh) return;
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
          (std.emissive as THREE.Color).setHex(0x4fc3f7);
          std.emissiveIntensity = 0.45;
        } else {
          const original = this.originalMaterials.get(mat);
          if (original?.emissive != null) {
            (std.emissive as THREE.Color).setHex(original.emissive);
          } else {
            (std.emissive as THREE.Color).setHex(0x000000);
          }
          std.emissiveIntensity = original?.emissiveIntensity ?? 0;
        }
      }
    });
  }

  private syncPosition(): void {
    const p = this.body.translation();
    this.position.set(p.x, p.y, p.z);
  }
}
