import { type InputState, STATE, type StateId } from "@core/types";
import * as THREE from "three";
import { State } from "./State";

const _result = new THREE.Vector3();

export class IdleState extends State {
  readonly id: StateId = STATE.idle;

  enter(): void {
    // Could trigger idle animation here
  }

  exit(): void {
    // Cleanup
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return STATE.air;
    if (input.crouch) return STATE.crouch;
    if (input.interactPressed) return STATE.interact;
    if (input.jumpPressed) return STATE.jump;
    if (input.forward || input.backward || input.left || input.right) return STATE.move;
    return null;
  }

  update(_dt: number): void {
    // No-op
  }

  getDesiredMovement(_dt: number, _input: InputState): THREE.Vector3 {
    return _result.set(0, 0, 0);
  }
}
