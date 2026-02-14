import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { PlayerController } from '@character/PlayerController';
import type { IInteractable } from '../Interactable';

export class ThrowableObject implements IInteractable {
  readonly id: string;
  readonly label = 'Pick Up';
  readonly position = new THREE.Vector3();

  constructor(
    id: string,
    public readonly mesh: THREE.Object3D,
    public readonly body: RAPIER.RigidBody,
    public readonly collider: RAPIER.Collider,
    public readonly throwForce: number,
    private eventBus: EventBus,
  ) {
    this.id = id;
    this.syncFromBody();
  }

  update(_dt: number): void {
    this.syncFromBody();
  }

  onFocus(): void {
    // Optional: highlight mesh
  }

  onBlur(): void {
    // Optional: remove highlight
  }

  interact(_player: PlayerController): void {
    this.eventBus.emit('interaction:pickUp', { object: this });
  }

  dispose(): void {
    // Ownership handled by game/level managers.
  }

  private syncFromBody(): void {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    this.position.set(pos.x, pos.y, pos.z);
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }
}
