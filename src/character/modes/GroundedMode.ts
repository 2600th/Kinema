import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { STATE, type InputState } from '@core/types';
import { shouldApplyGroundReaction } from '../CharacterMotor';
import type { CharacterMode, PlayerContext } from './CharacterMode';

// Pre-allocated vectors for movement, step assist, and crouch logic.
const _movingDirection = new THREE.Vector3();
const _actualSlopeNormal = new THREE.Vector3(0, 1, 0);
const _standingForcePoint = new THREE.Vector3();
const _distanceFromCharacterToObject = new THREE.Vector3();
const _objectAngvelToLinvel = new THREE.Vector3();
const _velocityDiff = new THREE.Vector3();
const _groundBodyTranslation = new THREE.Vector3();
const _groundBodyAngvel = new THREE.Vector3();
const _slopeProjected = new THREE.Vector3();
const _jumpVelocityVec = new THREE.Vector3();
const _jumpDirection = new THREE.Vector3();
const _stepForward = new THREE.Vector3();
const _stepProbeLowOrigin = new THREE.Vector3();
const _stepProbeHighOrigin = new THREE.Vector3();
const _stepGroundProbeOrigin = new THREE.Vector3();
const _standProbeOrigin = new THREE.Vector3();
const _standProbeDir = new THREE.Vector3();
const _standProbeRight = new THREE.Vector3();
const _slopeSlideDir = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

const _rapierDown = new RAPIER.Vector3(0, -1, 0);
const _rapierUp = new RAPIER.Vector3(0, 1, 0);

const _rv3A = new RAPIER.Vector3(0, 0, 0);
const _rv3B = new RAPIER.Vector3(0, 0, 0);

function _setRV(v: RAPIER.Vector3, x: number, y: number, z: number): RAPIER.Vector3 {
  v.x = x; v.y = y; v.z = z;
  return v;
}

/**
 * Grounded locomotion mode — movement steering, step assist, crouch,
 * ground jump, and moving-platform tracking.
 */
/** Frames to suppress step assist after a successful step to prevent compounding. */
const STEP_ASSIST_COOLDOWN_FRAMES = 6;
/** Slope slide impulse strength (pushes player off steep surfaces). */
const SLOPE_SLIDE_STRENGTH = 2.0;

export class GroundedMode implements CharacterMode {
  readonly id = 'grounded';
  private stepAssistCooldown = 0;

