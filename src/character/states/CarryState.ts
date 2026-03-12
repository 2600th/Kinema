import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class CarryState extends State {
  readonly id: StateId = 'carry';

  enter(): void {
    // Carry initialization handled by PlayerController.startCarry.
  }

  exit(): void {
    // Carry cleanup handled by PlayerController throw/drop helpers.
  }

  handleInput(input: InputState, _isGrounded: boolean): StateId | null {
    // Actual carry/throw logic is handled by PlayerController.fixedUpdate;
    // these transitions ensure the FSM stays in sync as a fallback.
    if (input.interactPressed) {
      return 'idle';
    }
    if (input.primaryPressed) {
      return 'idle';
    }
    return null;
  }

  update(dt: number): void {
    if (this.player.lastInputSnapshot) {
      const dir = this.player.computeMovementDirection(this.player.lastInputSnapshot);
      this.player.rotateToward(dir, dt);
    }
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed * this.player.config.crouchSpeedMultiplier;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
