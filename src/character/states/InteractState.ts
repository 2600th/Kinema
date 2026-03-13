import * as THREE from 'three';
import { STATE, type InputState, type StateId } from '@core/types';
import { State } from './State';

const _result = new THREE.Vector3();

const INTERACT_DURATION = 0.3; // seconds

export class InteractState extends State {
  readonly id: StateId = STATE.interact;
  private timer = 0;

  enter(): void {
    this.timer = 0;
    // Fire interaction event — InteractionManager will handle the actual interaction
  }

  exit(): void {
    this.timer = 0;
  }

  handleInput(_input: InputState, _isGrounded: boolean): StateId | null {
    if (this.timer >= INTERACT_DURATION) {
      return STATE.idle;
    }
    return null;
  }

  update(dt: number): void {
    this.timer += dt;
  }

  getDesiredMovement(_dt: number, _input: InputState): THREE.Vector3 {
    // Locked in place during interaction
    return _result.set(0, 0, 0);
  }
}
