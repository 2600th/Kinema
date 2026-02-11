import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerController } from '@character/PlayerController';

/**
 * Interface for any object the player can interact with.
 */
export interface IInteractable {
  readonly id: string;
  readonly label: string;
  readonly position: THREE.Vector3;
  readonly collider: RAPIER.Collider;
  update(dt: number): void;
  onFocus(): void;
  onBlur(): void;
  interact(player: PlayerController): void;
  dispose(): void;
}
