import * as THREE from 'three';
import { STATE, type InputState, type StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class CrouchState extends State {
  readonly id: StateId = STATE.crouch;

  enter(): void {
    // Crouch body adjustments are handled in PlayerController.
  }

  exit(): void {
    // No-op
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return STATE.air;
    if (input.interactPressed) return STATE.interact;
    if (input.jumpPressed) return STATE.jump;
    if (input.crouch) return null;
    const hasMovement = input.forward || input.backward || input.left || input.right;
    return hasMovement ? STATE.move : STATE.idle;
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
