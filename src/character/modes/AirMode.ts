import { type InputState, STATE } from "@core/types";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { shouldApplyGroundReaction } from "../CharacterMotor";
import type { CharacterMode, PlayerContext } from "./CharacterMode";

// Pre-allocated vectors for air movement and jump logic.
const _movingDirection = new THREE.Vector3();
const _jumpVelocityVec = new THREE.Vector3();
const _jumpDirection = new THREE.Vector3();
const _actualSlopeNormal = new THREE.Vector3(0, 1, 0);
const _standingForcePoint = new THREE.Vector3();

const _rv3A = new RAPIER.Vector3(0, 0, 0);
const _rv3B = new RAPIER.Vector3(0, 0, 0);

function _setRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x;
  v.y = y;
  v.z = z;
  return v;
}

/**
 * Air locomotion mode — reduced air control, air jumps, variable jump cut,
 * and gravity scaling.
 */
export class AirMode implements CharacterMode {
  readonly id = "air";

  fixedUpdate(ctx: PlayerContext, input: InputState, dt: number): string | null {
    ctx.floatingDistance = ctx.config.capsuleRadius + ctx.config.floatHeight;

    // -- Ground detection (delegated to CharacterMotor) --
    const groundInfo = ctx.motor.queryGround(
      ctx.body,
      ctx.currentCapsuleHalfHeight,
      ctx.mesh.quaternion,
      ctx.config,
      ctx.physicsWorld,
      ctx.floatingDistance,
      dt,
    );
    ctx.groundInfo = groundInfo;
    ctx.actualSlopeAngle = groundInfo.slopeAngle;
    _actualSlopeNormal.copy(groundInfo.slopeNormal);
    _standingForcePoint.copy(groundInfo.standingForcePoint);
    ctx.canJump = groundInfo.canJump;

    const wasGrounded = ctx.isGrounded;
    ctx.isGrounded = groundInfo.isGrounded;
    if (ctx.isGrounded) {
      ctx.remainingAirJumps = ctx.config.maxAirJumps;
    }
    if (ctx.isGrounded !== wasGrounded) {
      ctx.eventBus.emit("player:grounded", ctx.isGrounded);
    }
    // Landing event
    if (ctx.isGrounded && !wasGrounded) {
      const groundVy = groundInfo.floatingRayHit?.collider.parent()?.linvel().y ?? 0;
      const impactSpeed = Math.max(0, Math.abs(ctx.prevVerticalVelocity - groundVy));
      ctx.eventBus.emit("player:landed", { impactSpeed });
      ctx.jumpActive = false;
    }

    // Variable jump cut
    if (!input.jump && ctx.verticalVelocity > 0 && ctx.jumpActive && !ctx.motor.isJumpSuppressed) {
      ctx.motor.applyJumpCut(ctx.body, ctx.config);
      ctx.verticalVelocity = ctx.body.linvel().y;
      ctx.jumpActive = false;
    }

    // -- Air movement (reduced control) --
    const movementLocked = ctx.fsm.current === STATE.interact;
    const hasMovement = !movementLocked && (input.moveX !== 0 || input.moveY !== 0);
    const desiredInputDir = ctx.computeMovementDirection(input);

    this.applyAirMovement(ctx, desiredInputDir, hasMovement, dt, input);

    // -- Air jump --
    if (!movementLocked && ctx.fsm.current !== STATE.grab && ctx.jumpBufferRemaining > 0) {
      if (ctx.canJump) {
        // Landed — transition to grounded will handle the ground jump
        ctx.fsm.requestState(STATE.jump);
        this.applyJumpImpulse(ctx, false, false);
        ctx.jumpBufferRemaining = 0;
        ctx.motor.clearGroundedGrace();
        ctx.canJump = false;
      } else if (ctx.remainingAirJumps > 0) {
        ctx.fsm.requestState(STATE.airJump);
        this.applyJumpImpulse(ctx, false, true);
        ctx.jumpBufferRemaining = 0;
        ctx.remainingAirJumps -= 1;
        ctx.motor.clearGroundedGrace();
        ctx.canJump = false;
      }
    }

    // -- Floating spring --
    ctx.motor.applyFloatingSpring(ctx.body, groundInfo, ctx.config, ctx.floatingDistance);

    // -- Gravity scaling --
    ctx.motor.applyGravity(ctx.body, ctx.currentVel.y, ctx.canJump, ctx.config);

    // -- Mode transitions --
    if (ctx.canJump || ctx.isGrounded) {
      return "grounded";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  //  Air movement (reduced air control factor)
  // ---------------------------------------------------------------------------

  private applyAirMovement(
    ctx: PlayerContext,
    desiredInputDir: THREE.Vector3,
    hasMovement: boolean,
    dt: number,
    input: InputState,
  ): void {
    const stickMag = Math.min(1, Math.hypot(input.moveX, input.moveY));
    const targetSpeed = ctx.config.moveSpeed * stickMag;

    const lv = ctx.body.linvel();

    _movingDirection.copy(desiredInputDir).setY(0);
    const hasDir = hasMovement && _movingDirection.lengthSq() > 0.0001;
    if (hasDir) _movingDirection.normalize();

    const accelLambdaGround = 30;
    const stopLambdaGround = 58;
    const sideKillLambdaGround = 82;
    const baseLambda = hasDir ? accelLambdaGround : stopLambdaGround;
    const lambda = baseLambda * ctx.config.airControlFactor;
    const sideLambda = sideKillLambdaGround * ctx.config.airControlFactor;

    const t = 1 - Math.exp(-lambda * dt);
    const tSide = 1 - Math.exp(-sideLambda * dt);

    let nextVx: number;
    let nextVz: number;

    if (hasDir) {
      const dirX = _movingDirection.x;
      const dirZ = _movingDirection.z;
      const vParMag0 = lv.x * dirX + lv.z * dirZ;
      const vPerpX0 = lv.x - dirX * vParMag0;
      const vPerpZ0 = lv.z - dirZ * vParMag0;

      const vParMag = vParMag0 + (targetSpeed - vParMag0) * t;
      const vPerpX = vPerpX0 + (0 - vPerpX0) * tSide;
      const vPerpZ = vPerpZ0 + (0 - vPerpZ0) * tSide;

      nextVx = dirX * vParMag + vPerpX;
      nextVz = dirZ * vParMag + vPerpZ;
    } else {
      nextVx = lv.x + (0 - lv.x) * t;
      nextVz = lv.z + (0 - lv.z) * t;
    }

    ctx.body.setLinvel(_setRV(_rv3A, nextVx, lv.y, nextVz), true);
  }

  // ---------------------------------------------------------------------------
  //  Jump
  // ---------------------------------------------------------------------------

  private applyJumpImpulse(ctx: PlayerContext, run: boolean, airJump: boolean): void {
    ctx.jumpActive = true;
    ctx.motor.onJumpFired();
    const jumpVel =
      (run ? ctx.config.sprintJumpMultiplier : 1) *
      ctx.config.jumpForce *
      (airJump ? ctx.config.airJumpForceMultiplier : 1);

    if (airJump) {
      ctx.body.setLinvel(_setRV(_rv3A, ctx.currentVel.x, jumpVel, ctx.currentVel.z), true);
    } else {
      _jumpVelocityVec.set(ctx.currentVel.x, jumpVel, ctx.currentVel.z);
      _jumpDirection
        .set(0, jumpVel * ctx.config.slopeJumpMultiplier, 0)
        .projectOnVector(_actualSlopeNormal)
        .add(_jumpVelocityVec);

      ctx.body.setLinvel(_setRV(_rv3A, _jumpDirection.x, _jumpDirection.y, _jumpDirection.z), true);
    }

    ctx.eventBus.emit("player:jumped", {
      airJump,
      run,
      jumpVel,
      position: ctx.currPosition.clone(),
      groundPosition: ctx.groundPosition.clone(),
    });

    if (ctx.currentGroundBody && shouldApplyGroundReaction(ctx.currentGroundBody)) {
      const down = -jumpVel * ctx.config.jumpForceToGroundMultiplier * 0.5;
      ctx.currentGroundBody.applyImpulseAtPoint(
        _setRV(_rv3A, 0, down, 0),
        _setRV(_rv3B, _standingForcePoint.x, _standingForcePoint.y, _standingForcePoint.z),
        true,
      );
    }
  }
}
