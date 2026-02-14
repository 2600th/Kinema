import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { PlayerController } from '@character/PlayerController';
import type { IInteractable } from '../Interactable';
import type { VehicleController } from '@vehicle/VehicleController';

export class VehicleSeat implements IInteractable {
  readonly id: string;
  readonly label: string;
  readonly position = new THREE.Vector3();

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
    // Optional: highlight vehicle or seat
  }

  onBlur(): void {
    // Optional: remove highlight
  }

  interact(_player: PlayerController): void {
    this.eventBus.emit('vehicle:enter', { vehicle: this.vehicle });
  }

  dispose(): void {
    // Seat collider managed by level/vehicle managers.
  }

  private syncPosition(): void {
    const p = this.vehicle.mesh.position;
    this.position.copy(p).add(this.offset);
  }
}
