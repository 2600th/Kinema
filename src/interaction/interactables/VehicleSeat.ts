import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@core/EventBus';
import type { PlayerController } from '@character/PlayerController';
import type { IInteractable } from '../Interactable';
import type { VehicleController } from '@vehicle/VehicleController';

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

  interact(_player: PlayerController): void {
    this.eventBus.emit('vehicle:enter', { vehicle: this.vehicle });
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

  private readonly originalMaterials = new WeakMap<THREE.Material, { emissive?: number; emissiveIntensity?: number }>();

  private setHighlighted(enabled: boolean): void {
    const root = this.vehicle.mesh;
    root.traverse((node) => {
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
          (std.emissive as THREE.Color).setHex(0x66ffcc);
          std.emissiveIntensity = 0.28;
        } else {
          const original = this.originalMaterials.get(mat);
          (std.emissive as THREE.Color).setHex(original?.emissive ?? 0x000000);
          std.emissiveIntensity = original?.emissiveIntensity ?? 0;
        }
      }
    });
  }

  private syncPosition(): void {
    // Rotate offset by the vehicle's current orientation so the prompt
    // stays on the correct side after the vehicle turns.
    _rotatedOffset.copy(this.offset).applyQuaternion(this.vehicle.mesh.quaternion);
    this.position.copy(this.vehicle.mesh.position).add(_rotatedOffset);
  }
}
