import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class AirState extends State {
  readonly id: StateId = 'air';

  enter(): void {
    // Could trigger falling animation
  }

  exit(): void {
    // Cleanup
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) {
      return null;
    }

    // Landed
    if (input.crouch) return 'crouch';
    const hasMovement = input.forward || input.backward || input.left || input.right;
    if (hasMovement) return 'move';
    return 'idle';
  }

  update(dt: number): void {
    // Rotate toward movement direction in air (slower)
    if (this.player.lastInputSnapshot) {
      const dir = this.player.computeMovementDirection(this.player.lastInputSnapshot);
      this.player.rotateToward(dir, dt);
    }
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    // Reduced air control
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed * this.player.config.airControlFactor;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
