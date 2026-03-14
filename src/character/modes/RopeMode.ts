import { type InputState, STATE } from "@core/types";
import type { CharacterMode, PlayerContext } from "./CharacterMode";

/**
 * Rope locomotion mode — manages state while attached to a rope.
 * Clears jump buffer, resets air jumps, and forces air FSM state.
 * Actual rope physics are handled externally; this mode prevents
 * other locomotion from interfering.
 */
export class RopeMode implements CharacterMode {
  readonly id = "rope";

  enter(ctx: PlayerContext): void {
    ctx.jumpBufferRemaining = 0;
    ctx.onLadder = false;
    // Uncrouch
    ctx.isCrouched = false;
    ctx.crouchReleaseGraceRemaining = 0;
    ctx.floatingDistance = ctx.config.capsuleRadius + ctx.config.floatHeight;
    // Reset air jumps so player can jump off rope
    ctx.remainingAirJumps = ctx.config.maxAirJumps;
    // Ensure rope dynamics are not amplified by carry-over fall gravity
    ctx.motor.setGravityScale(ctx.body, 1);
    // Not grounded while on rope
    const wasGrounded = ctx.isGrounded;
    ctx.isGrounded = false;
    ctx.canJump = false;
    ctx.motor.clearGroundedGrace();
    if (wasGrounded) {
      ctx.eventBus.emit("player:grounded", false);
    }
    if (ctx.fsm.current !== STATE.air) {
      ctx.fsm.requestState(STATE.air);
    }
  }

  fixedUpdate(ctx: PlayerContext, _input: InputState, _dt: number): string | null {
    // While attached, keep clearing jump buffer and enforce air state
    ctx.jumpBufferRemaining = 0;
    if (ctx.fsm.current !== STATE.air) {
      ctx.fsm.requestState(STATE.air);
    }

    // Transition out when rope detaches
    if (!ctx.ropeAttached) {
      return "air";
    }

    return null;
  }
}
