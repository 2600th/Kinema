import { type InputState, STATE } from "@core/types";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { CharacterMode, PlayerContext } from "./CharacterMode";

const _ladderProbePoint = new THREE.Vector3();
const _rv3A = new RAPIER.Vector3(0, 0, 0);

function _setRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x;
  v.y = y;
  v.z = z;
  return v;
}

/**
 * Ladder locomotion mode — vertical climbing with zero gravity,
 * jump dismount, and ladder zone detection.
 */
export class LadderMode implements CharacterMode {
  readonly id = "ladder";

  enter(ctx: PlayerContext): void {
    ctx.fsm.requestState(STATE.climb);
    ctx.onLadder = true;
    // Uncrouch on ladder
    ctx.isCrouched = false;
    ctx.crouchReleaseGraceRemaining = 0;
    ctx.floatingDistance = ctx.config.capsuleRadius + ctx.config.floatHeight;
    // Consider grounded for FSM purposes while on ladder
    const wasGrounded = ctx.isGrounded;
    ctx.isGrounded = true;
    ctx.canJump = true;
    ctx.remainingAirJumps = ctx.config.maxAirJumps;
    if (ctx.isGrounded !== wasGrounded) {
      ctx.eventBus.emit("player:grounded", ctx.isGrounded);
    }
  }

  exit(ctx: PlayerContext): void {
    ctx.fsm.requestState(STATE.idle);
    ctx.onLadder = false;
    // Restore gravity when leaving ladder
    if (ctx.motor.gravityScale === 0) {
      ctx.motor.setGravityScale(ctx.body, 1);
    }
  }

  fixedUpdate(ctx: PlayerContext, input: InputState, dt: number): string | null {
    // Check if still inside a ladder zone
    const inLadderZone = this.isInsideLadder(ctx);
    if (!inLadderZone) {
      ctx.onLadder = false;
      return "grounded";
    }

    // FSM update for animation state
    ctx.fsm.handleInput(input, true);
    ctx.fsm.update(dt);

    // Ladder climbing movement
    this.handleLadderMovement(ctx, input);

    return null;
  }

  // ---------------------------------------------------------------------------
  //  Ladder zone detection
  // ---------------------------------------------------------------------------

  private isInsideLadder(ctx: PlayerContext): boolean {
    _ladderProbePoint.copy(ctx.currentPos);
    _ladderProbePoint.y -= ctx.currentCapsuleHalfHeight * 0.35;
    for (const zone of ctx.ladderZones) {
      if (zone.containsPoint(_ladderProbePoint)) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  //  Ladder movement
  // ---------------------------------------------------------------------------

  private handleLadderMovement(ctx: PlayerContext, input: InputState): void {
    const climbDir = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const climbSpeed = input.sprint ? 3.6 : 2.6;
    const lv = ctx.body.linvel();
    ctx.motor.setGravityScale(ctx.body, 0);
    ctx.body.setLinvel(_setRV(_rv3A, lv.x * 0.2, climbDir * climbSpeed, lv.z * 0.2), true);

    // Jump dismount
    if (input.jumpPressed) {
      ctx.onLadder = false;
      ctx.motor.setGravityScale(ctx.body, 1);
      ctx.jumpBufferRemaining = 0;
      ctx.remainingAirJumps = ctx.config.maxAirJumps;
      ctx.body.setLinvel(_setRV(_rv3A, lv.x * 0.6, Math.max(ctx.config.jumpForce * 0.9, 3.2), lv.z * 0.6), true);
    }
  }
}
