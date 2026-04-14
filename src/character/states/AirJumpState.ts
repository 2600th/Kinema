import { type InputState, STATE, type StateId } from "@core/types";
import * as THREE from "three";
import { State } from "./State";

const _movement = new THREE.Vector3();

/** Hold time for the air-jump animation before transitioning to air. */
const AIR_JUMP_HOLD = 0.25;

/**
 * Air-jump state — distinct from ground jump so FSM, audio, and VFX
 * can differentiate. Holds for a brief duration so the jump animation
 * is visible before transitioning to AirState.
 */
export class AirJumpState extends State {
  readonly id: StateId = STATE.airJump;
  private timer = 0;

  enter(): void {
    // Air-jump impulse is applied by PlayerController before entering this state.
    this.timer = AIR_JUMP_HOLD;
  }

  exit(): void {
    this.timer = 0;
  }

  handleInput(_input: InputState, _isGrounded: boolean): StateId | null {
    // Hold for animation duration, then transition to air
    if (this.timer <= 0) return STATE.air;
    return null;
  }

  update(dt: number): void {
    this.timer = Math.max(0, this.timer - dt);
  }

  getDesiredMovement(dt: number, input: InputState): THREE.Vector3 {
    // Allow directional input during jump
    const dir = this.player.computeMovementDirection(input);
    const speed = this.player.config.moveSpeed * this.player.config.airControlFactor;
    _movement.copy(dir).multiplyScalar(speed * dt);
    return _movement;
  }
}
