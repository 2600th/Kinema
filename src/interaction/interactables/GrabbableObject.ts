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
    // Optional: highlight mesh
  }

  onBlur(): void {
    // Optional: remove highlight
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

  private syncPosition(): void {
    const p = this.body.translation();
    this.position.set(p.x, p.y, p.z);
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      const rot = this.body.rotation();
      this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  }
}
