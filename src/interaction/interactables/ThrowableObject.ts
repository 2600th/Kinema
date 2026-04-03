import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { PlayerController } from '@character/PlayerController';
import type { IInteractable, InteractionAccess } from '../Interactable';
import { setMeshHighlight } from '../highlightMesh';

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

  canInteract(player: PlayerController): InteractionAccess {
    return player.isGrounded ? { allowed: true } : { allowed: false, reason: 'Must be grounded' };
  }

  interact(_player: PlayerController): void {
    this.eventBus.emit('interaction:pickUp', { object: this });
  }

  dispose(): void {
    // Ownership handled by game/level managers.
  }

  private setHighlighted(enabled: boolean): void {
    setMeshHighlight(this.mesh, enabled, 0xffb24a, 0.35);
  }

  private syncPositionFromBody(): void {
    const pos = this.body.translation();
    this.position.set(pos.x, pos.y, pos.z);
  }
}
