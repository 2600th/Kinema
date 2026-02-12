import * as THREE from 'three';
import type { InputState, StateId } from '@core/types';
import { State } from './State';

const _result = new THREE.Vector3();

export class IdleState extends State {
  readonly id: StateId = 'idle';

  enter(): void {
    // Could trigger idle animation here
  }

  exit(): void {
    // Cleanup
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return 'air';
    if (input.crouch) return 'crouch';
    if (input.interactPressed) return 'interact';
    if (input.jumpPressed) return 'jump';
    if (input.forward || input.backward || input.left || input.right) return 'move';
    return null;
  }

  update(_dt: number): void {
    // No-op
  }

  getDesiredMovement(_dt: number, _input: InputState): THREE.Vector3 {
    return _result.set(0, 0, 0);
  }
}
