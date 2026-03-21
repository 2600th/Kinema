import * as THREE from 'three';
import { STATE, type InputState, type StateId } from '@core/types';
import { State } from './State';

const _movement = new THREE.Vector3();

export class ClimbState extends State {
  readonly id: StateId = STATE.climb;

  enter(): void {}
  exit(): void {}

  handleInput(_input: InputState, _isGrounded: boolean): StateId | null {
    // Ladder mode handles transitions externally
    return null;
  }

  update(_dt: number): void {}

  getDesiredMovement(_dt: number, _input: InputState): THREE.Vector3 {
    return _movement.set(0, 0, 0);
  }
}
