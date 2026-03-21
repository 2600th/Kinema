import * as THREE from 'three';
import { STATE, type InputState, type StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class AirState extends State {
  readonly id: StateId = STATE.air;

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

    // Route to land state on high-impact landings
    const impactSpeed = Math.abs(this.player.prevVerticalVelocity);
    if (impactSpeed > 2.0) return STATE.land;

    // Low-impact: skip land animation for snappy feel
    if (input.crouch) return STATE.crouch;
    const hasMovement = input.forward || input.backward || input.left || input.right;
    if (hasMovement) return STATE.move;
    return STATE.idle;
  }

  update(_dt: number): void {
    // Rotation is handled centrally in PlayerController.fixedUpdate.
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    // Reduced air control
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed * this.player.config.airControlFactor;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
