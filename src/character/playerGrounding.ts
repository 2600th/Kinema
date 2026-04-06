import type { GroundInfo } from './CharacterMotor';
import type { PlayerContext } from './modes/CharacterMode';

const STABLE_GROUNDED_GRACE_SECONDS = 0.08;
const STABLE_GROUNDED_MAX_VERTICAL_SPEED = 1.2;

export interface StableGroundedResult {
  stableGrounded: boolean;
  graceRemaining: number;
}

export function resolveStableGroundedState(
  groundInfo: Pick<GroundInfo, 'isGrounded' | 'closeToGround' | 'standingSlopeAllowed'>,
  verticalVelocity: number,
  graceRemaining: number,
  dt: number,
): StableGroundedResult {
  if (groundInfo.isGrounded) {
    return {
      stableGrounded: true,
      graceRemaining: STABLE_GROUNDED_GRACE_SECONDS,
    };
  }

  const nextGrace = Math.max(0, graceRemaining - dt);
  const canHoldStableGround =
    nextGrace > 0 &&
    groundInfo.closeToGround &&
    groundInfo.standingSlopeAllowed &&
    Math.abs(verticalVelocity) <= STABLE_GROUNDED_MAX_VERTICAL_SPEED;

  return {
    stableGrounded: canHoldStableGround,
    graceRemaining: canHoldStableGround ? nextGrace : 0,
  };
}

export function refreshPlayerGroundState(ctx: PlayerContext, dt: number): GroundInfo {
  ctx.floatingDistance = ctx.config.capsuleRadius + ctx.config.floatHeight;

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
  ctx.canJump = groundInfo.canJump;

  const wasGrounded = ctx.isGrounded;
  ctx.isGrounded = groundInfo.isGrounded;
  ctx.justGrounded = ctx.isGrounded && !wasGrounded;

  if (ctx.isGrounded) {
    ctx.remainingAirJumps = ctx.config.maxAirJumps;
  }

  if (ctx.isGrounded !== wasGrounded) {
    ctx.eventBus.emit('player:grounded', ctx.isGrounded);
  }

  if (ctx.justGrounded) {
    const groundVy = groundInfo.floatingRayHit?.collider.parent()?.linvel().y ?? 0;
    const impactSpeed = Math.max(0, Math.abs(ctx.prevVerticalVelocity - groundVy));
    ctx.eventBus.emit('player:landed', { impactSpeed });
    ctx.jumpActive = false;
  }

  return groundInfo;
}
