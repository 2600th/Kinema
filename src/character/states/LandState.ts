import { type InputState, STATE, type StateId } from "@core/types";
import * as THREE from "three";
import { State } from "./State";

const _movement = new THREE.Vector3();
const LAND_DURATION = 0.4;

export class LandState extends State {
  readonly id: StateId = STATE.land;
  private timer = 0;

  enter(): void {
    this.timer = LAND_DURATION;
  }

  exit(): void {
    this.timer = 0;
  }

  handleInput(input: InputState, isGrounded: boolean): StateId | null {
    if (!isGrounded) return STATE.air;
    if (input.jumpPressed) return STATE.jump;

    // Exit when timer expires OR animation clip finishes (whichever comes first)
    if (this.timer <= 0 || this.player.isAnimationFinished()) {
      const hasMovement = input.forward || input.backward || input.left || input.right;
      return hasMovement ? STATE.move : STATE.idle;
    }

    return null;
  }

  update(dt: number): void {
    this.timer = Math.max(0, this.timer - dt);
  }

  getDesiredMovement(_dt: number, _input: InputState): THREE.Vector3 {
    return _movement.set(0, 0, 0);
  }
}
