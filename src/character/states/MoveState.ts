import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();


export class MoveState extends State {
  readonly id: StateId = 'move';

  enter(): void {
    // Could trigger run animation
  }

  exit(): void {
    // Cleanup
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return 'air';
    if (input.crouch) return 'crouch';
    if (input.interactPressed) return 'interact';
    if (input.jumpPressed) return 'jump';

    const hasMovement = input.forward || input.backward || input.left || input.right;
    if (!hasMovement) return 'idle';

    return null;
  }

  update(_dt: number): void {
    // Rotation is handled centrally in PlayerController.fixedUpdate.
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    const dir = this.player.computeMovementDirection(input);
    const speed = input.sprint
      ? this.player.config.moveSpeed * this.player.config.sprintMultiplier
      : this.player.config.moveSpeed;

    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
