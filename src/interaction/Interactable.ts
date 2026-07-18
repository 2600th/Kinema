import type { PlayerController } from "@character/PlayerController";
import type RAPIER from "@dimforge/rapier3d-compat";
import type * as THREE from "three";

export type InteractionMode = "press" | "hold";

export interface InteractionSpec {
  mode: InteractionMode;
  holdDuration?: number;
}

export interface InteractionAccess {
  allowed: boolean;
  reason?: string;
}

export const INTERACTION_ALLOWED: InteractionAccess = Object.freeze({ allowed: true });
export const INTERACTION_REQUIRES_GROUNDED: InteractionAccess = Object.freeze({
  allowed: false,
  reason: "Must be grounded",
});

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
  getInteractionSpec?(): InteractionSpec;
  canInteract?(player: PlayerController): InteractionAccess;
  setHoldProgress?(progress: number | null): void;
  getIgnoredColliderHandles?(): number[];
  interact(player: PlayerController): string | undefined;
  dispose(): void;
}
