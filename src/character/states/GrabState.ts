import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class GrabState extends State {
  readonly id: StateId = 'grab';

  enter(): void {
    // Grab initialization is handled by PlayerController.startGrab.
  }

  exit(): void {
    this.player.endGrab();
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (input.interactPressed || input.jumpPressed) return 'idle';
    if (!isGrounded) return 'air';
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
