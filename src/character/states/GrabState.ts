import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class GrabState extends State {
  readonly id: StateId = 'grab';
  private groundedGrace = 0;
  private static readonly GROUNDED_GRACE_TIME = 0.12;

  enter(): void {
    this.groundedGrace = GrabState.GROUNDED_GRACE_TIME;
    // Grab initialization is handled by PlayerController.startGrab.
  }

  exit(): void {
    this.player.endGrab();
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (input.interactPressed || input.jumpPressed) return 'idle';
    if (isGrounded) {
      this.groundedGrace = GrabState.GROUNDED_GRACE_TIME;
    } else {
      if (this.groundedGrace <= 0) return 'air';
    }
    return null;
  }

  update(dt: number): void {
    // Decrement grounded grace timer so tiny bumps don't drop the grab.
    if (this.groundedGrace > 0) {
      this.groundedGrace = Math.max(0, this.groundedGrace - dt);
    }
    // Rotation is handled centrally in PlayerController.fixedUpdate.
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed * this.player.config.crouchSpeedMultiplier;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
