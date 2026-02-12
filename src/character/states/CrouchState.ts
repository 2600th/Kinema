import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class CrouchState extends State {
  readonly id: StateId = 'crouch';

  enter(): void {
    // Crouch body adjustments are handled in PlayerController.
  }

  exit(): void {
    // No-op
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return 'air';
    if (input.interactPressed) return 'interact';
    if (input.jumpPressed) return 'jump';
    if (input.crouch) return null;
    const hasMovement = input.forward || input.backward || input.left || input.right;
    return hasMovement ? 'move' : 'idle';
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
