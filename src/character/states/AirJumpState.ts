import * as THREE from 'three';
import { STATE, type InputState, type StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

/**
 * Single-frame air-jump state — mirrors JumpState but with a distinct ID
 * so the FSM, audio, and VFX systems can differentiate ground vs. air jumps.
 * Immediately transitions to AirState on the next handleInput call.
 */
export class AirJumpState extends State {
  readonly id: StateId = STATE.airJump;

  enter(): void {
    // Air-jump impulse is applied by PlayerController before entering this state.
  }

  exit(): void {
    // Cleanup
  }

  handleInput(_input: InputState, _isGrounded: boolean): StateId | null {
    // Immediately transition to air state
    return STATE.air;
  }

  update(_dt: number): void {
    // No-op — we transition out immediately
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    // Allow directional input during jump frame
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed * this.player.config.airControlFactor;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
