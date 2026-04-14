import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { setMeshHighlight } from "../highlightMesh";
import type { IInteractable, InteractionAccess } from "../Interactable";

const _grabOffset = new THREE.Vector3();

export class GrabbableObject implements IInteractable {
  readonly id: string;
  readonly label = "Grab";
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
    return player.isGrounded ? { allowed: true } : { allowed: false, reason: "Must be grounded" };
  }

  interact(player: PlayerController): void {
    const bodyPos = this.body.translation();
    _grabOffset.set(bodyPos.x, bodyPos.y, bodyPos.z).sub(player.position);
    const grabWeight = this.mesh?.userData?.grabWeight as number | undefined;
    this.eventBus.emit("interaction:grabStart", { body: this.body, offset: _grabOffset, grabWeight });
  }

  dispose(): void {
    // No-op: ownership managed by level
  }

  private setHighlighted(enabled: boolean): void {
    if (!this.mesh) return;
    setMeshHighlight(this.mesh, enabled, 0x4fc3f7, 0.45);
  }

  private syncPosition(): void {
    const p = this.body.translation();
    this.position.set(p.x, p.y, p.z);
  }
}