  fixedUpdate(ctx: PlayerContext, input: InputState, dt: number): string | null {
    // -- Crouch --
    this.updateCrouchState(ctx, input.crouch, ctx.currentPos, dt);
    ctx.floatingDistance = ctx.config.capsuleRadius + ctx.config.floatHeight;

    // -- Ground detection (delegated to CharacterMotor) --
    const groundInfo = ctx.motor.queryGround(
      ctx.body, ctx.currentCapsuleHalfHeight, ctx.mesh.quaternion,
      ctx.config, ctx.physicsWorld, ctx.floatingDistance, dt,
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
      ctx.eventBus.emit('player:grounded', ctx.isGrounded);
    }
    // Landing event
    if (ctx.isGrounded && !wasGrounded) {
      const groundVy = groundInfo.floatingRayHit?.collider.parent()?.linvel().y ?? 0;
      const impactSpeed = Math.max(0, Math.abs(ctx.prevVerticalVelocity - groundVy));
      ctx.eventBus.emit('player:landed', { impactSpeed });
      ctx.jumpActive = false;
    }

    // Variable jump cut
    if (!input.jump && ctx.verticalVelocity > 0 && ctx.jumpActive
        && !ctx.motor.isJumpSuppressed) {
      ctx.motor.applyJumpCut(ctx.body, ctx.config);
      ctx.verticalVelocity = ctx.body.linvel().y;
      ctx.jumpActive = false;
    }

    // -- Slope slide: push player off surfaces steeper than slopeMaxAngle --
    if (groundInfo.closeToGround && !groundInfo.standingSlopeAllowed) {
      // Project gravity direction onto slope surface to get downhill direction.
      // gravity = (0, -1, 0), project onto plane with normal = standingSlopeNormal
      // slideDir = gravity - (gravity · normal) * normal, then normalize
      const nx = _actualSlopeNormal.x;
      const ny = _actualSlopeNormal.y;
      const nz = _actualSlopeNormal.z;
      const gravDotN = -ny; // dot((0,-1,0), normal) = -ny
      _slopeSlideDir.set(-nx * gravDotN, -1 - ny * gravDotN, -nz * gravDotN);
      const slideLen = _slopeSlideDir.length();
      if (slideLen > 0.001) {
        _slopeSlideDir.divideScalar(slideLen);
        ctx.body.applyImpulse(
          _setRV(_rv3A,
            _slopeSlideDir.x * SLOPE_SLIDE_STRENGTH,
            _slopeSlideDir.y * SLOPE_SLIDE_STRENGTH,
            _slopeSlideDir.z * SLOPE_SLIDE_STRENGTH,
          ),
          true,
        );
      }
    }

    // -- Moving platform tracking --
    ctx.currentGroundBody = null;
    ctx.isOnMovingObject = false;
    ctx.movingObjectVelocity.set(0, 0, 0);
    if (groundInfo.groundBody) {
      const groundBody = groundInfo.groundBody;
      const groundBodyType = groundBody.bodyType();
      ctx.currentGroundBody = groundBody;

      if (groundBodyType === 0 || groundBodyType === 2) {
        ctx.isOnMovingObject = true;
        const gbt = groundBody.translation();
        _groundBodyTranslation.set(gbt.x, gbt.y, gbt.z);
        _distanceFromCharacterToObject
          .copy(ctx.currentPos)
          .sub(_groundBodyTranslation);
        const lv = groundBody.linvel();
        const av = groundBody.angvel();
        _groundBodyAngvel.set(av.x, av.y, av.z);
        _objectAngvelToLinvel.crossVectors(
          _groundBodyAngvel,
          _distanceFromCharacterToObject,
        );
        ctx.movingObjectVelocity.set(
          lv.x + _objectAngvelToLinvel.x,
          lv.y,
          lv.z + _objectAngvelToLinvel.z,
        );

        const groundMass = Math.max(groundBody.mass(), 0.001);
        const massRatio = ctx.body.mass() / groundMass;
        ctx.movingObjectVelocity.multiplyScalar(Math.min(1, 1 / massRatio));
        _velocityDiff.subVectors(ctx.movingObjectVelocity, ctx.currentVel);
        if (_velocityDiff.length() > 30) {
          ctx.movingObjectVelocity.multiplyScalar(1 / _velocityDiff.length());
        }
      }
    }

    // -- Movement --
    const movementLocked = ctx.fsm.current === STATE.interact;
    const hasMovement = !movementLocked && (input.moveX !== 0 || input.moveY !== 0);
    const desiredInputDir = ctx.computeMovementDirection(input);
    // Axis-lock movement during grab: project onto the box face normal
    const grabAxis = ctx.grabCarry.grabAxis;
    if (ctx.fsm.current === STATE.grab && grabAxis && desiredInputDir.lengthSq() > 0.0001) {
      const dot = desiredInputDir.x * grabAxis.x + desiredInputDir.z * grabAxis.z;
      desiredInputDir.set(grabAxis.x * dot, 0, grabAxis.z * dot);
    }
    const run = ctx.fsm.current !== STATE.grab && input.sprint && !ctx.isCrouched;

    this.applyMoveVelocity(ctx, desiredInputDir, run, hasMovement, dt, input);
    if (hasMovement) {
      this.applyStepAssist(ctx, desiredInputDir, run, dt);
    }

    // -- Ground jump --
    if (!movementLocked && ctx.fsm.current !== STATE.grab && ctx.jumpBufferRemaining > 0) {
      if (ctx.canJump) {
        ctx.fsm.requestState(STATE.jump);
        this.applyJumpImpulse(ctx, run, false);
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

    return null;
  }

  // ---------------------------------------------------------------------------
  //  Movement steering
  // ---------------------------------------------------------------------------

  private applyMoveVelocity(
    ctx: PlayerContext,
    desiredInputDir: THREE.Vector3,
    run: boolean,
    hasMovement: boolean,
    dt: number,
    input: InputState,
  ): void {
    const crouchMult = ctx.isCrouched ? ctx.config.crouchSpeedMultiplier : 1;
    const grabMult = ctx.fsm.current === STATE.grab ? ctx.config.crouchSpeedMultiplier * ctx.grabCarry.weightMultiplier : 1;
    const stickMag = Math.min(1, Math.hypot(input.moveX, input.moveY));
    const targetSpeed =
      ctx.config.moveSpeed * crouchMult * grabMult * (run ? ctx.config.sprintMultiplier : 1) * stickMag;

    const platformVx = ctx.isOnMovingObject ? ctx.movingObjectVelocity.x : 0;
    const platformVz = ctx.isOnMovingObject ? ctx.movingObjectVelocity.z : 0;

    const lv = ctx.body.linvel();
    const grounded = ctx.canJump;
    const inAir = !grounded;

    const MIN_SLOPE_THRESHOLD = 0.05;
    const onSlope = grounded && ctx.actualSlopeAngle > MIN_SLOPE_THRESHOLD;

    _movingDirection.copy(desiredInputDir).setY(0);
    const hasDir = hasMovement && _movingDirection.lengthSq() > 0.0001;
    if (hasDir) _movingDirection.normalize();

    let useSlope = false;
    let slopeDirX = 0;
    let slopeDirY = 0;
    let slopeDirZ = 0;
    let slopeExtraMultiplier = 1;

    if (onSlope && hasDir) {
      const dot = _movingDirection.x * _actualSlopeNormal.x +
                  _movingDirection.y * _actualSlopeNormal.y +
                  _movingDirection.z * _actualSlopeNormal.z;
      _slopeProjected.set(
        _movingDirection.x - _actualSlopeNormal.x * dot,
        _movingDirection.y - _actualSlopeNormal.y * dot,
        _movingDirection.z - _actualSlopeNormal.z * dot,
      );
      const projLen = _slopeProjected.length();
      if (projLen > 0.0001) {
        _slopeProjected.divideScalar(projLen);
        useSlope = true;
        slopeDirX = _slopeProjected.x;
        slopeDirY = _slopeProjected.y;
        slopeDirZ = _slopeProjected.z;

        // ── Slope rejection: prevent climbing surfaces steeper than maxSlopeAngle ──
        // Check BOTH the standing probe (surface under player) AND the forward
        // probe angle (slope being walked toward). Either being too steep blocks
        // uphill movement — this prevents climbing from the base of a steep wall.
        const forwardSlopeTooSteep = ctx.actualSlopeAngle >= ctx.config.slopeMaxAngle;
        if ((forwardSlopeTooSteep || !ctx.groundInfo.standingSlopeAllowed) && slopeDirY > 0) {
          slopeDirY = 0;
          const flatLen = Math.hypot(slopeDirX, slopeDirZ);
          if (flatLen > 0.0001) {
            slopeDirX /= flatLen;
            slopeDirZ /= flatLen;
          } else {
            // Moving directly uphill on a too-steep slope — kill movement
            useSlope = false;
            _movingDirection.set(0, 0, 0);
          }
        }

        if (slopeDirY > 0.001) {
          slopeExtraMultiplier = 1 + ctx.config.slopeUpExtraForce;
        } else if (slopeDirY < -0.001) {
          slopeExtraMultiplier = 1 + ctx.config.slopeDownExtraForce;
        }
      }
    }

    const relVx0 = lv.x - platformVx;
    const relVz0 = lv.z - platformVz;

    const accelLambdaGround = 30;
    const stopLambdaGround = 58;
    const sideKillLambdaGround = 82;
    const baseLambda = hasDir ? accelLambdaGround : stopLambdaGround;
    const lambda = inAir ? baseLambda * ctx.config.airControlFactor : baseLambda;
    const sideLambda = inAir ? sideKillLambdaGround * ctx.config.airControlFactor : sideKillLambdaGround;

    const t = 1 - Math.exp(-lambda * dt);
    const tSide = 1 - Math.exp(-sideLambda * dt);

    let nextVx: number;
    let nextVy: number;
    let nextVz: number;

    if (hasDir && useSlope) {
      const relVy0 = lv.y;
      const vParMag0 = relVx0 * slopeDirX + relVy0 * slopeDirY + relVz0 * slopeDirZ;
      const vPerpX0 = relVx0 - slopeDirX * vParMag0;
      const vPerpY0 = relVy0 - slopeDirY * vParMag0;
      const vPerpZ0 = relVz0 - slopeDirZ * vParMag0;

      const adjustedTarget = targetSpeed * slopeExtraMultiplier;
      const vParMag = vParMag0 + (adjustedTarget - vParMag0) * t;
      const vPerpX = vPerpX0 + (0 - vPerpX0) * tSide;
      const vPerpY = vPerpY0 + (0 - vPerpY0) * tSide;
      const vPerpZ = vPerpZ0 + (0 - vPerpZ0) * tSide;

      nextVx = (slopeDirX * vParMag + vPerpX) + platformVx;
      nextVy = slopeDirY * vParMag + vPerpY;
      nextVz = (slopeDirZ * vParMag + vPerpZ) + platformVz;
    } else if (hasDir) {
      const dirX = _movingDirection.x;
      const dirZ = _movingDirection.z;
      const vParMag0 = relVx0 * dirX + relVz0 * dirZ;
      const vPerpX0 = relVx0 - dirX * vParMag0;
      const vPerpZ0 = relVz0 - dirZ * vParMag0;

      const vParMag = vParMag0 + (targetSpeed - vParMag0) * t;
      const vPerpX = vPerpX0 + (0 - vPerpX0) * tSide;
      const vPerpZ = vPerpZ0 + (0 - vPerpZ0) * tSide;

      nextVx = (dirX * vParMag + vPerpX) + platformVx;
      nextVy = lv.y;
      nextVz = (dirZ * vParMag + vPerpZ) + platformVz;
    } else {
      nextVx = (relVx0 + (0 - relVx0) * t) + platformVx;
      nextVy = lv.y;
      nextVz = (relVz0 + (0 - relVz0) * t) + platformVz;
    }

    ctx.body.setLinvel(_setRV(_rv3A, nextVx, nextVy, nextVz), true);
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
      ctx.body.setLinvel(
        _setRV(_rv3A, ctx.currentVel.x, jumpVel, ctx.currentVel.z),
        true,
      );
    } else {
      _jumpVelocityVec.set(ctx.currentVel.x, jumpVel, ctx.currentVel.z);
      _jumpDirection
        .set(0, jumpVel * ctx.config.slopeJumpMultiplier, 0)
        .projectOnVector(_actualSlopeNormal)
        .add(_jumpVelocityVec);

      ctx.body.setLinvel(
        _setRV(_rv3A, _jumpDirection.x, _jumpDirection.y, _jumpDirection.z),
        true,
      );
    }

    ctx.eventBus.emit('player:jumped', {
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

  // ---------------------------------------------------------------------------
  //  Step assist
  // ---------------------------------------------------------------------------

  private applyStepAssist(
    ctx: PlayerContext,
    desiredInputDir: THREE.Vector3,
    run: boolean,
    _dt: number,
  ): void {
    // Cooldown: skip if recently stepped to prevent compounding
    if (this.stepAssistCooldown > 0) {
      this.stepAssistCooldown--;
      return;
    }
    // Only fire when truly grounded (not coyote-only)
    if (!ctx.isGrounded) return;
    if (desiredInputDir.lengthSq() < 0.0001) return;
    if (ctx.currentVel.y > 0.55) return;

    _stepForward.copy(desiredInputDir).setY(0);
    if (_stepForward.lengthSq() < 0.0001) return;
    _stepForward.normalize();

    const probeDist = ctx.config.capsuleRadius + (run ? 0.34 : 0.28);
    _stepProbeLowOrigin.set(
      ctx.currentPos.x,
      ctx.currentPos.y - ctx.currentCapsuleHalfHeight + 0.05,
      ctx.currentPos.z,
    );
    _stepProbeHighOrigin.set(
      ctx.currentPos.x,
      ctx.currentPos.y - ctx.currentCapsuleHalfHeight + 0.46,
      ctx.currentPos.z,
    );

    const lowHit = ctx.physicsWorld.castRay(
      _setRV(_rv3A, _stepProbeLowOrigin.x, _stepProbeLowOrigin.y, _stepProbeLowOrigin.z),
      _setRV(_rv3B, _stepForward.x, _stepForward.y, _stepForward.z),
      probeDist,
      undefined,
      ctx.body,
      (c) => !c.isSensor(),
    );
    if (!lowHit || lowHit.timeOfImpact > probeDist) return;

    const highHit = ctx.physicsWorld.castRay(
      _setRV(_rv3A, _stepProbeHighOrigin.x, _stepProbeHighOrigin.y, _stepProbeHighOrigin.z),
      _setRV(_rv3B, _stepForward.x, _stepForward.y, _stepForward.z),
      probeDist,
      undefined,
      ctx.body,
      (c) => !c.isSensor(),
    );
    if (highHit) return;

    // Compute final velocity in a single pass (no compounding)
    const lv = ctx.body.linvel();
    let finalVy = lv.y;
    let finalFwdBoost = 0;

    // Check precise step height via downward probe ahead
    _stepGroundProbeOrigin.set(
      ctx.currentPos.x + _stepForward.x * (run ? 0.42 : 0.36),
      ctx.currentPos.y - ctx.currentCapsuleHalfHeight + 0.54,
      ctx.currentPos.z + _stepForward.z * (run ? 0.42 : 0.36),
    );
    const downHit = ctx.physicsWorld.castRay(
      _setRV(_rv3A, _stepGroundProbeOrigin.x, _stepGroundProbeOrigin.y, _stepGroundProbeOrigin.z),
      _rapierDown,
      0.92,
      undefined,
      ctx.body,
      (c) => !c.isSensor(),
    );
    const maxStepHeight = run ? 0.2 : 0.15;
    const stepTolerance = 0.02;
    if (downHit) {
      const groundAheadY = _stepGroundProbeOrigin.y - downHit.timeOfImpact;
      const feetY = ctx.currentPos.y - ctx.currentCapsuleHalfHeight;
      const stepHeight = groundAheadY - feetY;
      if (stepHeight > 0.02 && stepHeight <= maxStepHeight + stepTolerance) {
        // Precise step: use measured height
        const clampedHeight = Math.min(stepHeight + 0.01, maxStepHeight);
        finalVy = Math.max(lv.y, clampedHeight * 60);
        finalFwdBoost = 0.018 * 60;
      } else if (stepHeight > maxStepHeight + stepTolerance) {
        // Tall obstacles should block movement instead of converting into an
        // unintended auto-hop or launch.
        return;
      }
      // else stepHeight <= 0.02: ground ahead is at/below current feet — edge, not step
    } else {
      // No ground ahead — this is a platform edge / drop-off, NOT a step.
      // Do NOT boost; the player should walk off normally or stop.
      return;
    }

    // Single setLinvel call — no compounding
    if (finalVy !== lv.y || finalFwdBoost > 0) {
      ctx.body.setLinvel(
        _setRV(_rv3A,
          lv.x + _stepForward.x * finalFwdBoost,
          finalVy,
          lv.z + _stepForward.z * finalFwdBoost,
        ),
        true,
      );
      this.stepAssistCooldown = STEP_ASSIST_COOLDOWN_FRAMES;
    }
  }

  // ---------------------------------------------------------------------------
  //  Crouch
  // ---------------------------------------------------------------------------

  private updateCrouchState(ctx: PlayerContext, wantsCrouch: boolean, position: THREE.Vector3, dt: number): void {
    if (wantsCrouch) {
      ctx.crouchReleaseGraceRemaining = ctx.crouchReleaseGraceSeconds;
      this.setCrouchedState(ctx, true);
      return;
    }
    if (!ctx.isCrouched) {
      ctx.crouchReleaseGraceRemaining = 0;
      return;
    }
    const blocked = !this.canStandUp(ctx, position);
    if (blocked) {
      ctx.crouchReleaseGraceRemaining = ctx.crouchReleaseGraceSeconds;
      this.setCrouchedState(ctx, true);
      return;
    }
    if (ctx.crouchReleaseGraceRemaining > 0) {
      ctx.crouchReleaseGraceRemaining = Math.max(0, ctx.crouchReleaseGraceRemaining - dt);
      this.setCrouchedState(ctx, true);
      return;
    }
    this.setCrouchedState(ctx, false);
  }

  private setCrouchedState(ctx: PlayerContext, crouched: boolean): void {
    if (ctx.isCrouched === crouched) return;
    ctx.isCrouched = crouched;
    if (!crouched) {
      ctx.crouchReleaseGraceRemaining = 0;
    }
    const targetHalf = crouched ? ctx.crouchedCapsuleHalfHeight : ctx.standingCapsuleHalfHeight;
    if (Math.abs(targetHalf - ctx.currentCapsuleHalfHeight) <= 0.0001) return;

    const pos = ctx.body.translation();
    const deltaHalf = ctx.currentCapsuleHalfHeight - targetHalf;
    ctx.currentCapsuleHalfHeight = targetHalf;
    ctx.collider.setHalfHeight(targetHalf);
    ctx.body.setTranslation(_setRV(_rv3A, pos.x, pos.y - deltaHalf, pos.z), true);
    ctx.body.wakeUp();
    ctx.currPosition.set(pos.x, pos.y - deltaHalf, pos.z);
    ctx.prevPosition.set(pos.x, pos.y - deltaHalf, pos.z);
    ctx.floatingDistance = ctx.config.capsuleRadius + ctx.config.floatHeight;
  }

  private canStandUp(ctx: PlayerContext, position: THREE.Vector3): boolean {
    const standDelta = ctx.standingCapsuleHalfHeight - ctx.currentCapsuleHalfHeight;
    if (standDelta <= 0.001) return true;
    const probeLength = standDelta * 2 + 0.04;
    if (this.isStandProbeBlocked(ctx, position.x, position.y, position.z, probeLength)) {
      return false;
    }

    const input = ctx.lastInput;
    if (!input) return true;

    _standProbeDir.copy(ctx.computeMovementDirection(input)).setY(0);
    if (_standProbeDir.lengthSq() < 0.0001) {
      return true;
    }
    _standProbeDir.normalize();
    _standProbeRight.crossVectors(_standProbeDir, _worldUp).normalize();
    const forward = ctx.config.capsuleRadius * 0.95;
    const shoulder = ctx.config.capsuleRadius * 0.55;

    if (
      this.isStandProbeBlocked(ctx,
        position.x + _standProbeDir.x * forward,
        position.y,
        position.z + _standProbeDir.z * forward,
        probeLength,
      )
    ) {
      return false;
    }
    if (
      this.isStandProbeBlocked(ctx,
        position.x + _standProbeDir.x * forward + _standProbeRight.x * shoulder,
        position.y,
        position.z + _standProbeDir.z * forward + _standProbeRight.z * shoulder,
        probeLength,
      )
    ) {
      return false;
    }
    if (
      this.isStandProbeBlocked(ctx,
        position.x + _standProbeDir.x * forward - _standProbeRight.x * shoulder,
        position.y,
        position.z + _standProbeDir.z * forward - _standProbeRight.z * shoulder,
        probeLength,
      )
    ) {
      return false;
    }
    return true;
  }

  private isStandProbeBlocked(ctx: PlayerContext, x: number, y: number, z: number, probeLength: number): boolean {
    _standProbeOrigin.set(
      x,
      y + ctx.currentCapsuleHalfHeight + ctx.config.capsuleRadius,
      z,
    );
    const hit = ctx.physicsWorld.castRay(
      _setRV(_rv3A, _standProbeOrigin.x, _standProbeOrigin.y, _standProbeOrigin.z),
      _rapierUp,
      probeLength,
      undefined,
      ctx.body,
      (c) => !c.isSensor(),
    );
    return hit != null;
  }
}
