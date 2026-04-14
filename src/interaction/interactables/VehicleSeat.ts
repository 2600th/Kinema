import type { PlayerController } from "@character/PlayerController";
import type { EventBus } from "@core/EventBus";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { VehicleController } from "@vehicle/VehicleController";
import * as THREE from "three";
import { setMeshHighlight } from "../highlightMesh";
import type { IInteractable, InteractionAccess } from "../Interactable";

const _rotatedOffset = new THREE.Vector3();

export class VehicleSeat implements IInteractable {
  readonly id: string;
  readonly label: string;
  readonly position = new THREE.Vector3();
  private _cachedHandles: number[] = [];
  private _cachedColliderCount = -1;

  constructor(
    id: string,
    label: string,
    public readonly collider: RAPIER.Collider,
    private vehicle: VehicleController,
    private eventBus: EventBus,
    private offset: THREE.Vector3 = new THREE.Vector3(),
  ) {
    this.id = id;
    this.label = label;
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

  interact(_player: PlayerController): void {
    this.eventBus.emit("vehicle:enter", { vehicle: this.vehicle });
  }

  getIgnoredColliderHandles(): number[] {
    const body = this.vehicle.body;
    const n = body.numColliders();
    if (n !== this._cachedColliderCount) {
      this._cachedColliderCount = n;
      this._cachedHandles.length = 0;
      for (let i = 0; i < n; i++) {
        const c = body.collider(i);
        if (c) this._cachedHandles.push(c.handle);
      }
    }
    return this._cachedHandles;
  }

  dispose(): void {
    // Seat collider managed by level/vehicle managers.
  }

  private setHighlighted(enabled: boolean): void {
    setMeshHighlight(this.vehicle.mesh, enabled, 0x66ffcc, 0.28);
  }

  private syncPosition(): void {
    // Rotate offset by the vehicle's current orientation so the prompt
    // stays on the correct side after the vehicle turns.
    _rotatedOffset.copy(this.offset).applyQuaternion(this.vehicle.mesh.quaternion);
    this.position.copy(this.vehicle.mesh.position).add(_rotatedOffset);
  }
}
