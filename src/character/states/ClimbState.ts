import { type InputState, STATE, type StateId } from "@core/types";
import * as THREE from "three";
import { State } from "./State";

const _movement = new THREE.Vector3();

export class ClimbState extends State {
  readonly id: StateId = STATE.climb;

  enter(): void {}
  exit(): void {}

  handleInput(_input: InputState, _isGrounded: boolean): StateId | null {
    // LadderMode manages climb/idle transitions directly via requestState
    return null;
  }

  update(_dt: number): void {}

  getDesiredMovement(_dt: number, _input: InputState): THREE.Vector3 {
    return _movement.set(0, 0, 0);
  }
}
