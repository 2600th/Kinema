import * as THREE from 'three';
import { STATE, type InputState, type StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class CarryState extends State {
  readonly id: StateId = STATE.carry;

  enter(): void {
    // Carry initialization handled by PlayerController.startCarry.
  }

  exit(): void {
    // Carry cleanup handled by PlayerController throw/drop helpers.
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return STATE.air;
    // Actual carry/throw logic is handled by PlayerController.fixedUpdate;
    // these transitions ensure the FSM stays in sync as a fallback.
    if (input.interactPressed) {
      return STATE.idle;
    }
    if (input.primaryPressed) {
      return STATE.idle;
    }
    return null;
  }

  update(_dt: number): void {
    // Rotation is handled centrally in PlayerController.fixedUpdate.
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed * this.player.config.crouchSpeedMultiplier;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
