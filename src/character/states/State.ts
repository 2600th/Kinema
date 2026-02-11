import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import type { PlayerController } from '../PlayerController';

/**
 * Abstract base for all character states.
 * Each state computes desired movement and handles input-driven transitions.
 */
export abstract class State {
  abstract readonly id: StateId;

  constructor(protected player: PlayerController) {}

  /** Called when entering this state. */
  abstract enter(): void;

  /** Called when leaving this state. */
  abstract exit(): void;

  /**
   * Process input and return the next state ID, or null to stay.
   */
  abstract handleInput(input: InputState, isGrounded: boolean): StateId | null;

  /** Per-tick logic (at fixed rate). */
  abstract update(dt: number): void;

  /**
   * Return the desired horizontal displacement for this tick.
   * Y component can be used for jump impulses.
   */
  abstract getDesiredMovement(dt: number, input: InputState): THREE.Vector3;
}
