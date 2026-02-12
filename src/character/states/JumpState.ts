import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class JumpState extends State {
  readonly id: StateId = 'jump';

  enter(): void {
    // Jump impulse is applied by PlayerController before entering this state.
  }

  exit(): void {
    // Cleanup
  }

  handleInput(_input: InputState, _isGrounded: boolean): StateId | null {
    // Immediately transition to air state
    return 'air';
  }

  update(_dt: number): void {
    // No-op — we transition out immediately
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    // Allow directional input during jump frame
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
